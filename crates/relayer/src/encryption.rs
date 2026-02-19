use sha2::{Digest, Sha256};

pub fn hash_token_id(token_id: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"token_hash:");
    hasher.update(token_id);
    let result = hasher.finalize();

    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_hash_deterministic() {
        let token = [42u8; 32];
        let hash1 = hash_token_id(&token);
        let hash2 = hash_token_id(&token);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_token_hash_different_inputs() {
        let token1 = [1u8; 32];
        let token2 = [2u8; 32];
        let hash1 = hash_token_id(&token1);
        let hash2 = hash_token_id(&token2);
        assert_ne!(hash1, hash2);
    }
}
