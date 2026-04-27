/// Off-chain merkle tree verification against on-chain commitment records
/// M-09 FIX: Enables trustless verification of relayer's merkle tree construction
use solana_client::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;

use crate::error::{RelayerError, Result};
use privacy_proxy_sdk::merkle::MerkleTree;

/// On-chain commitment record structure (must match program)
#[derive(Debug, Clone)]
pub struct CommitmentRecord {
    pub commitment: [u8; 32],
    pub pool: Pubkey,
    pub leaf_index: u64,
    pub merkle_root_after: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

impl CommitmentRecord {
    /// Deserialize from account data
    pub fn try_from_slice(data: &[u8]) -> Result<Self> {
        if data.len() < 8 + 32 + 32 + 8 + 32 + 8 + 1 {
            return Err(RelayerError::Internal("Invalid commitment record size".into()));
        }

        let mut offset = 8; // Skip discriminator

        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut pool_bytes = [0u8; 32];
        pool_bytes.copy_from_slice(&data[offset..offset + 32]);
        let pool = Pubkey::new_from_array(pool_bytes);
        offset += 32;

        let leaf_index = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let mut merkle_root_after = [0u8; 32];
        merkle_root_after.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let created_at = i64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let bump = data[offset];

        Ok(Self {
            commitment,
            pool,
            leaf_index,
            merkle_root_after,
            created_at,
            bump,
        })
    }
}

/// Merkle tree verifier
pub struct MerkleVerifier {
    rpc_client: RpcClient,
    program_id: Pubkey,
}

impl MerkleVerifier {
    pub fn new(rpc_url: String, program_id: Pubkey) -> Self {
        let rpc_client = RpcClient::new_with_commitment(rpc_url, CommitmentConfig::confirmed());
        Self {
            rpc_client,
            program_id,
        }
    }

    /// Fetch all commitment records for a pool
    pub async fn fetch_commitment_records(
        &self,
        pool_pubkey: &Pubkey,
    ) -> Result<Vec<CommitmentRecord>> {
        // Derive commitment record PDAs
        // Seeds: [b"commitment", pool.key(), leaf_index.to_le_bytes()]
        
        let mut records = Vec::new();
        let mut leaf_index = 0u64;

        // Fetch records until we hit a non-existent account
        loop {
            let (commitment_pda, _) = Pubkey::find_program_address(
                &[
                    b"commitment",
                    pool_pubkey.as_ref(),
                    &leaf_index.to_le_bytes(),
                ],
                &self.program_id,
            );

            match self.rpc_client.get_account(&commitment_pda) {
                Ok(account) => {
                    let record = CommitmentRecord::try_from_slice(&account.data)?;
                    records.push(record);
                    leaf_index += 1;
                }
                Err(_) => {
                    // No more records
                    break;
                }
            }

            // Safety limit to prevent infinite loops
            if leaf_index > 1_000_000 {
                return Err(RelayerError::Internal(
                    "Too many commitment records".into(),
                ));
            }
        }

        Ok(records)
    }

    /// Verify merkle tree construction against on-chain commitment records
    pub async fn verify_merkle_tree(
        &self,
        pool_pubkey: &Pubkey,
        tree_depth: usize,
    ) -> Result<bool> {
        // 1. Fetch all commitment records
        let mut records = self.fetch_commitment_records(pool_pubkey).await?;
        
        if records.is_empty() {
            tracing::info!("No commitment records found for pool {}", pool_pubkey);
            return Ok(true);
        }

        // 2. Sort by leaf index
        records.sort_by_key(|r| r.leaf_index);

        // 3. Reconstruct merkle tree
        let mut tree = MerkleTree::new(tree_depth)
            .map_err(|e| RelayerError::MerkleTree(e.to_string()))?;

        for record in &records {
            // Insert commitment
            let _index = tree.insert(record.commitment)
                .map_err(|e| RelayerError::MerkleTree(e.to_string()))?;

            // Verify root matches
            let computed_root = tree.root()
                .map_err(|e| RelayerError::MerkleTree(e.to_string()))?;
            
            if computed_root != record.merkle_root_after {
                tracing::error!(
                    "Merkle root mismatch at leaf index {}",
                    record.leaf_index
                );
                tracing::error!("  Expected: {:?}", &record.merkle_root_after[..8]);
                tracing::error!("  Computed: {:?}", &computed_root[..8]);
                return Ok(false);
            }
        }

        // 4. Verify current pool root
        let pool_account = self
            .rpc_client
            .get_account(pool_pubkey)
            .map_err(|e| RelayerError::Internal(format!("Failed to fetch pool: {}", e)))?;

        // Parse pool merkle root (offset 41 in DepositPool)
        // 8 (discriminator) + 1 (bucket_id) + 8 (amount_lamports) + 32 (merkle_root)
        if pool_account.data.len() < 49 {
            return Err(RelayerError::Internal("Invalid pool account size".into()));
        }

        let mut pool_root = [0u8; 32];
        pool_root.copy_from_slice(&pool_account.data[17..49]);

        let computed_root = tree.root()
            .map_err(|e| RelayerError::MerkleTree(e.to_string()))?;
        
        if computed_root != pool_root {
            tracing::error!("Current pool root does not match computed root");
            tracing::error!("  Pool root: {:?}", &pool_root[..8]);
            tracing::error!("  Computed:  {:?}", &computed_root[..8]);
            return Ok(false);
        }

        tracing::info!(
            "✓ Merkle tree verified for pool {} ({} commitments)",
            pool_pubkey,
            records.len()
        );

        Ok(true)
    }

    /// Verify a specific commitment exists on-chain
    pub async fn verify_commitment_exists(
        &self,
        pool_pubkey: &Pubkey,
        leaf_index: u64,
        expected_commitment: &[u8; 32],
    ) -> Result<bool> {
        let (commitment_pda, _) = Pubkey::find_program_address(
            &[
                b"commitment",
                pool_pubkey.as_ref(),
                &leaf_index.to_le_bytes(),
            ],
            &self.program_id,
        );

        match self.rpc_client.get_account(&commitment_pda) {
            Ok(account) => {
                let record = CommitmentRecord::try_from_slice(&account.data)?;
                Ok(&record.commitment == expected_commitment)
            }
            Err(_) => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commitment_record_deserialization() {
        let mut data = vec![0u8; 153];
        
        // Discriminator
        data[0..8].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        
        // Commitment
        let commitment = [9u8; 32];
        data[8..40].copy_from_slice(&commitment);
        
        // Pool
        let pool = Pubkey::new_unique();
        data[40..72].copy_from_slice(pool.as_ref());
        
        // Leaf index
        data[72..80].copy_from_slice(&42u64.to_le_bytes());
        
        // Merkle root after
        let root = [10u8; 32];
        data[80..112].copy_from_slice(&root);
        
        // Created at
        data[112..120].copy_from_slice(&1234567890i64.to_le_bytes());
        
        // Bump
        data[120] = 255;

        let record = CommitmentRecord::try_from_slice(&data).unwrap();
        
        assert_eq!(record.commitment, commitment);
        assert_eq!(record.pool, pool);
        assert_eq!(record.leaf_index, 42);
        assert_eq!(record.merkle_root_after, root);
        assert_eq!(record.created_at, 1234567890);
        assert_eq!(record.bump, 255);
    }
}
