/// User generates ZK proof that they know a valid deposit without revealing which one
use serde::{Deserialize, Serialize};
use serde_big_array::BigArray;
use solana_sdk::pubkey::Pubkey;

use crate::crypto::{
    generate_nullifier_hash, generate_ownership_binding_hash, generate_withdrawal_binding_hash,
    validate_fee, validate_non_zero,
};
use crate::deposit::DepositNote;
use crate::error::{Result, SdkError};
use crate::merkle::MerkleProof;
use crate::stealth::StealthAddress;

#[derive(Clone, Serialize, Deserialize)]
pub struct WithdrawalRequest {
    /// ZK proof (Groth16)
    pub proof: ZkProof,
    /// Public inputs
    pub public_inputs: WithdrawalPublicInputs,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct WithdrawalPublicInputs {
    /// Merkle root (proves deposit exists)
    pub root: [u8; 32],
    /// Nullifier hash (prevents double-spend) - uses domain separation
    pub nullifier_hash: [u8; 32],
    /// Recipient field element (32 bytes, potentially reduced mod BN254)
    /// This is the EXACT value the circuit used, not the original pubkey
    pub recipient: [u8; 32],
    /// Withdrawal amount in lamports (must be non-zero)
    pub amount: u64,
    /// Relayer field element (32 bytes, potentially reduced mod BN254)
    /// This is the EXACT value the circuit used, not the original pubkey
    pub relayer: [u8; 32],
    /// Fee amount (must be < amount)
    pub fee: u64,
    /// Binding hash - cryptographically binds proof to recipient/relayer/fee
    /// Smart contract MUST verify this matches expected value
    pub binding_hash: [u8; 32],
}

/// ZK proof (Groth16)
#[derive(Clone, Serialize, Deserialize)]
pub struct ZkProof {
    #[serde(with = "BigArray")]
    pub a: [u8; 64],
    #[serde(with = "BigArray")]
    pub b: [u8; 128],
    #[serde(with = "BigArray")]
    pub c: [u8; 64],
}

/// Private inputs for proof generation (never sent to relayer)
pub struct WithdrawalPrivateInputs {
    /// Deposit note with secret and nullifier
    pub note: DepositNote,
    /// Merkle proof for the commitment
    pub merkle_proof: MerkleProof,
}

impl WithdrawalRequest {
    pub fn new(
        note: &DepositNote,
        _merkle_proof: &MerkleProof,
        root: [u8; 32],
        recipient: &StealthAddress,
        relayer: Pubkey,
        fee: u64,
    ) -> Result<Self> {
        validate_non_zero(&note.nullifier)?;
        validate_non_zero(&note.secret)?;
        if note.amount == 0 {
            return Err(SdkError::Crypto("Amount must be non-zero".into()));
        }
        validate_fee(fee, note.amount)?;

        let nullifier_hash = generate_nullifier_hash(&note.nullifier)?;
        let binding_hash = generate_withdrawal_binding_hash(
            &nullifier_hash,
            &recipient.address.to_bytes(),
            &relayer.to_bytes(),
            fee,
        )?;
        let public_inputs = WithdrawalPublicInputs {
            root,
            nullifier_hash,
            recipient: recipient.address.to_bytes(),
            amount: note.amount,
            relayer: relayer.to_bytes(),
            fee,
            binding_hash,
        };

        // Ideally this would call snarkjs to generate the proof
        // For now, create a placeholder
        let proof = ZkProof {
            a: [0u8; 64],
            b: [0u8; 128],
            c: [0u8; 64],
        };

        Ok(Self {
            proof,
            public_inputs,
        })
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(self).map_err(|e| SdkError::Serialization(e.to_string()))
    }

