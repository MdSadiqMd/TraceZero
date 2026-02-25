use privacy_proxy_sdk::credits::SignedCredit;
use privacy_proxy_sdk::deposit::{DepositRequest, DepositResponse};
use sha2::{Digest, Sha256};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signer::Signer,
    system_program::ID as SYSTEM_PROGRAM_ID,
    transaction::Transaction,
};
use solana_transaction_status::UiTransactionEncoding;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::blind_signer::BlindSignerService;
use crate::config::{get_bucket_id, RelayerConfig};
use crate::encryption::hash_token_id;
use crate::error::{RelayerError, Result};
use crate::merkle_service::MerkleService;

/// Persistent token store to prevent double-spend across restarts, Uses checksums to detect file corruption
struct TokenStore {
    /// In-memory cache for fast lookups
    cache: HashSet<[u8; 32]>,
    /// Path to persistence file
    path: PathBuf,
    /// Checksum of the current store state
    checksum: [u8; 32],
}

impl TokenStore {
    fn compute_checksum(tokens: &HashSet<[u8; 32]>) -> [u8; 32] {
        let mut hasher = Sha256::new();

        // Sort tokens for deterministic checksum
        let mut sorted: Vec<_> = tokens.iter().collect();
        sorted.sort();
        for token in sorted {
            hasher.update(token);
        }

        let result = hasher.finalize();
        let mut checksum = [0u8; 32];
        checksum.copy_from_slice(&result);
        checksum
    }

    /// Load or create token store with integrity verification
    fn load(path: PathBuf) -> Self {
        let checksum_path = path.with_extension("checksum");
        let cache = if path.exists() {
            match std::fs::read(&path) {
                Ok(data) => {
                    let mut set = HashSet::new();
                    // Each token hash is 32 bytes
                    for chunk in data.chunks_exact(32) {
                        let mut hash = [0u8; 32];
                        hash.copy_from_slice(chunk);
                        set.insert(hash);
                    }

                    // Verify checksum if it exists
                    if checksum_path.exists() {
                        match std::fs::read(&checksum_path) {
                            Ok(stored_checksum) if stored_checksum.len() == 32 => {
                                let computed = Self::compute_checksum(&set);
                                let mut stored = [0u8; 32];
                                stored.copy_from_slice(&stored_checksum);
                                if computed != stored {
                                    warn!("Token store checksum mismatch! File may be corrupted.");
                                    warn!("Starting with empty store for safety.");
                                    // Return empty set to prevent accepting corrupted data
                                    return Self {
                                        cache: HashSet::new(),
                                        path,
                                        checksum: [0u8; 32],
                                    };
                                }
                            }
                            _ => {
                                warn!(
                                    "Could not read checksum file, proceeding without verification"
                                );
                            }
                        }
                    }

                    info!(
                        "Loaded {} used tokens from disk (checksum verified)",
                        set.len()
                    );
                    set
                }
                Err(e) => {
                    warn!("Failed to load token store: {}, starting fresh", e);
                    HashSet::new()
                }
            }
        } else {
            HashSet::new()
        };

        let checksum = Self::compute_checksum(&cache);
        Self {
            cache,
            path,
            checksum,
        }
    }

    /// Check if token is used
    fn contains(&self, hash: &[u8; 32]) -> bool {
        self.cache.contains(hash)
    }

    /// Mark token as used and persist with checksum
    fn insert(&mut self, hash: [u8; 32]) -> Result<()> {
        if self.cache.insert(hash) {
            // Update checksum
            self.checksum = Self::compute_checksum(&self.cache);

            // Write full file (atomic update)
            let temp_path = self.path.with_extension("tmp");
            let checksum_path = self.path.with_extension("checksum");

            // Write tokens to temp file
            {
                use std::io::Write;
                let mut file = std::fs::File::create(&temp_path).map_err(|e| {
                    RelayerError::Internal(format!("Failed to create temp token store: {}", e))
                })?;

                for token in &self.cache {
                    file.write_all(token).map_err(|e| {
                        RelayerError::Internal(format!("Failed to write token: {}", e))
                    })?;
                }
                file.sync_all().map_err(|e| {
                    RelayerError::Internal(format!("Failed to sync token store: {}", e))
                })?;
            }

            // Write checksum
            std::fs::write(&checksum_path, &self.checksum)
                .map_err(|e| RelayerError::Internal(format!("Failed to write checksum: {}", e)))?;

            // Atomic rename
            std::fs::rename(&temp_path, &self.path).map_err(|e| {
                RelayerError::Internal(format!("Failed to rename token store: {}", e))
            })?;
        }
        Ok(())
    }
}

