pragma circom 2.2.0;

// Ownership Proof Circuit
// Proves knowledge of the nullifier preimage without revealing it
// Used for cancelling pending withdrawals
//
// Public inputs:
//   - nullifierHash: Hash of the nullifier
//   - pendingWithdrawalId: ID of the pending withdrawal being cancelled
//
// Public outputs:
//   - bindingHash: Cryptographic binding of nullifier + pendingWithdrawalId
//                  Smart contract MUST verify this matches expected value
//
// Private inputs:
//   - nullifier: The actual nullifier value

include "./poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

template Ownership() {
    // Public inputs
    signal input nullifierHash;
    signal input pendingWithdrawalId;  // Binds proof to specific withdrawal

    // Public output - binding hash for on-chain verification
    signal output bindingHash;

    // Private input
    signal input nullifier;

    // Nullifier must be non-zero
    component nullifierIsZero = IsZero();
    nullifierIsZero.in <== nullifier;
    nullifierIsZero.out === 0;  // Must NOT be zero

    // Verify nullifier hash with domain separation
    // Must match the domain used in withdrawal circuit
    // nullifierHash = Poseidon(DOMAIN_NULLIFIER, nullifier)
    signal domainNullifier;
    domainNullifier <== 1853189228;  // "null" as u32 - MUST match withdrawal.circom
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== domainNullifier;
    hasher.inputs[1] <== nullifier;
    hasher.out === nullifierHash;

    // Binding hash as PUBLIC OUTPUT
    // This cryptographically binds the proof to a specific withdrawal.
    // Smart contract MUST verify: bindingHash == Poseidon(DOMAIN_OWNER_BIND, nullifier, pendingWithdrawalId)
    // Since nullifier is private, contract computes expected binding from nullifierHash.
    signal domainOwnerBind;
    domainOwnerBind <== 1869771618;  // "ownb" as u32
    
    component bindingHasher = Poseidon(3);
    bindingHasher.inputs[0] <== domainOwnerBind;
    bindingHasher.inputs[1] <== nullifier;
    bindingHasher.inputs[2] <== pendingWithdrawalId;
    bindingHash <== bindingHasher.out;
}

component main {public [nullifierHash, pendingWithdrawalId]} = Ownership();
