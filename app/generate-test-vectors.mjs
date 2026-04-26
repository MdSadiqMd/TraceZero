/**
 * Generate Poseidon Test Vectors for Cross-Implementation Verification
 * M-03 FIX: Generate reference values from circomlibjs
 * 
 * Run with: node generate-test-vectors.mjs
 */

import { buildPoseidon } from 'circomlibjs';

// Domain tags (must match circuit and SDK)
const DOMAIN_NULLIFIER = 1853189228n;
const DOMAIN_COMMIT = 1668246637n;
const DOMAIN_BIND = 1651076196n;

// Helper functions
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBigInt(bytes) {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function bigIntToBytes(value, length = 32) {
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

async function main() {
  const poseidon = await buildPoseidon();
  
  // Test vectors
  const testNullifier = hexToBytes(
    '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
  );
  
  const testSecret = hexToBytes(
    '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40'
  );
  
  const testRecipient = hexToBytes(
    '4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60'
  );
  
  const testRelayer = hexToBytes(
    '6162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80'
  );
  
  const testAmount = 1_000_000_000n;
  const testFee = 10_000_000n;
  
  console.log('='.repeat(80));
  console.log('POSEIDON CROSS-IMPLEMENTATION TEST VECTORS');
  console.log('Generated from circomlibjs - Use these to verify Rust implementation');
  console.log('='.repeat(80));
  console.log('');
  
  // Test 1: Nullifier Hash
  console.log('// Test 1: Nullifier Hash');
  console.log('// Poseidon(DOMAIN_NULLIFIER, nullifier)');
  const nullifierBigInt = bytesToBigInt(testNullifier);
  const nullifierHashResult = poseidon([DOMAIN_NULLIFIER, nullifierBigInt]);
  const nullifierHashBigInt = poseidon.F.toObject(nullifierHashResult);
  const nullifierHash = bigIntToBytes(nullifierHashBigInt);
  
  console.log('let expected_nullifier_hash = [');
  for (let i = 0; i < 32; i += 8) {
    const chunk = Array.from(nullifierHash.slice(i, i + 8))
      .map(b => `0x${b.toString(16).padStart(2, '0')}`)
      .join(', ');
    console.log(`    ${chunk},`);
  }
  console.log('];');
  console.log(`// Hex: ${bytesToHex(nullifierHash)}`);
  console.log(`// Decimal: ${nullifierHashBigInt.toString()}`);
  console.log('');
  
  // Test 2: Commitment
  console.log('// Test 2: Commitment');
  console.log('// Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)');
  const secretBigInt = bytesToBigInt(testSecret);
  const commitmentResult = poseidon([DOMAIN_COMMIT, nullifierBigInt, secretBigInt, testAmount]);
  const commitmentBigInt = poseidon.F.toObject(commitmentResult);
  const commitment = bigIntToBytes(commitmentBigInt);
  
  console.log('let expected_commitment = [');
  for (let i = 0; i < 32; i += 8) {
    const chunk = Array.from(commitment.slice(i, i + 8))
      .map(b => `0x${b.toString(16).padStart(2, '0')}`)
      .join(', ');
    console.log(`    ${chunk},`);
  }
  console.log('];');
  console.log(`// Hex: ${bytesToHex(commitment)}`);
  console.log(`// Decimal: ${commitmentBigInt.toString()}`);
  console.log('');
  
  // Test 3: Binding Hash
  console.log('// Test 3: Binding Hash');
  console.log('// Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)');
  const recipientBigInt = bytesToBigInt(testRecipient);
  const relayerBigInt = bytesToBigInt(testRelayer);
  const bindingHashResult = poseidon([
    DOMAIN_BIND,
    nullifierHashBigInt,
    recipientBigInt,
    relayerBigInt,
    testFee
  ]);
  const bindingHashBigInt = poseidon.F.toObject(bindingHashResult);
  const bindingHash = bigIntToBytes(bindingHashBigInt);
  
  console.log('let expected_binding_hash = [');
  for (let i = 0; i < 32; i += 8) {
    const chunk = Array.from(bindingHash.slice(i, i + 8))
      .map(b => `0x${b.toString(16).padStart(2, '0')}`)
      .join(', ');
    console.log(`    ${chunk},`);
  }
  console.log('];');
  console.log(`// Hex: ${bytesToHex(bindingHash)}`);
  console.log(`// Decimal: ${bindingHashBigInt.toString()}`);
  console.log('');
  
  // Test 4: Merkle Node Hash
  console.log('// Test 4: Merkle Node Hash');
  console.log('// Poseidon(left, right) - no domain tag');
  const merkleHashResult = poseidon([nullifierBigInt, secretBigInt]);
  const merkleHashBigInt = poseidon.F.toObject(merkleHashResult);
  const merkleHash = bigIntToBytes(merkleHashBigInt);
  
  console.log('let expected_merkle_hash = [');
  for (let i = 0; i < 32; i += 8) {
    const chunk = Array.from(merkleHash.slice(i, i + 8))
      .map(b => `0x${b.toString(16).padStart(2, '0')}`)
      .join(', ');
    console.log(`    ${chunk},`);
  }
  console.log('];');
  console.log(`// Hex: ${bytesToHex(merkleHash)}`);
  console.log(`// Decimal: ${merkleHashBigInt.toString()}`);
  console.log('');
  
  console.log('='.repeat(80));
  console.log('Copy the arrays above into tests/poseidon_cross_implementation_test.rs');
  console.log('='.repeat(80));
}

main().catch(console.error);