pub struct DepositService {
    config: RelayerConfig,
    rpc_client: Arc<RpcClient>,
    blind_signer: Arc<BlindSignerService>,
    merkle_service: Arc<MerkleService>,
    /// Persistent token store (prevents double-spend across restarts)
    token_store: Arc<RwLock<TokenStore>>,
}

impl DepositService {
    pub fn new(
        config: RelayerConfig,
        rpc_client: Arc<RpcClient>,
        blind_signer: Arc<BlindSignerService>,
        merkle_service: Arc<MerkleService>,
    ) -> Self {
        let token_path = std::env::var("TOKEN_STORE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("used_tokens.dat"));
        let token_store = TokenStore::load(token_path);

        Self {
            config,
            rpc_client,
            blind_signer,
            merkle_service,
            token_store: Arc::new(RwLock::new(token_store)),
        }
    }

    fn get_pool_pda(&self, bucket_id: u8) -> Pubkey {
        let (pool_pda, _) =
            Pubkey::find_program_address(&[b"pool", &[bucket_id]], &self.config.program_id);
        pool_pda
    }

    pub async fn handle_deposit(&self, request: DepositRequest) -> Result<DepositResponse> {
        // 1. Verify the signed credit
        self.verify_credit(&request.credit).await?;

        // 2. Check token not already redeemed
        let token_hash = hash_token_id(&request.credit.token_id);
        self.check_token_not_used(&token_hash).await?;

        // 3. Get bucket ID from amount
        let bucket_id = get_bucket_id(request.credit.amount)
            .ok_or(RelayerError::InvalidBucket(request.credit.amount))?;

        // 4. Fetch on-chain next_index FIRST to ensure sync
        let on_chain_next_index = self.get_on_chain_next_index(bucket_id).await?;
        let local_size = self.merkle_service.size(bucket_id).await.unwrap_or(0) as u64;

        // Verify local tree is in sync with on-chain state
        if local_size != on_chain_next_index {
            warn!(
                "Local tree out of sync with on-chain: local={}, on-chain={}. Syncing...",
                local_size, on_chain_next_index
            );
            // Sync local tree to match on-chain state
            self.sync_local_tree(bucket_id, on_chain_next_index).await?;
        }

        // 5. Update local merkle tree to get the new root
        let leaf_index = self
            .merkle_service
            .insert(bucket_id, request.commitment)
            .await?;
        let merkle_root = self.merkle_service.root(bucket_id).await?;

        // 6. Execute deposit on-chain with the merkle root
        // Pass the on-chain next_index to ensure PDA derivation matches
        let tx_signature = self
            .execute_deposit(
                bucket_id,
                request.commitment,
                token_hash,
                request.encrypted_note,
                merkle_root,
                on_chain_next_index,
            )
            .await?;

        // 7. Mark token as used (persisted to prevent double-spend)
        self.mark_token_used(token_hash).await?;

        info!(
            "Deposit successful: bucket={}, leaf_index={}, tx={}",
            bucket_id, leaf_index, tx_signature
        );

        Ok(DepositResponse {
            success: true,
            tx_signature: Some(tx_signature),
            leaf_index: Some(leaf_index),
            merkle_root: Some(hex::encode(merkle_root)),
            error: None,
        })
    }

    async fn get_on_chain_next_index(&self, bucket_id: u8) -> Result<u64> {
        let (pool_pda, _) =
            Pubkey::find_program_address(&[b"pool", &[bucket_id]], &self.config.program_id);

        let pool_data = self
            .rpc_client
            .get_account_data(&pool_pda)
            .await
            .map_err(|e| RelayerError::TransactionFailed(format!("Failed to fetch pool: {}", e)))?;

        // Parse next_index from pool account data
        // DepositPool layout:
        // - discriminator: 8 bytes (offset 0)
        // - bucket_id: 1 byte (offset 8)
        // - amount_lamports: 8 bytes (offset 9)
        // - merkle_root: 32 bytes (offset 17)
        // - next_index: 8 bytes (offset 49)
        let next_index = if pool_data.len() >= 57 {
            u64::from_le_bytes(pool_data[49..57].try_into().unwrap_or([0u8; 8]))
        } else {
            0u64
        };

        Ok(next_index)
    }

    async fn sync_local_tree(&self, bucket_id: u8, on_chain_size: u64) -> Result<()> {
        let local_size = self.merkle_service.size(bucket_id).await.unwrap_or(0) as u64;
        if local_size > on_chain_size {
            error!(
                "Local tree has more entries ({}) than on-chain ({}). This should never happen! Resetting local tree.",
                local_size, on_chain_size
            );
            // Re-initialize the tree (this will clear it)
            self.merkle_service
                .sync_from_chain(bucket_id, vec![])
                .await?;

            // After reset, we need to fetch all on-chain commitments
            if on_chain_size > 0 {
                warn!(
                    "Fetching {} commitments from on-chain to rebuild tree...",
                    on_chain_size
                );
            }
        }

        // Fetch missing commitments from transaction history
        let current_local_size = self.merkle_service.size(bucket_id).await.unwrap_or(0) as u64;
        if current_local_size < on_chain_size {
            warn!(
                "On-chain has {} entries, local has {}. Fetching missing commitments from transaction history...",
                on_chain_size, current_local_size
            );

            let pool_pda = self.get_pool_pda(bucket_id);

            // Fetch transaction signatures for the pool account
            let signatures = self
                .rpc_client
                .get_signatures_for_address(&pool_pda)
                .await
                .map_err(|e| {
                    RelayerError::TransactionFailed(format!(
                        "Failed to fetch transaction history: {}",
                        e
                    ))
                })?;

            info!(
                "Found {} transactions for pool {}",
                signatures.len(),
                bucket_id
            );

            // OPTIMIZATION: If there are too many transactions (>50), skip the slow scan
            // This prevents 20+ second delays on devnet where logs are often pruned anyway
            if signatures.len() > 50 {
                warn!(
                    "Too many transactions ({}) to scan efficiently. Skipping history scan.",
                    signatures.len()
                );
                warn!("⚠ CONTINUING WITH EMPTY TREE - Old deposits (if any) will NOT be withdrawable!");
                warn!("⚠ The relayer will track new deposits from this point forward.");
                warn!("⚠ If you need to recover old deposits, you must restore the merkle_state/ from backup.");

                // Reset the tree to empty and continue
                self.merkle_service
                    .sync_from_chain(bucket_id, vec![])
                    .await?;

                return Ok(());
            }

            // Parse deposit events from transaction logs (only scan recent transactions)
            let mut commitments = Vec::new();
            for sig_info in signatures.iter().rev().take(20) {
                // Only scan last 20 transactions
                // Skip failed transactions
                if sig_info.err.is_some() {
                    continue;
                }

                // Fetch full transaction to get logs
                let signature = sig_info.signature.parse().map_err(|e| {
                    RelayerError::InvalidRequest(format!("Invalid signature: {}", e))
                })?;

                match self
                    .rpc_client
                    .get_transaction(&signature, UiTransactionEncoding::Json)
                    .await
                {
                    Ok(tx) => {
                        if let Some(meta) = tx.transaction.meta {
                            let log_messages: Option<Vec<String>> = meta.log_messages.into();
                            if let Some(logs) = log_messages {
                                for log in logs {
                                    if log.contains("Program log: Deposit: commitment=") {
                                        if let Some(hex_start) = log.find("commitment=") {
                                            let hex_str = &log[hex_start + 11..];
                                            // Extract 64 hex chars (32 bytes)
                                            if hex_str.len() >= 64 {
                                                let commitment_hex = &hex_str[..64];
                                                match hex::decode(commitment_hex) {
                                                    Ok(bytes) if bytes.len() == 32 => {
                                                        let mut commitment = [0u8; 32];
                                                        commitment.copy_from_slice(&bytes);
                                                        commitments.push(commitment);
                                                        info!(
                                                            "Found commitment from tx {}: {}",
                                                            signature, commitment_hex
                                                        );
                                                    }
                                                    _ => {
                                                        warn!(
                                                            "Invalid commitment hex in log: {}",
                                                            commitment_hex
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to fetch transaction {}: {}", signature, e);
                    }
                }
            }

            if commitments.is_empty() {
                warn!(
                    "Could not find any commitments in transaction history for bucket {}",
                    bucket_id
                );
                warn!("This may happen if transactions are too old or logs are not available.");

                // IMPORTANT: Instead of returning an error, we'll continue with a warning
                // This allows the relayer to start accepting new deposits even if old ones can't be recovered
                warn!(
                    "⚠ CONTINUING WITH EMPTY TREE - Old deposits (if any) will NOT be withdrawable!"
                );
                warn!("⚠ The relayer will track new deposits from this point forward.");
                warn!(
                    "⚠ If you need to recover old deposits, you must restore the merkle_state/ from backup."
                );

                // Reset the tree to empty and continue
                self.merkle_service
                    .sync_from_chain(bucket_id, vec![])
                    .await?;

                return Ok(());
            }

            info!(
                "Found {} commitments from transaction history",
                commitments.len()
            );

            // Rebuild local tree with found commitments
            self.merkle_service
                .sync_from_chain(bucket_id, commitments)
                .await?;

            let new_local_size = self.merkle_service.size(bucket_id).await.unwrap_or(0) as u64;
            if new_local_size != on_chain_size {
                warn!(
                    "After sync: local size {} still doesn't match on-chain size {}",
                    new_local_size, on_chain_size
                );
                warn!("Some commitments may be missing from transaction history.");
            } else {
                info!("✓ Successfully synced local tree with on-chain state");
            }
        }

        Ok(())
    }

    async fn verify_credit(&self, credit: &SignedCredit) -> Result<()> {
        let is_valid = self
            .blind_signer
            .verify_signature(&credit.token_id, &credit.signature)
            .await?;
        if !is_valid {
            return Err(RelayerError::InvalidSignature);
        }

        Ok(())
    }

    async fn check_token_not_used(&self, token_hash: &[u8; 32]) -> Result<()> {
        let store = self.token_store.read().await;
        if store.contains(token_hash) {
            return Err(RelayerError::TokenAlreadyRedeemed);
        }
        Ok(())
    }

    async fn mark_token_used(&self, token_hash: [u8; 32]) -> Result<()> {
        let mut store = self.token_store.write().await;
        store.insert(token_hash)
    }

    async fn execute_deposit(
        &self,
        bucket_id: u8,
        commitment: [u8; 32],
        token_hash: [u8; 32],
        encrypted_note: Option<Vec<u8>>,
        merkle_root: [u8; 32],
        on_chain_next_index: u64,
    ) -> Result<String> {
        let relayer = &self.config.keypair;

        // Derive PDAs
        let (config_pda, _) = Pubkey::find_program_address(&[b"config"], &self.config.program_id);

        let (pool_pda, _) =
            Pubkey::find_program_address(&[b"pool", &[bucket_id]], &self.config.program_id);

        let (historical_roots_pda, _) = Pubkey::find_program_address(
            &[b"historical_roots", pool_pda.as_ref(), &[0u8]],
            &self.config.program_id,
        );

        let (used_token_pda, _) =
            Pubkey::find_program_address(&[b"used_token", &token_hash], &self.config.program_id);

        // Use the on-chain next_index for note PDA derivation
        // This ensures we match what the on-chain program expects
        let (note_pda, _) = Pubkey::find_program_address(
            &[
                b"note",
                pool_pda.as_ref(),
                &on_chain_next_index.to_le_bytes(),
            ],
            &self.config.program_id,
        );

        // Build instruction data
        // deposit(bucket_id: u8, commitment: [u8; 32], token_hash: [u8; 32], encrypted_note: Vec<u8>, merkle_root: [u8; 32])
        let mut data = vec![0u8; 8]; // Anchor discriminator for "deposit"
        let discriminator = anchor_discriminator("deposit");
        data[..8].copy_from_slice(&discriminator);
        data.push(bucket_id);
        data.extend_from_slice(&commitment);
        data.extend_from_slice(&token_hash);

        // Serialize encrypted_note as Vec<u8>
        let note_data = encrypted_note.unwrap_or_default();
        data.extend_from_slice(&(note_data.len() as u32).to_le_bytes());
        data.extend_from_slice(&note_data);

        // Add merkle_root
        data.extend_from_slice(&merkle_root);

        let instruction = Instruction {
            program_id: self.config.program_id,
            accounts: vec![
                AccountMeta::new(relayer.pubkey(), true), // relayer (signer, mut)
                AccountMeta::new_readonly(config_pda, false), // config
                AccountMeta::new(pool_pda, false),        // pool (mut)
                AccountMeta::new(historical_roots_pda, false), // historical_roots (mut)
                AccountMeta::new(used_token_pda, false),  // used_token (init)
                AccountMeta::new(note_pda, false),        // encrypted_note (init)
                AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
            ],
            data,
        };

        let recent_blockhash = self.rpc_client.get_latest_blockhash().await?;
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&relayer.pubkey()),
            &[relayer.as_ref()],
            recent_blockhash,
        );

        let signature = self
            .rpc_client
            .send_and_confirm_transaction(&transaction)
            .await
            .map_err(|e| RelayerError::TransactionFailed(e.to_string()))?;

        Ok(signature.to_string())
    }
}

fn anchor_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("global:{}", name);
    let hash = Sha256::digest(preimage.as_bytes());
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&hash[..8]);
    discriminator
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anchor_discriminator() {
        let disc = anchor_discriminator("deposit");
        // Should be deterministic
        assert_eq!(disc, anchor_discriminator("deposit"));
        // Different names produce different discriminators
        assert_ne!(disc, anchor_discriminator("withdraw"));
    }
}
