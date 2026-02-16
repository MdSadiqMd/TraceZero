pragma circom 2.2.0;

// Privacy-Proxy Withdrawal Circuit
//
// Proves knowledge of a valid deposit commitment in the Merkle tree, without revealing which deposit it corresponds to
//
// Public inputs:
//   - root: Current Merkle root of the deposit pool
//   - nullifierHash: Hash of the nullifier (prevents double-spend)
//   - recipient: Stealth address receiving the withdrawal
//   - amount: Withdrawal amount in lamports
//   - relayer: Relayer address (for fee payment)
//   - fee: Relayer fee amount
//
// Public outputs:
//   - bindingHash: Cryptographic binding of nullifierHash + recipient + relayer + fee
//                  Smart contract MUST verify this matches expected value
//
// Private inputs:
//   - nullifier: Random value used to derive nullifierHash
//   - secret: Random value used in commitment
//   - pathElements: Merkle proof path elements
//   - pathIndices: Merkle proof path indices (0 = left, 1 = right)

include "./poseidon.circom";
include "./merkle_tree.circom";
include "node_modules/circomlib/circuits/comparators.circom";

template Withdrawal(levels) {
    // Public inputs
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    signal input relayer;
    signal input fee;

    // Public output - binding hash for on-chain verification
    signal output bindingHash;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // Nullifier must be non-zero
    component nullifierIsZero = IsZero();
    nullifierIsZero.in <== nullifier;
    nullifierIsZero.out === 0;  // Must NOT be zero

    // Secret must be non-zero, prevents trivial secret attacks
    component secretIsZero = IsZero();
    secretIsZero.in <== secret;
    secretIsZero.out === 0;  // Must NOT be zero

    // 1. Verify nullifier hash with domain separation
    // Domain tag prevents cross-protocol hash collisions
    // nullifierHash = Poseidon(DOMAIN_NULLIFIER, nullifier)
    signal domainNullifier;
    domainNullifier <== 1853189228;  // "null" as u32
    
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== domainNullifier;
    nullifierHasher.inputs[1] <== nullifier;
    nullifierHasher.out === nullifierHash;

    // 2. Compute commitment with domain separation
    // commitment = Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
    signal domainCommit;
    domainCommit <== 1668246637;  // "comm" as u32
    
    component commitmentHasher = Poseidon(4);
    commitmentHasher.inputs[0] <== domainCommit;
    commitmentHasher.inputs[1] <== nullifier;
    commitmentHasher.inputs[2] <== secret;
    commitmentHasher.inputs[3] <== amount;
    signal commitment <== commitmentHasher.out;

    // 3. Verify Merkle proof
    component merkleProof = MerkleTreeChecker(levels);
    merkleProof.leaf <== commitment;
    merkleProof.root <== root;
    for (var i = 0; i < levels; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // Fee must be strictly less than amount
    // Uses proper range check instead of broken field arithmetic
    component feeCheck = LessThan(64);
    feeCheck.in[0] <== fee;
    feeCheck.in[1] <== amount;
    feeCheck.out === 1;

    // Amount must be non-zero
    component amountIsZero = IsZero();
    amountIsZero.in <== amount;
    amountIsZero.out === 0;

    // Binding hash constrains recipient/relayer/fee
    // This cryptographically binds the proof to specific values
    // Smart contract MUST verify: bindingHash == Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
    signal domainBind;
    domainBind <== 1651076196;  // "bind" as u32
    
    component bindingHasher = Poseidon(5);
    bindingHasher.inputs[0] <== domainBind;
    bindingHasher.inputs[1] <== nullifierHash;
    bindingHasher.inputs[2] <== recipient;
    bindingHasher.inputs[3] <== relayer;
    bindingHasher.inputs[4] <== fee;
    bindingHash <== bindingHasher.out;
}

component main {public [root, nullifierHash, recipient, amount, relayer, fee]} = Withdrawal(20);
