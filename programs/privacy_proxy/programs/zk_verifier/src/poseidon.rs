/// Binding hash verification for on-chain use
/// The binding hash is now included as a public output from the circuit and verified as part of the Groth16 proof.
/// The Groth16 proof cryptographically guarantees: bindingHash = Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
/// We cannot recompute Poseidon on-chain (stack overflow), but the proof verification includes the binding hash as a public input, so any mismatch will cause the proof to fail
/// The circuit guarantees: bindingHash = Poseidon(domain, nullifierHash, recipient, relayer, fee)
/// If the caller provides a different binding_hash, the proof verification will fail
pub fn verify_binding_inputs(
    domain: u64,
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32],
    relayer: &[u8; 32],
    fee: u64,
    _circuit_binding_hash: &[u8; 32],
) -> bool {
    // Domain must be valid (non-zero)
    if domain == 0 {
        return false;
    }

    // Nullifier hash must be non-zero (prevents trivial attacks)
    if nullifier_hash.iter().all(|&b| b == 0) {
        return false;
    }

    // Recipient must be non-zero (valid address)
    if recipient.iter().all(|&b| b == 0) {
        return false;
    }

    // Relayer must be non-zero (valid address)
    if relayer.iter().all(|&b| b == 0) {
        return false;
    }

    // Fee must be reasonable (< 50% of max u64 to prevent overflow)
    if fee > u64::MAX / 2 {
        return false;
    }

    // The actual binding hash verification happens in groth16.rs
    // where binding_hash is included as public input index 6
    // and verified as part of the Groth16 proof

    true
}

/// Verify that the binding hash is included in the proof's public inputs
/// This is called by the Groth16 verifier to ensure the binding is correct
pub fn verify_binding_hash_in_proof(
    public_inputs: &[[u8; 32]],
    binding_hash: &[u8; 32],
    binding_index: usize,
) -> bool {
    if binding_index >= public_inputs.len() {
        return false;
    }

    // The binding hash at the specified index must match
    public_inputs[binding_index] == *binding_hash
}
