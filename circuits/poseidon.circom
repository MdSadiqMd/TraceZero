pragma circom 2.2.0;

// Poseidon Hash Function for BN254
include "node_modules/circomlib/circuits/poseidon.circom";

// Poseidon(n) takes n inputs and produces 1 output

// Poseidon hash with 2 inputs
// Used for: nullifier hash (with domain), merkle tree nodes
template Poseidon2() {
    signal input in[2];
    signal output out;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];
    out <== hasher.out;
}

// Poseidon hash with 3 inputs
// Legacy - kept for compatibility, prefer Poseidon4 with domain tag
template Poseidon3() {
    signal input in[3];
    signal output out;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];
    hasher.inputs[2] <== in[2];
    out <== hasher.out;
}

// Poseidon hash with 4 inputs
// Used for: commitment = Poseidon(domain, nullifier, secret, amount)
template Poseidon4() {
    signal input in[4];
    signal output out;

    component hasher = Poseidon(4);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];
    hasher.inputs[2] <== in[2];
    hasher.inputs[3] <== in[3];
    out <== hasher.out;
}
