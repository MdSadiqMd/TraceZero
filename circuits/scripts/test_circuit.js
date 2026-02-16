#!/usr/bin/env node
/**
 * Test script for privacy-proxy circuits (SECURITY HARDENED v2)
 *
 * Tests the withdrawal and ownership circuits with sample inputs to verify:
 * 1. Witness generation works
 * 2. Proof generation works
 * 3. Proof verification works
 * 4. Security constraints are enforced
 * 5. Binding hashes are correctly computed
 *
 * Usage: node scripts/test_circuit.js
 */

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

// Poseidon hash (using circomlibjs)
let poseidon;
let F; // Field

// Domain tags - MUST match circuit constants
const DOMAIN_NULLIFIER = 1853189228n; // "null" as u32
const DOMAIN_COMMIT = 1668246637n; // "comm" as u32
const DOMAIN_BIND = 1651076196n; // "bind" as u32
const DOMAIN_OWNER_BIND = 1869771618n; // "ownb" as u32

async function initPoseidon() {
  const { buildPoseidon } = await import("circomlibjs");
  poseidon = await buildPoseidon();
  F = poseidon.F;
}

// Convert BigInt to field element string
function toFieldStr(n) {
  if (typeof n === "bigint") {
    return n.toString();
  }
  // If it's a field element from poseidon
  return F.toString(n);
}

// Poseidon hash wrapper
function hash(inputs) {
  const result = poseidon(inputs.map((x) => BigInt(x)));
  // poseidon returns a field element, convert to BigInt
  return poseidon.F.toObject(result);
}

// Build a simple Merkle tree and get proof
function buildMerkleTree(leaves, levels) {
  const tree = [leaves.map((l) => BigInt(l))];

  for (let level = 0; level < levels; level++) {
    const currentLevel = tree[level];
    const nextLevel = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i] || 0n;
      const right = currentLevel[i + 1] || 0n;
      nextLevel.push(hash([left, right]));
    }

    // Pad to power of 2
    while (nextLevel.length < Math.pow(2, levels - level - 1)) {
      const lastIdx = nextLevel.length;
      const left = nextLevel[lastIdx - 1] || 0n;
      nextLevel.push(hash([left, 0n]));
    }

    tree.push(nextLevel);
  }

  return tree;
}

function getMerkleProof(tree, leafIndex, levels) {
  const pathElements = [];
  const pathIndices = [];

  let currentIndex = leafIndex;

  for (let level = 0; level < levels; level++) {
    const isRight = currentIndex % 2 === 1;
    const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

    pathIndices.push(isRight ? 1 : 0);
    pathElements.push(tree[level][siblingIndex] || 0n);

    currentIndex = Math.floor(currentIndex / 2);
  }

  return { pathElements, pathIndices };
}

