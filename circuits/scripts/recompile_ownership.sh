#!/bin/bash
# Recompile ownership circuit with correct public inputs
# This fixes the VK mismatch issue (C1 in security audit)

set -e

cd "$(dirname "$0")/.."

echo "=== Recompiling Ownership Circuit ==="
echo "Public inputs: nullifierHash, pendingWithdrawalId"
echo "Public output: bindingHash"
echo ""

# Compile circuit
echo "1. Compiling circuit..."
circom ownership.circom --r1cs --wasm --sym -o build/

# Generate proving key with pot12 (ownership is smaller than withdrawal)
echo "2. Generating proving key..."
snarkjs groth16 setup build/ownership.r1cs ptau/pot12_final.ptau build/ownership_0000.zkey

# Contribute to ceremony (for production, use multiple contributors)
echo "3. Contributing to ceremony..."
echo "privacy-proxy-ownership-v2" | snarkjs zkey contribute build/ownership_0000.zkey build/ownership_final.zkey --name="Privacy-Proxy Ownership v2"

# Export verification key
echo "4. Exporting verification key..."
snarkjs zkey export verificationkey build/ownership_final.zkey build/ownership_vk.json

# Generate Rust verifying key
echo "5. Generating Rust verifying key..."
node scripts/generate_vk_rust.js ownership > ../programs/privacy_proxy/programs/zk_verifier/src/ownership_vk_new.rs

echo ""
echo "=== Done ==="
echo "New VK generated at: build/ownership_vk.json"
echo "Rust VK at: programs/zk_verifier/src/ownership_vk_new.rs"
echo ""
echo "IMPORTANT: Review the new VK and update verifying_key.rs manually"
echo "The new VK should have 4 IC points (for 3 public values: 2 inputs + 1 output)"