    /// Validate the request matches circuit constraints
    /// We do NOT validate the binding hash here because it's computed by
    /// the circuit using circomlibjs Poseidon, which may differ from the Rust
    /// light_poseidon implementation. The binding hash is verified as part of
    /// the Groth16 proof verification on-chain
    pub fn validate(&self) -> Result<()> {
        if self.public_inputs.amount == 0 {
            return Err(SdkError::Crypto("Amount must be non-zero".into()));
        }
        validate_fee(self.public_inputs.fee, self.public_inputs.amount)?;

        if self.public_inputs.nullifier_hash.iter().all(|&b| b == 0) {
            return Err(SdkError::Crypto("Nullifier hash must be non-zero".into()));
        }

        if self.public_inputs.recipient.iter().all(|&b| b == 0) {
            return Err(SdkError::Crypto("Recipient must be non-zero".into()));
        }

        if self.public_inputs.relayer.iter().all(|&b| b == 0) {
            return Err(SdkError::Crypto("Relayer must be non-zero".into()));
        }

        if self.public_inputs.binding_hash.iter().all(|&b| b == 0) {
            return Err(SdkError::Crypto("Binding hash must be non-zero".into()));
        }

        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct WithdrawalResponse {
    /// Whether withdrawal was successful
    pub success: bool,
    /// Transaction signature
    pub tx_signature: Option<String>,
    /// Error message
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct OwnershipProofRequest {
    /// ZK proof (Groth16)
    pub proof: ZkProof,
    /// Nullifier hash (must match pending withdrawal)
    pub nullifier_hash: [u8; 32],
    /// Pending withdrawal ID (binds proof to specific withdrawal)
    pub pending_withdrawal_id: u64,
    /// Binding hash - cryptographically binds proof to this withdrawal
    /// Smart contract MUST verify this matches expected value
    pub binding_hash: [u8; 32],
}

impl OwnershipProofRequest {
    pub fn new(nullifier: &[u8; 32], pending_withdrawal_id: u64) -> Result<Self> {
        validate_non_zero(nullifier)?;

        let nullifier_hash = generate_nullifier_hash(nullifier)?;
        let binding_hash = generate_ownership_binding_hash(nullifier, pending_withdrawal_id)?;
        // In production, generate actual proof
        let proof = ZkProof {
            a: [0u8; 64],
            b: [0u8; 128],
            c: [0u8; 64],
        };

        Ok(Self {
            proof,
            nullifier_hash,
            pending_withdrawal_id,
            binding_hash,
        })
    }

    pub fn validate(&self, nullifier: &[u8; 32]) -> Result<()> {
        let expected_binding =
            generate_ownership_binding_hash(nullifier, self.pending_withdrawal_id)?;
        if self.binding_hash != expected_binding {
            return Err(SdkError::Crypto("Invalid ownership binding hash".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merkle::MerkleTree;
    use crate::stealth::StealthMaster;

    #[test]
    fn test_withdrawal_request() {
        let note = DepositNote::new(1_000_000_000);
        let commitment = note.commitment().unwrap();

        let mut tree = MerkleTree::new(4).unwrap();
        tree.insert(commitment).unwrap();
        let root = tree.root().unwrap();
        let proof = tree.proof(0).unwrap();

        let master = StealthMaster::new();
        let stealth = master.derive(0);

        let relayer = Pubkey::new_unique();
        let request =
            WithdrawalRequest::new(&note, &proof, root, &stealth, relayer, 10000).unwrap();

        assert_eq!(request.public_inputs.recipient, stealth.address.to_bytes());
        assert_eq!(request.public_inputs.fee, 10000);
        assert!(request.validate().is_ok());

        // Verify binding hash is non-zero
        assert!(request.public_inputs.binding_hash.iter().any(|&b| b != 0));
    }

    #[test]
    fn test_fee_validation() {
        let note = DepositNote::new(1_000_000_000);
        let commitment = note.commitment().unwrap();

        let mut tree = MerkleTree::new(4).unwrap();
        tree.insert(commitment).unwrap();
        let root = tree.root().unwrap();
        let proof = tree.proof(0).unwrap();

        let master = StealthMaster::new();
        let stealth = master.derive(0);
        let relayer = Pubkey::new_unique();

        // Fee >= amount should fail
        let result = WithdrawalRequest::new(
            &note,
            &proof,
            root,
            &stealth,
            relayer,
            note.amount, // fee == amount
        );
        assert!(result.is_err());

        // Fee > amount should fail
        let result = WithdrawalRequest::new(
            &note,
            &proof,
            root,
            &stealth,
            relayer,
            note.amount + 1, // fee > amount
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_ownership_proof_binding() {
        let nullifier = crate::crypto::random_secret();
        let pending_id = 42u64;
        let request = OwnershipProofRequest::new(&nullifier, pending_id).unwrap();

        assert_eq!(request.pending_withdrawal_id, pending_id);
        assert!(request.binding_hash.iter().any(|&b| b != 0));

        // Validate should pass with correct nullifier
        assert!(request.validate(&nullifier).is_ok());

        // Validate should fail with wrong nullifier
        let wrong_nullifier = crate::crypto::random_secret();
        assert!(request.validate(&wrong_nullifier).is_err());
    }
}
