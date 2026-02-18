/// User sends SignedCredit + commitment to relayer via Tor
/// Relayer verifies signature and executes deposit (user wallet NOT in TX)
/// Uses domain-separated hashes and validates inputs
use serde::{Deserialize, Serialize};

use crate::credits::SignedCredit;
use crate::crypto::{generate_commitment, random_secret, validate_non_zero};
use crate::error::{Result, SdkError};

#[derive(Clone, Serialize, Deserialize)]
pub struct DepositRequest {
    /// The signed credit being redeemed
    pub credit: SignedCredit,
    /// Commitment to add to the pool: Poseidon(domain, nullifier, secret, amount)
    pub commitment: [u8; 32],
    /// Encrypted note (optional, for recovery)
    pub encrypted_note: Option<Vec<u8>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DepositNote {
    /// Secret used in commitment (must be non-zero)
    pub secret: [u8; 32],
    /// Nullifier used in commitment (must be non-zero)
    pub nullifier: [u8; 32],
    /// Amount deposited
    pub amount: u64,
    /// Leaf index in merkle tree (set after deposit confirmed)
    pub leaf_index: Option<u64>,
}

impl DepositNote {
    pub fn new(amount: u64) -> Self {
        Self {
            secret: random_secret(),
            nullifier: random_secret(),
            amount,
            leaf_index: None,
        }
    }

    /// Uses domain-separated hash: commitment = Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
    pub fn commitment(&self) -> Result<[u8; 32]> {
        validate_non_zero(&self.nullifier)?;
        validate_non_zero(&self.secret)?;
        if self.amount == 0 {
            return Err(SdkError::Crypto("Amount must be non-zero".into()));
        }

        generate_commitment(&self.nullifier, &self.secret, self.amount)
    }

    /// Set the leaf index after deposit is confirmed
    pub fn set_leaf_index(&mut self, index: u64) {
        self.leaf_index = Some(index);
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(self).map_err(|e| SdkError::Serialization(e.to_string()))
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        serde_json::from_slice(bytes).map_err(|e| SdkError::Serialization(e.to_string()))
    }

    pub fn validate(&self) -> Result<()> {
        validate_non_zero(&self.nullifier)?;
        validate_non_zero(&self.secret)?;
        if self.amount == 0 {
            return Err(SdkError::Crypto("Amount must be non-zero".into()));
        }
        Ok(())
    }
}

impl DepositRequest {
    pub fn new(credit: SignedCredit, note: &DepositNote) -> Result<Self> {
        note.validate()?;

        let commitment = note.commitment()?;
        Ok(Self {
            credit,
            commitment,
            encrypted_note: None,
        })
    }

    pub fn with_encrypted_note(mut self, encrypted: Vec<u8>) -> Self {
        self.encrypted_note = Some(encrypted);
        self
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(self).map_err(|e| SdkError::Serialization(e.to_string()))
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DepositResponse {
    pub success: bool,
    pub tx_signature: Option<String>,
    pub leaf_index: Option<u64>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deposit_note() {
        let note = DepositNote::new(1_000_000_000);

        // Validate passes
        assert!(note.validate().is_ok());

        // Commitment should be deterministic for same note
        let commitment1 = note.commitment().unwrap();
        let commitment2 = note.commitment().unwrap();
        assert_eq!(commitment1, commitment2);

        // Serialization roundtrip
        let bytes = note.to_bytes().unwrap();
        let restored = DepositNote::from_bytes(&bytes).unwrap();
        assert_eq!(note.secret, restored.secret);
        assert_eq!(note.nullifier, restored.nullifier);
    }

    #[test]
    fn test_zero_amount_rejected() {
        let mut note = DepositNote::new(1_000_000_000);
        note.amount = 0;

        assert!(note.validate().is_err());
        assert!(note.commitment().is_err());
    }
}
