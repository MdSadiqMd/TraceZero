/// ZK Verifier Program
/// Verifies Groth16 proofs for withdrawal and ownership operations
/// - Withdrawal proof now outputs bindingHash that MUST be verified
/// - Ownership proof now outputs bindingHash that MUST be verified
/// - Domain separation is enforced (circuit-side)
/// - Fee < amount is enforced (circuit-side)
///
/// Poseidon binding hash is computed by the circuit and included in the proof's public inputs
/// On-chain verification trusts the circuit output since full Poseidon is too heavy for Solana BPF
use anchor_lang::prelude::*;

pub mod groth16;
pub mod poseidon;
pub mod verifying_key;

use groth16::{verify_ownership_proof, verify_withdrawal_proof};
use poseidon::verify_binding_inputs;

declare_id!("2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu");

/// Domain tag for withdrawal binding hash: "bind" as u32
/// MUST match: circuits/withdrawal.circom
pub const DOMAIN_BIND: u64 = 1651076196;

/// Domain tag for ownership binding hash: "ownb" as u32
/// MUST match: circuits/ownership.circom
pub const DOMAIN_OWNER_BIND: u64 = 1869771618;

/// Public inputs for withdrawal proof verification
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct WithdrawalPublicInputs {
    /// Current Merkle root of the deposit pool
    pub merkle_root: [u8; 32],
    /// Hash of the nullifier (with domain separation)
    pub nullifier_hash: [u8; 32],
    /// Recipient field element (32 bytes, potentially reduced mod BN254)
    /// This is the EXACT value the circuit used, not the original pubkey
    pub recipient: [u8; 32],
    /// Withdrawal amount in lamports (must be non-zero, enforced by circuit)
    pub amount: u64,
    /// Relayer field element (32 bytes, potentially reduced mod BN254)
    /// This is the EXACT value the circuit used, not the original pubkey
    pub relayer: [u8; 32],
    /// Relayer fee in lamports (must be < amount, enforced by circuit)
    pub fee: u64,
}

/// Public inputs for ownership proof verification (UPDATED v2)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OwnershipPublicInputs {
    /// Hash of the nullifier (with domain separation)
    pub nullifier_hash: [u8; 32],
    /// Pending withdrawal ID - binds proof to specific withdrawal
    pub pending_withdrawal_id: u64,
}

/// Groth16 proof structure
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Groth16Proof {
    /// Proof element A (G1 point, 64 bytes)
    pub a: [u8; 64],
    /// Proof element B (G2 point, 128 bytes)
    pub b: [u8; 128],
    /// Proof element C (G1 point, 64 bytes)
    pub c: [u8; 64],
}

#[program]
pub mod zk_verifier {
    use super::*;
    /// The circuit outputs a binding hash that binds the proof to specific recipient/relayer/fee values
    /// The Groth16 proof guarantees the binding hash is correctly computed as:
    /// bindingHash = Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
    ///
    /// Circuit enforces:
    /// 1. nullifier != 0
    /// 2. secret != 0
    /// 3. amount != 0
    /// 4. fee < amount
    /// 5. Domain-separated hashes
    /// 6. Valid Merkle proof
    /// 7. Binding hash computation
    pub fn verify_withdrawal(
        _ctx: Context<VerifyWithdrawal>,
        proof: Groth16Proof,
        public_inputs: WithdrawalPublicInputs,
        binding_hash: [u8; 32], // Circuit output - included in proof verification
    ) -> Result<()> {
        msg!("Verifying withdrawal proof...");

        // Additional on-chain validation
        require!(
            public_inputs.amount > 0,
            ZkVerifierError::InvalidPublicInputs
        );
        require!(
            public_inputs.fee < public_inputs.amount,
            ZkVerifierError::InvalidPublicInputs
        );

        // Verify inputs are well-formed (basic sanity checks)
        require!(
            verify_binding_inputs(
                DOMAIN_BIND,
                &public_inputs.nullifier_hash,
                &public_inputs.recipient,
                &public_inputs.relayer,
                public_inputs.fee,
                &binding_hash,
            ),
            ZkVerifierError::InvalidPublicInputs
        );

        // Prepare all 7 public inputs in the order the circuit expects:
        // [bindingHash, root, nullifierHash, recipient, amount, relayer, fee]
        let inputs = prepare_withdrawal_inputs(&public_inputs, &binding_hash);
        verify_withdrawal_proof(&proof.a, &proof.b, &proof.c, &inputs)?;

        msg!("✓ Withdrawal proof verified successfully");
        msg!("  Nullifier hash: {:?}", &public_inputs.nullifier_hash[..8]);
        msg!("  Recipient: {:?}", &public_inputs.recipient[..8]);
        msg!(
            "  Amount: {} (fee: {})",
            public_inputs.amount,
            public_inputs.fee
        );
        msg!("  Binding hash verified: {:?}", &binding_hash[..8]);

        Ok(())
    }

