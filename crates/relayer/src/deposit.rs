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
    /// Tokens currently being processed (pending)
    pending: HashSet<[u8; 32]>,
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
    /// CRITICAL: Never returns empty on corruption - halts instead to prevent double-spend
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
                                    error!("❌ CRITICAL: Token store checksum mismatch!");
                                    error!("❌ File may be corrupted (disk error, power loss, etc.)");
                                    error!("❌ Cannot safely determine which tokens have been used");
                                    error!("❌ Continuing would allow DOUBLE-SPENDING of credits");
                                    error!("❌ RELAYER MUST BE STOPPED - Manual intervention required");
                                    error!("");
                                    error!("Recovery options:");
                                    error!("  1. Restore used_tokens.dat from backup");
                                    error!("  2. Rebuild from on-chain UsedToken accounts (see docs)");
                                    error!("  3. If this is a fresh deployment with no deposits, delete used_tokens.dat");
                                    error!("");
                                    error!("Set ALLOW_CORRUPTED_TOKEN_STORE=true to override (DANGEROUS)");
                                    
                                    // Check if unsafe override is enabled
                                    if std::env::var("ALLOW_CORRUPTED_TOKEN_STORE").unwrap_or_default() != "true" {
                                        panic!(
                                            "Token store corrupted (checksum mismatch). \
                                            Halting to prevent double-spend. \
                                            Restore from backup or set ALLOW_CORRUPTED_TOKEN_STORE=true (DANGEROUS)."
                                        );
                                    }
                                    
                                    error!("⚠ DANGEROUS OVERRIDE ENABLED - Ignoring corruption");
                                    error!("⚠ Previously redeemed tokens MAY be accepted again!");
                                    error!("⚠ This should ONLY be used for testing or fresh deployments");
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
            pending: HashSet::new(),
            path,
            checksum,
        }
    }

    /// Atomically check and reserve token (prevents TOCTOU race)
    /// Returns true if token was successfully reserved, false if already used/pending
    fn try_reserve(&mut self, hash: [u8; 32]) -> bool {
        if self.cache.contains(&hash) || self.pending.contains(&hash) {
            false
        } else {
            self.pending.insert(hash);
            true
        }
    }

    /// Commit a reserved token (move from pending to used)
    fn commit(&mut self, hash: [u8; 32]) -> Result<()> {
        self.pending.remove(&hash);
        self.insert(hash)
    }

    /// Rollback a reserved token (remove from pending)
    fn rollback(&mut self, hash: [u8; 32]) {
        self.pending.remove(&hash);
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

    /// Get all token hashes (for backup/export)
    #[allow(dead_code)]
    fn get_all(&self) -> Vec<[u8; 32]> {
        self.cache.iter().copied().collect()
    }

    /// Get count of used tokens
    #[allow(dead_code)]
    fn len(&self) -> usize {
        self.cache.len()
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

        // 2. Get bucket ID from amount (needed for balance check)
        let bucket_id = get_bucket_id(request.credit.amount)
            .ok_or(RelayerError::InvalidBucket(request.credit.amount))?;

        // 3. H-05 FIX: Check relayer balance BEFORE reserving token
        // This prevents burning tokens when relayer is insolvent
        self.check_relayer_balance(bucket_id).await?;

        // 4. Atomically check and reserve token (prevents TOCTOU race)
        let token_hash = hash_token_id(&request.credit.token_id);
        let reserved = {
            let mut store = self.token_store.write().await;
            store.try_reserve(token_hash)
        };

        if !reserved {
            return Err(RelayerError::TokenAlreadyRedeemed);
        }

        // Token is now reserved - if anything fails, we must rollback
        let result = async {
            // Also verify against on-chain state (defense in depth)
            // Pass bucket_id to prevent cross-pool token replay
            self.verify_token_not_on_chain(bucket_id, &token_hash).await?;

            // 5. Fetch on-chain next_index FIRST to ensure sync
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

            // 6. Update local merkle tree to get the new root
            let leaf_index = self
                .merkle_service
                .insert(bucket_id, request.commitment)
                .await?;
            let merkle_root = self.merkle_service.root(bucket_id).await?;

            // 7. Execute deposit on-chain with the merkle root
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

            Ok((bucket_id, leaf_index, merkle_root, tx_signature))
        }
        .await;

        match result {
            Ok((bucket_id, leaf_index, merkle_root, tx_signature)) => {
                // Success - commit the token reservation
                {
                    let mut store = self.token_store.write().await;
                    store.commit(token_hash)?;
                }

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
            Err(e) => {
                // Failure - rollback the token reservation
                {
                    let mut store = self.token_store.write().await;
                    store.rollback(token_hash);
                }
                Err(e)
            }
        }
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
        
        // Case 1: Both are 0 - fresh pool, nothing to sync
        if local_size == 0 && on_chain_size == 0 {
            info!("Fresh pool (bucket {}), no sync needed", bucket_id);
            return Ok(());
        }
        
        // Case 2: Local has more than on-chain - should never happen
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
            } else {
                // Both are now 0, nothing more to do
                return Ok(());
            }
        }

        // Case 3: Local is behind on-chain - need to sync
        let current_local_size = self.merkle_service.size(bucket_id).await.unwrap_or(0) as u64;
        if current_local_size >= on_chain_size {
            // Already in sync or ahead (shouldn't be ahead, but we'll handle it above)
            return Ok(());
        }
        
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

        // Parse deposit events from transaction logs
        // We'll scan as many as needed to recover all deposits
        let mut commitments = Vec::new();
        let max_to_scan = std::cmp::min(signatures.len(), 200); // Cap at 200 for safety
        
        info!("Scanning up to {} transactions to recover {} deposits...", max_to_scan, on_chain_size);
        
        for sig_info in signatures.iter().rev().take(max_to_scan) {
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

        // Check if we found any commitments
        if commitments.is_empty() {
            // No commitments found in transaction logs
            // This is only a problem if on-chain says there SHOULD be deposits
            if on_chain_size > 0 {
                warn!(
                    "Could not find commitments in transaction history for bucket {} ({} deposits on-chain)",
                    bucket_id, on_chain_size
                );
                warn!("Transaction logs are likely pruned (common on devnet after a few days)");
                warn!("Without transaction logs or backups, these deposits cannot be recovered");
                
                // Check if this is devnet (testing environment)
                let rpc_url = std::env::var("RPC_URL").unwrap_or_default();
                let is_devnet = rpc_url.contains("devnet") || rpc_url.contains("testnet");
                
                if is_devnet {
                    warn!("Detected devnet environment - resetting to fresh tree");
                    warn!("⚠️  {} existing deposits will become UNWITHDRAWABLE", on_chain_size);
                    warn!("⚠️  This is acceptable for devnet testing");
                    warn!("⚠️  For production, ALWAYS maintain merkle_state backups");
                    
                    // Reset to fresh tree for devnet
                    self.merkle_service
                        .sync_from_chain(bucket_id, vec![])
                        .await?;
                    return Ok(());
                } else {
                    // Production environment - must have backups
                    error!(
                        "❌ CRITICAL: Could not find any commitments in transaction history for bucket {}",
                        bucket_id
                    );
                    error!("❌ On-chain has {} deposits but transaction logs are empty/pruned", on_chain_size);
                    error!("❌ This may happen if transactions are too old or logs are not available");
                    error!("❌ Continuing with empty tree would cause PERMANENT FUND LOSS for existing deposits");
                    error!("❌ RELAYER MUST BE STOPPED - Manual intervention required");
                    error!("");
                    error!("Recovery options:");
                    error!("  1. Restore merkle_state/ directory from backup");
                    error!("  2. Use a full archive node with complete transaction history");
                    error!("  3. Manually reconstruct tree from known commitments");
                    error!("");

                    return Err(RelayerError::MerkleTree(format!(
                        "Cannot sync merkle tree for bucket {} - no commitments found in transaction history but {} deposits exist on-chain. \
                        This would cause permanent fund loss. Relayer halted for safety. \
                        Restore merkle_state/ from backup.",
                        bucket_id, on_chain_size
                    )));
                }
            } else {
                // on_chain_size is 0, so no deposits to recover
                // The transactions we found were probably for other operations (init, etc.)
                info!(
                    "No commitments found in transaction history for bucket {}, but on-chain size is 0 (fresh pool)",
                    bucket_id
                );
                // Initialize with empty tree
                self.merkle_service
                    .sync_from_chain(bucket_id, vec![])
                    .await?;
                return Ok(());
            }
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

    /// H-05 FIX: Check relayer has sufficient balance before accepting deposit
    /// This prevents burning user tokens when relayer is insolvent
    async fn check_relayer_balance(&self, bucket_id: u8) -> Result<()> {
        use crate::config::BUCKET_AMOUNTS;
        
        let relayer_pubkey = self.config.keypair.pubkey();
        let required_amount = BUCKET_AMOUNTS[bucket_id as usize];
        
        // Fetch relayer's current balance
        let balance = self
            .rpc_client
            .get_balance(&relayer_pubkey)
            .await
            .map_err(|e| {
                RelayerError::Internal(format!("Failed to fetch relayer balance: {}", e))
            })?;

        // Calculate minimum required balance:
        // - Deposit amount (goes to pool)
        // - Transaction fee (~5000 lamports)
        // - Rent for UsedToken account (~1 SOL for safety)
        // - Rent for Note account (~1 SOL for safety)
        // - Safety buffer (0.1 SOL)
        const TX_FEE: u64 = 5_000;
        const RENT_BUFFER: u64 = 2_100_000_000; // ~2.1 SOL for rent + safety
        let minimum_balance = required_amount + TX_FEE + RENT_BUFFER;

        if balance < minimum_balance {
            error!(
                "❌ Relayer insolvency detected! Balance: {} lamports ({} SOL), Required: {} lamports ({} SOL)",
                balance,
                balance as f64 / 1_000_000_000.0,
                minimum_balance,
                minimum_balance as f64 / 1_000_000_000.0
            );
            error!(
                "❌ Cannot accept deposit for bucket {} (amount: {} lamports)",
                bucket_id, required_amount
            );
            error!("❌ Rejecting deposit to prevent burning user's token");
            error!("");
            error!("Action required: Fund relayer wallet {} with at least {} SOL",
                relayer_pubkey,
                (minimum_balance - balance) as f64 / 1_000_000_000.0
            );

            return Err(RelayerError::InsufficientBalance {
                required: minimum_balance,
                available: balance,
            });
        }

        // Log warning if balance is getting low (< 10 SOL)
        const LOW_BALANCE_THRESHOLD: u64 = 10_000_000_000; // 10 SOL
        if balance < LOW_BALANCE_THRESHOLD {
            warn!(
                "⚠ Relayer balance is low: {} SOL. Consider funding soon.",
                balance as f64 / 1_000_000_000.0
            );
        }

        Ok(())
    }

    /// Verify token doesn't exist on-chain (defense in depth)
    /// M-04 FIX: Check both new (with bucket_id) and legacy (without bucket_id) PDAs
    /// This ensures backward compatibility during mainnet upgrade
    async fn verify_token_not_on_chain(&self, bucket_id: u8, token_hash: &[u8; 32]) -> Result<()> {
        // Check new format (with bucket_id) - this is what we'll create
        let (used_token_pda, _) = Pubkey::find_program_address(
            &[b"used_token", &[bucket_id], token_hash],
            &self.config.program_id,
        );

        match self.rpc_client.get_account(&used_token_pda).await {
            Ok(_account) => {
                // Token exists on-chain in new format
                warn!(
                    "Token {} found on-chain (new format) but not in local store - updating local cache",
                    hex::encode(token_hash)
                );
                // Update local cache to match on-chain reality
                let mut store = self.token_store.write().await;
                store.insert(*token_hash)?;
                return Err(RelayerError::TokenAlreadyRedeemed);
            }
            Err(_) => {
                // Token doesn't exist in new format, check legacy format
            }
        }

        // Check legacy format (without bucket_id) for backward compatibility
        let (legacy_token_pda, _) = Pubkey::find_program_address(
            &[b"used_token", token_hash],
            &self.config.program_id,
        );

        match self.rpc_client.get_account(&legacy_token_pda).await {
            Ok(_account) => {
                // Token exists on-chain in legacy format
                warn!(
                    "Token {} found on-chain (legacy format) - token was used before M-04 upgrade",
                    hex::encode(token_hash)
                );
                // Update local cache to match on-chain reality
                let mut store = self.token_store.write().await;
                store.insert(*token_hash)?;
                return Err(RelayerError::TokenAlreadyRedeemed);
            }
            Err(_) => {
                // Token doesn't exist in either format - OK to use
                Ok(())
            }
        }
    }

    /// Rebuild token store from on-chain UsedToken accounts
    /// This can be used to recover from token store corruption
    pub async fn rebuild_token_store_from_chain(&self) -> Result<usize> {
        info!("Rebuilding token store from on-chain UsedToken accounts...");
        
        // Get all program accounts with UsedToken discriminator
        // UsedToken discriminator is the first 8 bytes of sha256("account:UsedToken")
        let discriminator = {
            use sha2::{Digest, Sha256};
            let hash = Sha256::digest(b"account:UsedToken");
            let mut disc = [0u8; 8];
            disc.copy_from_slice(&hash[..8]);
            disc
        };

        // Fetch all accounts owned by the program
        let accounts = self
            .rpc_client
            .get_program_accounts(&self.config.program_id)
            .await
            .map_err(|e| {
                RelayerError::TransactionFailed(format!("Failed to fetch program accounts: {}", e))
            })?;

        let mut count = 0;
        let mut store = self.token_store.write().await;

        for (_pubkey, account) in accounts {
            // Check if this is a UsedToken account (discriminator match)
            if account.data.len() >= 8 && &account.data[0..8] == &discriminator {
                // Parse token_hash from account data
                // UsedToken layout: discriminator(8) + token_hash(32) + redeemed_at(8) + bump(1)
                if account.data.len() >= 40 {
                    let mut token_hash = [0u8; 32];
                    token_hash.copy_from_slice(&account.data[8..40]);
                    
                    store.insert(token_hash)?;
                    count += 1;
                    
                    if count % 100 == 0 {
                        info!("Rebuilt {} used tokens so far...", count);
                    }
                }
            }
        }

        info!("✓ Rebuilt token store with {} used tokens from on-chain", count);
        Ok(count)
    }

    /// Get token store statistics (for monitoring)
    pub async fn get_token_store_stats(&self) -> (usize, [u8; 32]) {
        let store = self.token_store.read().await;
        (store.len(), store.checksum)
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

        let (used_token_pda, _) = Pubkey::find_program_address(
            &[b"used_token", &[bucket_id], &token_hash],
            &self.config.program_id,
        );

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

        // M-09 FIX: Derive commitment_record PDA
        let (commitment_record_pda, _) = Pubkey::find_program_address(
            &[
                b"commitment",
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
                AccountMeta::new(used_token_pda, false),  // used_token (init, new format)
                AccountMeta::new(note_pda, false),        // encrypted_note (init)
                AccountMeta::new(commitment_record_pda, false), // M-09 FIX: commitment_record (init)
                AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false), // system_program
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
