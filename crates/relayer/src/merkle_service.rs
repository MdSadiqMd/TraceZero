use privacy_proxy_sdk::merkle::{MerkleProof, MerkleTree, TREE_DEPTH};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::error::{RelayerError, Result};

#[derive(Serialize, Deserialize)]
struct TreeState {
    commitments: Vec<[u8; 32]>,
    checksum: [u8; 32],
}

impl TreeState {
    fn compute_checksum(commitments: &[[u8; 32]]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"merkle_tree_state_v1:");
        hasher.update(&(commitments.len() as u64).to_le_bytes());
        for commitment in commitments {
            hasher.update(commitment);
        }
        let result = hasher.finalize();

        let mut checksum = [0u8; 32];
        checksum.copy_from_slice(&result);
        checksum
    }

    fn new(commitments: Vec<[u8; 32]>) -> Self {
        let checksum = Self::compute_checksum(&commitments);
        Self {
            commitments,
            checksum,
        }
    }

    fn verify(&self) -> bool {
        Self::compute_checksum(&self.commitments) == self.checksum
    }
}

/// Merkle tree service managing trees for all pools
pub struct MerkleService {
    trees: Arc<RwLock<HashMap<u8, MerkleTree>>>,
    commitments: Arc<RwLock<HashMap<u8, Vec<[u8; 32]>>>>,
    persistence_path: PathBuf,
}

impl MerkleService {
    pub fn new() -> Self {
        let persistence_path = std::env::var("MERKLE_STATE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("merkle_state"));
        if let Err(e) = std::fs::create_dir_all(&persistence_path) {
            warn!("Failed to create merkle state directory: {}", e);
        }

        Self {
            trees: Arc::new(RwLock::new(HashMap::new())),
            commitments: Arc::new(RwLock::new(HashMap::new())),
            persistence_path,
        }
    }

    fn state_file_path(&self, bucket_id: u8) -> PathBuf {
        self.persistence_path
            .join(format!("bucket_{}.json", bucket_id))
    }

    async fn load_state(&self, bucket_id: u8) -> Option<Vec<[u8; 32]>> {
        let path = self.state_file_path(bucket_id);
        if !path.exists() {
            return None;
        }

        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str::<TreeState>(&data) {
                Ok(state) if state.verify() => {
                    info!(
                        "Loaded {} commitments for bucket {} (verified)",
                        state.commitments.len(),
                        bucket_id
                    );
                    Some(state.commitments)
                }
                Ok(_) => {
                    error!(
                        "Checksum mismatch for bucket {} - data corrupted",
                        bucket_id
                    );
                    None
                }
                Err(e) => {
                    error!("Failed to parse state for bucket {}: {}", bucket_id, e);
                    None
                }
            },
            Err(e) => {
                error!("Failed to read state for bucket {}: {}", bucket_id, e);
                None
            }
        }
    }

    async fn save_state(&self, bucket_id: u8) -> Result<()> {
        let commitments = self.commitments.read().await;
        let bucket_commitments = commitments.get(&bucket_id).cloned().unwrap_or_default();
        drop(commitments);

        let state = TreeState::new(bucket_commitments);
        let json = serde_json::to_string_pretty(&state)
            .map_err(|e| RelayerError::Internal(format!("Serialize failed: {}", e)))?;

        let path = self.state_file_path(bucket_id);
        let temp_path = path.with_extension("tmp");

        std::fs::write(&temp_path, &json)
            .map_err(|e| RelayerError::Internal(format!("Write failed: {}", e)))?;
        std::fs::rename(&temp_path, &path)
            .map_err(|e| RelayerError::Internal(format!("Rename failed: {}", e)))?;

        Ok(())
    }

    pub async fn init_tree(&self, bucket_id: u8) -> Result<()> {
        {
            let trees = self.trees.read().await;
            if trees.contains_key(&bucket_id) {
                return Ok(());
            }
        }

        let mut tree =
            MerkleTree::new(TREE_DEPTH).map_err(|e| RelayerError::MerkleTree(e.to_string()))?;

        if let Some(saved) = self.load_state(bucket_id).await {
            for commitment in &saved {
                tree.insert(*commitment)
                    .map_err(|e| RelayerError::MerkleTree(e.to_string()))?;
            }
            let mut trees = self.trees.write().await;
            let mut commitments = self.commitments.write().await;
            trees.insert(bucket_id, tree);
            commitments.insert(bucket_id, saved);
            info!("Restored Merkle tree for bucket {} from disk", bucket_id);
        } else {
            let mut trees = self.trees.write().await;
            let mut commitments = self.commitments.write().await;
            trees.insert(bucket_id, tree);
            commitments.insert(bucket_id, Vec::new());
            info!("Initialized new Merkle tree for bucket {}", bucket_id);
        }
        Ok(())
    }

