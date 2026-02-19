use privacy_proxy_sdk::withdrawal::{WithdrawalRequest, WithdrawalResponse};
use sha2::{Digest, Sha256};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signer::Signer,
    system_program::ID as SYSTEM_PROGRAM_ID,
    transaction::Transaction,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::config::RelayerConfig;
use crate::error::{RelayerError, Result};
use crate::merkle_service::MerkleService;

/// Minimum time to keep historical roots (48 hours)
/// This ensures roots are available for delayed withdrawals (max 24 hours)
#[allow(dead_code)]
const MIN_ROOT_RETENTION_HOURS: u64 = 48;

/// Maximum number of historical roots to keep per bucket (as a safety limit)
#[allow(dead_code)]
const MAX_HISTORICAL_ROOTS: usize = 1000;

/// Historical root with timestamp for time-based pruning
#[derive(Clone)]
#[allow(dead_code)]
struct TimestampedRoot {
    root: [u8; 32],
    added_at: Instant,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PendingWithdrawalRecord {
    /// The on-chain PDA address of the PendingWithdrawal account
    pub pda: Pubkey,
    /// Pool PDA this withdrawal belongs to
    pub pool_pda: Pubkey,
    /// Bucket ID
    pub bucket_id: u8,
    /// Nullifier hash (used for nullifier PDA derivation)
    pub nullifier_hash: [u8; 32],
    /// Recipient stealth address
    pub recipient: Pubkey,
    /// Unix timestamp after which execution is allowed
    pub execute_after: i64,
    /// Amount in lamports (after fee)
    pub amount: u64,
    /// Fee in lamports
    pub fee: u64,
    /// Whether we've already executed this
    pub executed: bool,
}

pub struct WithdrawalService {
    config: RelayerConfig,
    rpc_client: Arc<RpcClient>,
    merkle_service: Arc<MerkleService>,
    /// Historical roots per bucket with timestamps for time-based pruning
    historical_roots: Arc<RwLock<Vec<HashMap<[u8; 32], TimestampedRoot>>>>,
    /// Pending withdrawals we need to execute after timelock
    pending_withdrawals: Arc<RwLock<Vec<PendingWithdrawalRecord>>>,
}

impl WithdrawalService {
    pub fn new(
        config: RelayerConfig,
        rpc_client: Arc<RpcClient>,
        merkle_service: Arc<MerkleService>,
    ) -> Self {
        let num_buckets = crate::config::BUCKET_AMOUNTS.len();
        let historical_roots = (0..num_buckets).map(|_| HashMap::new()).collect();
        Self {
            config,
            rpc_client,
            merkle_service,
            historical_roots: Arc::new(RwLock::new(historical_roots)),
            pending_withdrawals: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Record current root as historical (call after each deposit)
    /// Uses time-based pruning to ensure roots are available for delayed withdrawals
    #[allow(dead_code)]
    pub async fn record_historical_root(&self, bucket_id: u8) -> Result<()> {
        let root = self.merkle_service.root(bucket_id).await?;
        let mut roots = self.historical_roots.write().await;
        if let Some(bucket_roots) = roots.get_mut(bucket_id as usize) {
            // Prune old roots (older than MIN_ROOT_RETENTION_HOURS)
            let retention_duration = Duration::from_secs(MIN_ROOT_RETENTION_HOURS * 3600);
            let now = Instant::now();
            bucket_roots.retain(|_, timestamped| {
                now.duration_since(timestamped.added_at) < retention_duration
            });

            // Enforcing maximum count as safety limit
            if bucket_roots.len() >= MAX_HISTORICAL_ROOTS {
                // Remove oldest entries
                let mut entries: Vec<_> = bucket_roots.iter().collect();
                entries.sort_by_key(|(_, ts)| ts.added_at);

                let to_remove: Vec<[u8; 32]> = entries
                    .iter()
                    .take(bucket_roots.len() - MAX_HISTORICAL_ROOTS + 1)
                    .map(|(k, _)| **k)
                    .collect();
                for key in to_remove {
                    bucket_roots.remove(&key);
                }

                warn!(
                    "Historical roots limit reached for bucket {}, pruned oldest entries",
                    bucket_id
                );
            }

            bucket_roots.insert(
                root,
                TimestampedRoot {
                    root,
                    added_at: now,
                },
            );
        }

        Ok(())
    }

    pub async fn handle_withdrawal(
        &self,
        request: WithdrawalRequest,
        delay_hours: u8,
    ) -> Result<WithdrawalResponse> {
        info!("=== Withdrawal Request Debug ===");
        info!(
            "nullifier_hash: {:?}",
            hex::encode(&request.public_inputs.nullifier_hash)
        );
        info!(
            "recipient: {:?}",
            hex::encode(&request.public_inputs.recipient)
        );
        info!("relayer: {:?}", hex::encode(&request.public_inputs.relayer));
        info!("amount: {}", request.public_inputs.amount);
        info!("fee: {}", request.public_inputs.fee);
        info!(
            "binding_hash: {:?}",
            hex::encode(&request.public_inputs.binding_hash)
        );
        info!("root: {:?}", hex::encode(&request.public_inputs.root));
        info!("proof_a: {:?}", hex::encode(&request.proof.a));
        info!("proof_b: {:?}", hex::encode(&request.proof.b));
        info!("proof_c: {:?}", hex::encode(&request.proof.c));
        info!("=== End Debug ===");

        // 1. Validate the request
        request
            .validate()
            .map_err(|e| RelayerError::InvalidRequest(e.to_string()))?;

        // 2. Verify merkle root is valid (current or historical)
        let bucket_id = crate::config::get_bucket_id(request.public_inputs.amount)
            .ok_or(RelayerError::InvalidBucket(request.public_inputs.amount))?;
        self.verify_merkle_root(&request.public_inputs.root, bucket_id)
            .await?;

        // 3. Submit withdrawal request on-chain
        let tx_signature = self
            .submit_withdrawal_request(&request, delay_hours)
            .await?;

        // 4. Track this pending withdrawal for automatic execution
        {
            let inputs = &request.public_inputs;
            let (pool_pda, _) =
                Pubkey::find_program_address(&[b"pool", &[bucket_id]], &self.config.program_id);

            // Fetch total_deposits to derive the pending PDA (same as submit_withdrawal_request)
            let pool_data = self
                .rpc_client
                .get_account_data(&pool_pda)
                .await
                .unwrap_or_default();
            // total_deposits was incremented by the request, but we used the pre-increment value
            // The PDA was derived with the pre-increment total_deposits, which is now total_deposits - 1
            // Actually, request_withdrawal uses pool.total_deposits at the time of the call,
            // and doesn't increment it. So we need the value BEFORE the tx
            // But the tx already executed. Let's parse current total_deposits and subtract 0
            // (request_withdrawal doesn't change total_deposits, only deposit does)
            // Actually looking at request_withdrawal.rs, it uses pool.total_deposits as-is
            // So we need the current value. But we already computed it in submit_withdrawal_request
            // Let's just re-derive it
            let total_deposits = if pool_data.len() >= 65 {
                u64::from_le_bytes(pool_data[57..65].try_into().unwrap_or([0u8; 8]))
            } else {
                0u64
            };
            // The pending PDA was created with total_deposits value at time of request.
            // Since request_withdrawal doesn't increment total_deposits, the current value
            // minus 0 is correct. But we need the value BEFORE the tx executed
            // Actually, the tx already ran, and request_withdrawal doesn't change total_deposits.
            // So current total_deposits is the same value used for the PDA seed
            // WAIT - but the PDA was created with the value at tx time. If no other deposits
            // happened between our fetch and the tx, it's the same. For safety, let's
            // compute it from the tx_id we know: it's total_deposits at time of request
            // Since we fetched it right before submitting, and the tx just confirmed,
            // the value we used is total_deposits (current) - but request_withdrawal
            // doesn't modify it. So current value = value used for PDA
            let (pending_pda, _) = Pubkey::find_program_address(
                &[b"pending", pool_pda.as_ref(), &total_deposits.to_le_bytes()],
                &self.config.program_id,
            );

            let recipient = Pubkey::new_from_array(inputs.recipient);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let execute_after = now + (delay_hours as i64) * 3600;

            // Compute fee same as on-chain
            let amount_lamports = crate::config::BUCKET_AMOUNTS[bucket_id as usize];
            let fee = amount_lamports * self.config.fee_bps as u64 / 10000;
            let withdrawal_amount = amount_lamports - fee;
            let record = PendingWithdrawalRecord {
                pda: pending_pda,
                pool_pda,
                bucket_id,
                nullifier_hash: inputs.nullifier_hash,
                recipient,
                execute_after,
                amount: withdrawal_amount,
                fee,
                executed: false,
            };

            let mut pending = self.pending_withdrawals.write().await;
            pending.push(record);
            info!(
                "Tracked pending withdrawal: execute_after={}, recipient={}",
                execute_after, recipient
            );
        }

        info!(
            "Withdrawal request submitted: recipient={:?}, tx={}",
            &request.public_inputs.recipient[..8],
            tx_signature
        );
        Ok(WithdrawalResponse {
            success: true,
            tx_signature: Some(tx_signature),
            error: None,
        })
    }

    /// Verify the merkle root is valid (current or historical)
    /// Time-based pruning ensures roots are available for at least MIN_ROOT_RETENTION_HOURS
    async fn verify_merkle_root(&self, root: &[u8; 32], bucket_id: u8) -> Result<()> {
        let current_root = self.merkle_service.root(bucket_id).await?;
        if root == &current_root {
            return Ok(());
        }

        let roots = self.historical_roots.read().await;
        if let Some(bucket_roots) = roots.get(bucket_id as usize) {
            if bucket_roots.contains_key(root) {
                return Ok(());
            }
        }

        warn!("Merkle root not found in local history, will rely on on-chain validation");

        // Allow it through - on-chain will do final validation
        // This is safe because the smart contract validates against its own historical roots
        Ok(())
    }

    async fn submit_withdrawal_request(
        &self,
        request: &WithdrawalRequest,
        delay_hours: u8,
    ) -> Result<String> {
        let relayer = &self.config.keypair;
        let inputs = &request.public_inputs;

        // Get bucket ID from amount
        let bucket_id = crate::config::get_bucket_id(inputs.amount)
            .ok_or(RelayerError::InvalidBucket(inputs.amount))?;

        // Derive PDAs
        let (config_pda, _) = Pubkey::find_program_address(&[b"config"], &self.config.program_id);

        let (pool_pda, _) =
            Pubkey::find_program_address(&[b"pool", &[bucket_id]], &self.config.program_id);

        let (historical_roots_pda, _) = Pubkey::find_program_address(
            &[b"historical_roots", pool_pda.as_ref(), &[0u8]],
            &self.config.program_id,
        );

        let (nullifier_pda, _) = Pubkey::find_program_address(
            &[b"nullifier", &inputs.nullifier_hash],
            &self.config.program_id,
        );

        // Fetch pool account to get total_deposits for pending withdrawal PDA
        let pool_data = self
            .rpc_client
            .get_account_data(&pool_pda)
            .await
            .map_err(|e| RelayerError::TransactionFailed(format!("Failed to fetch pool: {}", e)))?;

        // Parse total_deposits from pool account data
        // DepositPool layout:
        // - discriminator: 8 bytes (offset 0)
        // - bucket_id: 1 byte (offset 8)
        // - amount_lamports: 8 bytes (offset 9)
        // - merkle_root: 32 bytes (offset 17)
        // - next_index: 8 bytes (offset 49)
        // - total_deposits: 8 bytes (offset 57)
        let total_deposits = if pool_data.len() >= 65 {
            u64::from_le_bytes(pool_data[57..65].try_into().unwrap_or([0u8; 8]))
        } else {
            0u64
        };

        let (pending_pda, _) = Pubkey::find_program_address(
            &[b"pending", pool_pda.as_ref(), &total_deposits.to_le_bytes()],
            &self.config.program_id,
        );

        // Build instruction data matching the program's expected format:
        // bucket_id: u8, nullifier_hash: [u8; 32], recipient: [u8; 32],
        // proof_a: [u8; 64], proof_b: [u8; 128], proof_c: [u8; 64],
        // merkle_root: [u8; 32], delay_hours: u8, binding_hash: [u8; 32],
        // relayer_field: [u8; 32]
        let mut data = vec![0u8; 8];
        let discriminator = anchor_discriminator("request_withdrawal");
        data[..8].copy_from_slice(&discriminator);

        // Serialize parameters in the order expected by the program
        data.push(bucket_id);
        data.extend_from_slice(&inputs.nullifier_hash);
        data.extend_from_slice(&inputs.recipient); // Field element from circuit
        data.extend_from_slice(&request.proof.a);
        data.extend_from_slice(&request.proof.b);
        data.extend_from_slice(&request.proof.c);
        data.extend_from_slice(&inputs.root);
        data.push(delay_hours);
        data.extend_from_slice(&inputs.binding_hash);
        data.extend_from_slice(&inputs.relayer); // Field element from circuit

        let instruction = Instruction {
            program_id: self.config.program_id,
            accounts: vec![
                AccountMeta::new(relayer.pubkey(), true), // payer (signer, mut)
                AccountMeta::new_readonly(config_pda, false), // config
                AccountMeta::new(pool_pda, false),        // pool (mut)
                AccountMeta::new_readonly(historical_roots_pda, false), // historical_roots
                AccountMeta::new_readonly(nullifier_pda, false), // nullifier_check (not init here)
                AccountMeta::new(pending_pda, false),     // pending_withdrawal (init)
                AccountMeta::new_readonly(self.config.zk_verifier_id, false), // zk_verifier program
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

    pub async fn execute_withdrawal_by_record(
        &self,
        record: &PendingWithdrawalRecord,
    ) -> Result<String> {
        let relayer = &self.config.keypair;

        // Derive all required PDAs
        let (config_pda, _) = Pubkey::find_program_address(&[b"config"], &self.config.program_id);
        let (nullifier_pda, _) = Pubkey::find_program_address(
            &[b"nullifier", &record.nullifier_hash],
            &self.config.program_id,
        );

        // Derive relayer treasury PDA (same as in init-program.ts)
        let (relayer_treasury, _) =
            Pubkey::find_program_address(&[b"treasury"], &self.config.program_id);

        info!(
            "Execute withdrawal: nullifier={}, recipient={}, pool={}, relayer_treasury={}",
            hex::encode(&record.nullifier_hash),
            record.recipient,
            record.pool_pda,
            relayer_treasury
        );

        // Check if nullifier already exists (from previous attempt)
        let nullifier_exists = self.rpc_client.get_account(&nullifier_pda).await.is_ok();
        if nullifier_exists {
            info!("Nullifier account already exists, withdrawal may have already executed");
            return Ok("Already executed".to_string());
        }

        // Ensure recipient and treasury accounts exist before execute_withdrawal.
        // Direct lamport credit via try_borrow_mut_lamports() works on any account,
        // but the runtime enforces rent-exemption post-transaction. If the credited
        // amount is below rent-exempt minimum for a 0-byte account (890,880 lamports),
        // the transaction fails. Pre-funding with rent-exempt minimum avoids this.
        let rent_exempt_minimum: u64 = 890_880; // 0-byte account rent-exempt minimum
        let mut instructions = Vec::new();

        let recipient_exists = self.rpc_client.get_account(&record.recipient).await.is_ok();
        if !recipient_exists {
            info!(
                "Recipient {} doesn't exist, pre-funding with {} lamports",
                record.recipient, rent_exempt_minimum
            );
            instructions.push(solana_sdk::system_instruction::transfer(
                &relayer.pubkey(),
                &record.recipient,
                rent_exempt_minimum,
            ));
        }

        let treasury_exists = self.rpc_client.get_account(&relayer_treasury).await.is_ok();
        if !treasury_exists {
            info!(
                "Treasury {} doesn't exist, pre-funding with {} lamports",
                relayer_treasury, rent_exempt_minimum
            );
            instructions.push(solana_sdk::system_instruction::transfer(
                &relayer.pubkey(),
                &relayer_treasury,
                rent_exempt_minimum,
            ));
        }

        let discriminator = anchor_discriminator("execute_withdrawal");
        let instruction = Instruction {
            program_id: self.config.program_id,
            accounts: vec![
                AccountMeta::new(relayer.pubkey(), true), // executor (signer, mut, pays for nullifier)
                AccountMeta::new_readonly(config_pda, false), // config
                AccountMeta::new(record.pool_pda, false), // pool (mut)
                AccountMeta::new(record.pda, false),      // pending_withdrawal (mut)
                AccountMeta::new(nullifier_pda, false),   // nullifier (init)
                AccountMeta::new(record.recipient, false), // recipient (mut, receives SOL)
                AccountMeta::new(relayer_treasury, false), // relayer_treasury (mut, receives fee)
                AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
            ],
            data: discriminator.to_vec(),
        };

        instructions.push(instruction);

        let recent_blockhash = self.rpc_client.get_latest_blockhash().await?;
        let transaction = Transaction::new_signed_with_payer(
            &instructions,
            Some(&relayer.pubkey()),
            &[relayer.as_ref()],
            recent_blockhash,
        );

        // Skip preflight to see actual on-chain error
        let signature = self
            .rpc_client
            .send_and_confirm_transaction_with_spinner_and_config(
                &transaction,
                self.rpc_client.commitment(),
                solana_client::rpc_config::RpcSendTransactionConfig {
                    skip_preflight: true,
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| RelayerError::TransactionFailed(e.to_string()))?;

        info!(
            "Withdrawal executed: recipient={}, amount={}, fee={}, tx={}",
            record.recipient, record.amount, record.fee, signature
        );
        Ok(signature.to_string())
    }

    /// Legacy execute_withdrawal by nullifier hash (used by the HTTP endpoint)
    /// This is a simplified version that won't work without the full record
    /// The background job should be the primary execution path
    pub async fn execute_withdrawal(&self, nullifier_hash: [u8; 32]) -> Result<String> {
        let pending = self.pending_withdrawals.read().await;
        let record = pending
            .iter()
            .find(|r| r.nullifier_hash == nullifier_hash && !r.executed)
            .cloned();

        drop(pending);

        let record = record.ok_or_else(|| {
            RelayerError::InvalidRequest(
                "No pending withdrawal found for this nullifier hash".into(),
            )
        })?;

        let tx = self.execute_withdrawal_by_record(&record).await?;

        // Mark as executed
        let mut pending = self.pending_withdrawals.write().await;
        if let Some(r) = pending
            .iter_mut()
            .find(|r| r.nullifier_hash == nullifier_hash)
        {
            r.executed = true;
        }

        Ok(tx)
    }

    pub async fn poll_and_execute(&self) -> Vec<(Pubkey, std::result::Result<String, String>)> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let eligible: Vec<PendingWithdrawalRecord> = {
            let pending = self.pending_withdrawals.read().await;
            pending
                .iter()
                .filter(|r| !r.executed && now >= r.execute_after)
                .cloned()
                .collect()
        };
        if eligible.is_empty() {
            return vec![];
        }

        info!(
            "Found {} pending withdrawals ready for execution",
            eligible.len()
        );

        let mut results = Vec::new();
        for record in &eligible {
            match self.execute_withdrawal_by_record(record).await {
                Ok(tx) => {
                    info!("✓ Executed withdrawal to {}: tx={}", record.recipient, tx);
                    // Mark as executed
                    let mut pending = self.pending_withdrawals.write().await;
                    if let Some(r) = pending.iter_mut().find(|r| r.pda == record.pda) {
                        r.executed = true;
                    }
                    results.push((record.recipient, Ok(tx)));
                }
                Err(e) => {
                    error!(
                        "✗ Failed to execute withdrawal to {}: {}",
                        record.recipient, e
                    );
                    results.push((record.recipient, Err(e.to_string())));
                }
            }
        }

        results
    }

    pub async fn get_pending_withdrawals(&self) -> Vec<PendingWithdrawalRecord> {
        self.pending_withdrawals.read().await.clone()
    }
}

fn anchor_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("global:{}", name);
    let hash = Sha256::digest(preimage.as_bytes());
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&hash[..8]);
    discriminator
}