async function testWithdrawalCircuit() {
  console.log("=== Testing Withdrawal Circuit (Security Hardened v2) ===\n");

  await initPoseidon();

  const BUILD_DIR = path.join(__dirname, "..", "build");
  const WASM_FILE = path.join(BUILD_DIR, "withdrawal_js", "withdrawal.wasm");
  const ZKEY_FILE = path.join(BUILD_DIR, "keys", "withdrawal_final.zkey");
  const VK_FILE = path.join(
    BUILD_DIR,
    "keys",
    "withdrawal_verification_key.json",
  );

  // Check files exist
  if (!fs.existsSync(WASM_FILE)) {
    console.error("Error: WASM file not found. Run compile.sh first");
    process.exit(1);
  }

  if (!fs.existsSync(ZKEY_FILE)) {
    console.error("Error: zkey file not found. Run setup.sh first");
    process.exit(1);
  }

  // Test parameters
  const LEVELS = 20;
  const nullifier = 12345678901234567890n;
  const secret = 98765432109876543210n;
  const amount = 1000000000n; // 1 SOL in lamports
  const recipient = 11111111111111111111111111111111n;
  const relayer = 22222222222222222222222222222222n;
  const fee = 5000000n; // 0.005 SOL (must be < amount)

  console.log("Test parameters:");
  console.log("  Nullifier:", nullifier.toString());
  console.log("  Amount:", amount.toString(), "lamports");
  console.log("  Fee:", fee.toString(), "lamports");

  // Compute nullifier hash WITH domain separation
  const nullifierHash = hash([DOMAIN_NULLIFIER, nullifier]);
  console.log(
    "  Nullifier Hash:",
    toFieldStr(nullifierHash).slice(0, 20) + "...",
  );

  // Compute commitment WITH domain separation
  const commitment = hash([DOMAIN_COMMIT, nullifier, secret, amount]);
  console.log("  Commitment:", toFieldStr(commitment).slice(0, 20) + "...");

  // Compute expected binding hash
  const expectedBindingHash = hash([
    DOMAIN_BIND,
    nullifierHash,
    recipient,
    relayer,
    fee,
  ]);
  console.log(
    "  Expected Binding Hash:",
    toFieldStr(expectedBindingHash).slice(0, 20) + "...",
  );

  // Build Merkle tree with our commitment
  const leaves = [commitment];
  for (let i = 1; i < 8; i++) {
    leaves.push(hash([DOMAIN_COMMIT, BigInt(i), BigInt(i * 2), BigInt(i * 3)]));
  }

  const tree = buildMerkleTree(leaves, LEVELS);
  const root = tree[LEVELS][0];

  // Get proof for our commitment (index 0)
  const { pathElements, pathIndices } = getMerkleProof(tree, 0, LEVELS);

  // Prepare circuit inputs
  const input = {
    root: toFieldStr(root),
    nullifierHash: toFieldStr(nullifierHash),
    recipient: recipient.toString(),
    amount: amount.toString(),
    relayer: relayer.toString(),
    fee: fee.toString(),
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map((e) => toFieldStr(e)),
    pathIndices: pathIndices,
  };

  console.log("\n--- Generating Witness ---");

  try {
    const { wtns } = await snarkjs.wtns.calculate(input, WASM_FILE, {
      type: "mem",
    });
    console.log("✓ Witness generated successfully");

    console.log("\n--- Generating Proof ---");
    const { proof, publicSignals } = await snarkjs.groth16.prove(
      ZKEY_FILE,
      wtns,
    );
    console.log("✓ Proof generated successfully");
    console.log("  Public signals count:", publicSignals.length);

    // The last public signal should be the binding hash (circuit output)
    const circuitBindingHash = publicSignals[publicSignals.length - 1];
    const expectedStr = toFieldStr(expectedBindingHash);

    if (circuitBindingHash === expectedStr) {
      console.log("✓ Binding hash matches expected value!");
    } else {
      console.log("✗ Binding hash mismatch!");
      process.exit(1);
    }

    console.log("\n--- Verifying Proof ---");
    const vk = JSON.parse(fs.readFileSync(VK_FILE, "utf8"));
    const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);

    if (isValid) {
      console.log("✓ Proof verified successfully!");
    } else {
      console.log("✗ Proof verification failed!");
      process.exit(1);
    }

    // Test security constraints
    console.log("\n--- Testing Security Constraints ---");
    await testSecurityConstraints(WASM_FILE, input);

    console.log("\n=== Withdrawal Circuit Tests Passed ===");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

async function testSecurityConstraints(wasmFile, validInput) {
  // Test 1: Zero nullifier should fail
  console.log("\n  Testing zero nullifier rejection...");
  try {
    const badInput = { ...validInput, nullifier: "0" };
    await snarkjs.wtns.calculate(badInput, wasmFile, { type: "mem" });
    console.log("  ✗ FAILED: Zero nullifier was accepted!");
    process.exit(1);
  } catch (e) {
    console.log("  ✓ Zero nullifier correctly rejected");
  }

  // Test 2: Zero secret should fail
  console.log("  Testing zero secret rejection...");
  try {
    const badInput = { ...validInput, secret: "0" };
    await snarkjs.wtns.calculate(badInput, wasmFile, { type: "mem" });
    console.log("  ✗ FAILED: Zero secret was accepted!");
    process.exit(1);
  } catch (e) {
    console.log("  ✓ Zero secret correctly rejected");
  }

  // Test 3: Fee >= amount should fail
  console.log("  Testing fee >= amount rejection...");
  try {
    const badInput = { ...validInput, fee: validInput.amount };
    await snarkjs.wtns.calculate(badInput, wasmFile, { type: "mem" });
    console.log("  ✗ FAILED: Fee >= amount was accepted!");
    process.exit(1);
  } catch (e) {
    console.log("  ✓ Fee >= amount correctly rejected");
  }

  // Test 4: Fee > amount should fail
  console.log("  Testing fee > amount rejection...");
  try {
    const badInput = {
      ...validInput,
      fee: (BigInt(validInput.amount) + 1n).toString(),
    };
    await snarkjs.wtns.calculate(badInput, wasmFile, { type: "mem" });
    console.log("  ✗ FAILED: Fee > amount was accepted!");
    process.exit(1);
  } catch (e) {
    console.log("  ✓ Fee > amount correctly rejected");
  }

  // Test 5: Zero amount should fail
  console.log("  Testing zero amount rejection...");
  try {
    const badInput = { ...validInput, amount: "0", fee: "0" };
    await snarkjs.wtns.calculate(badInput, wasmFile, { type: "mem" });
    console.log("  ✗ FAILED: Zero amount was accepted!");
    process.exit(1);
  } catch (e) {
    console.log("  ✓ Zero amount correctly rejected");
  }
}

async function testOwnershipCircuit() {
  console.log("\n=== Testing Ownership Circuit (Security Hardened v2) ===\n");

  await initPoseidon();

  const BUILD_DIR = path.join(__dirname, "..", "build");
  const WASM_FILE = path.join(BUILD_DIR, "ownership_js", "ownership.wasm");
  const ZKEY_FILE = path.join(BUILD_DIR, "keys", "ownership_final.zkey");
  const VK_FILE = path.join(
    BUILD_DIR,
    "keys",
    "ownership_verification_key.json",
  );

  if (!fs.existsSync(WASM_FILE)) {
    console.log("Skipping ownership test (not compiled)");
    return;
  }

  if (!fs.existsSync(ZKEY_FILE)) {
    console.log("Skipping ownership test (not setup)");
    return;
  }

  const nullifier = 12345678901234567890n;
  const pendingWithdrawalId = 42n;

  const nullifierHash = hash([DOMAIN_NULLIFIER, nullifier]);
  const expectedBindingHash = hash([
    DOMAIN_OWNER_BIND,
    nullifier,
    pendingWithdrawalId,
  ]);

  console.log("Test parameters:");
  console.log("  Nullifier:", nullifier.toString());
  console.log("  Pending Withdrawal ID:", pendingWithdrawalId.toString());
  console.log(
    "  Expected Binding Hash:",
    toFieldStr(expectedBindingHash).slice(0, 20) + "...",
  );

  const input = {
    nullifierHash: toFieldStr(nullifierHash),
    pendingWithdrawalId: pendingWithdrawalId.toString(),
    nullifier: nullifier.toString(),
  };

  try {
    const { wtns } = await snarkjs.wtns.calculate(input, WASM_FILE, {
      type: "mem",
    });
    console.log("✓ Witness generated");

    const { proof, publicSignals } = await snarkjs.groth16.prove(
      ZKEY_FILE,
      wtns,
    );
    console.log("✓ Proof generated");

    // The last public signal should be the binding hash
    const circuitBindingHash = publicSignals[publicSignals.length - 1];
    const expectedStr = toFieldStr(expectedBindingHash);

    if (circuitBindingHash === expectedStr) {
      console.log("✓ Binding hash matches expected value!");
    } else {
      console.log("✗ Binding hash mismatch!");
      process.exit(1);
    }

    const vk = JSON.parse(fs.readFileSync(VK_FILE, "utf8"));
    const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);

    if (isValid) {
      console.log("✓ Proof verified!");
    } else {
      console.log("✗ Verification failed!");
      process.exit(1);
    }

    // Test zero nullifier rejection
    console.log("\n  Testing zero nullifier rejection...");
    try {
      const badInput = { ...input, nullifier: "0" };
      await snarkjs.wtns.calculate(badInput, WASM_FILE, { type: "mem" });
      console.log("  ✗ FAILED: Zero nullifier was accepted!");
      process.exit(1);
    } catch (e) {
      console.log("  ✓ Zero nullifier correctly rejected");
    }

    console.log("\n=== Ownership Circuit Tests Passed ===");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

// Run tests
(async () => {
  try {
    await testWithdrawalCircuit();
    await testOwnershipCircuit();
    console.log("\n========================================");
    console.log("All Circuit Tests Passed Successfully!");
    console.log("========================================");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
})();