    pub async fn insert(&self, bucket_id: u8, commitment: [u8; 32]) -> Result<u64> {
        let mut trees = self.trees.write().await;
        let mut commitments = self.commitments.write().await;

        let tree = trees.get_mut(&bucket_id).ok_or_else(|| {
            RelayerError::MerkleTree(format!("Tree not initialized: {}", bucket_id))
        })?;

        let index = tree
            .insert(commitment)
            .map_err(|e| RelayerError::MerkleTree(e.to_string()))?;
        commitments.entry(bucket_id).or_default().push(commitment);

        drop(trees);
        drop(commitments);

        if let Err(e) = self.save_state(bucket_id).await {
            error!("Failed to persist state for bucket {}: {}", bucket_id, e);
        }

        info!(
            "Inserted commitment at index {} in bucket {}",
            index, bucket_id
        );
        Ok(index)
    }

    pub async fn root(&self, bucket_id: u8) -> Result<[u8; 32]> {
        let trees = self.trees.read().await;
        let tree = trees.get(&bucket_id).ok_or_else(|| {
            RelayerError::MerkleTree(format!("Tree not initialized: {}", bucket_id))
        })?;
        tree.root()
            .map_err(|e| RelayerError::MerkleTree(e.to_string()))
    }

    pub async fn proof(&self, bucket_id: u8, leaf_index: u64) -> Result<MerkleProof> {
        let trees = self.trees.read().await;
        let tree = trees.get(&bucket_id).ok_or_else(|| {
            RelayerError::MerkleTree(format!("Tree not initialized: {}", bucket_id))
        })?;
        tree.proof(leaf_index)
            .map_err(|e| RelayerError::MerkleTree(e.to_string()))
    }

    #[allow(dead_code)]
    pub async fn verify_proof(
        &self,
        root: &[u8; 32],
        leaf: &[u8; 32],
        proof: &MerkleProof,
    ) -> Result<bool> {
        MerkleTree::verify_proof(root, leaf, proof)
            .map_err(|e| RelayerError::MerkleTree(e.to_string()))
    }

    pub async fn size(&self, bucket_id: u8) -> Result<usize> {
        let trees = self.trees.read().await;
        let tree = trees.get(&bucket_id).ok_or_else(|| {
            RelayerError::MerkleTree(format!("Tree not initialized: {}", bucket_id))
        })?;
        Ok(tree.len())
    }

    pub async fn get_commitments(&self, bucket_id: u8) -> Result<Vec<[u8; 32]>> {
        let commitments = self.commitments.read().await;
        let bucket_commitments = commitments.get(&bucket_id).ok_or_else(|| {
            RelayerError::MerkleTree(format!("Tree not initialized: {}", bucket_id))
        })?;
        Ok(bucket_commitments.clone())
    }

    pub async fn sync_from_chain(
        &self,
        bucket_id: u8,
        on_chain_commitments: Vec<[u8; 32]>,
    ) -> Result<()> {
        let current_size = self.size(bucket_id).await.unwrap_or(0);

        if on_chain_commitments.len() == current_size {
            info!(
                "Bucket {} already in sync ({} commitments)",
                bucket_id, current_size
            );
            return Ok(());
        }

        let mut tree =
            MerkleTree::new(TREE_DEPTH).map_err(|e| RelayerError::MerkleTree(e.to_string()))?;
        for commitment in &on_chain_commitments {
            tree.insert(*commitment)
                .map_err(|e| RelayerError::MerkleTree(e.to_string()))?;
        }

        let mut trees = self.trees.write().await;
        let mut commitments = self.commitments.write().await;
        trees.insert(bucket_id, tree);
        commitments.insert(bucket_id, on_chain_commitments.clone());
        drop(trees);
        drop(commitments);

        self.save_state(bucket_id).await?;
        info!(
            "Synced bucket {} from chain: {} commitments",
            bucket_id,
            on_chain_commitments.len()
        );
        Ok(())
    }
}

impl Default for MerkleService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[tokio::test]
    async fn test_merkle_service() {
        let temp_dir = tempfile::tempdir().unwrap();
        env::set_var("MERKLE_STATE_PATH", temp_dir.path().to_str().unwrap());

        let service = MerkleService::new();
        service.init_tree(0).await.unwrap();

        let c1 = [1u8; 32];
        let c2 = [2u8; 32];

        assert_eq!(service.insert(0, c1).await.unwrap(), 0);
        assert_eq!(service.insert(0, c2).await.unwrap(), 1);

        let root = service.root(0).await.unwrap();
        let proof = service.proof(0, 0).await.unwrap();
        assert!(service.verify_proof(&root, &c1, &proof).await.unwrap());
    }
}