    /// Now verifies the binding hash output from the circuit to ensure the proof is bound to a specific pending withdrawal
    ///
    /// Circuit enforces:
    /// 1. nullifier != 0
    /// 2. Domain-separated nullifier hash
    /// 3. Binding hash = Poseidon(DOMAIN_OWNER_BIND, nullifier, pendingWithdrawalId)
    pub fn verify_ownership(
        _ctx: Context<VerifyOwnership>,
        proof: Groth16Proof,
        public_inputs: OwnershipPublicInputs,
        binding_hash: [u8; 32], // Circuit output - MUST be verified
    ) -> Result<()> {
        msg!("Verifying ownership proof...");
        msg!(
            "  Pending withdrawal ID: {}",
            public_inputs.pending_withdrawal_id
        );

        // We cannot verify the binding hash directly because it uses the private nullifier
        // The circuit guarantees the binding is correct
        // The smart contract should verify that the pendingWithdrawalId matches the actual pending withdrawal being cancelled
        let inputs = prepare_ownership_inputs(&public_inputs);
        verify_ownership_proof(&proof.a, &proof.b, &proof.c, &inputs, &binding_hash)?;

        msg!("✓ Ownership proof verified");
        msg!("  Nullifier hash: {:?}", &public_inputs.nullifier_hash[..8]);
        msg!("  Binding hash: {:?}", &binding_hash[..8]);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct VerifyWithdrawal<'info> {
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct VerifyOwnership<'info> {
    pub caller: Signer<'info>,
}

#[error_code]
pub enum ZkVerifierError {
    #[msg("Invalid ZK proof")]
    InvalidProof,

    #[msg("Invalid public inputs")]
    InvalidPublicInputs,

    #[msg("Proof verification failed")]
    VerificationFailed,

    #[msg("Invalid field element")]
    InvalidFieldElement,

    #[msg("Invalid binding hash - proof not bound to these parameters")]
    InvalidBindingHash,
}

/// Prepare public inputs for withdrawal verification
/// All inputs are 32-byte arrays in big-endian format as expected by groth16-solana
/// NOTE: recipient and relayer are already field elements from the circuit
/// (potentially reduced mod BN254 by snarkjs), so we use them directly
///
/// Order matches snarkjs output: [bindingHash, root, nullifierHash, recipient, amount, relayer, fee]
/// (outputs come first in snarkjs public signals)
fn prepare_withdrawal_inputs(
    inputs: &WithdrawalPublicInputs,
    binding_hash: &[u8; 32],
) -> [[u8; 32]; 7] {
    let mut amount_bytes = [0u8; 32];
    amount_bytes[24..32].copy_from_slice(&inputs.amount.to_be_bytes());

    let mut fee_bytes = [0u8; 32];
    fee_bytes[24..32].copy_from_slice(&inputs.fee.to_be_bytes());

    [
        *binding_hash,         // Circuit output (comes first in snarkjs)
        inputs.merkle_root,    // Already in correct format from circuit
        inputs.nullifier_hash, // Already in correct format from circuit
        inputs.recipient,      // Field element from circuit (already reduced if needed)
        amount_bytes,
        inputs.relayer, // Field element from circuit (already reduced if needed)
        fee_bytes,
    ]
}

/// Prepare public inputs for ownership verification
fn prepare_ownership_inputs(inputs: &OwnershipPublicInputs) -> [[u8; 32]; 2] {
    let mut withdrawal_id_bytes = [0u8; 32];
    withdrawal_id_bytes[24..32].copy_from_slice(&inputs.pending_withdrawal_id.to_be_bytes());

    [inputs.nullifier_hash, withdrawal_id_bytes]
}
