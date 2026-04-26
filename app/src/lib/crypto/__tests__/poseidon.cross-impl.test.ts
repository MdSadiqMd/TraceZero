/**
 * Cross-Implementation Poseidon Test Vectors
 * M-03 FIX: Verify TypeScript implementation matches Rust and Circuit
 * 
 * This test generates reference values that should match:
 * 1. Rust SDK (light-poseidon)
 * 2. Rust Relayer (light-poseidon)
 * 3. Circom Circuit (circomlib)
 * 
 * Run this test to generate expected values, then verify against Rust tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateCommitment,
  generateNullifierHash,
  generateWithdrawalBindingHash,
  hashMerkleNodes,
  bytesToBigInt,
  DOMAIN_NULLIFIER,
  DOMAIN_COMMIT,
  DOMAIN_BIND,
} from '../poseidon';

// Helper to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Helper to convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Poseidon Cross-Implementation Test Vectors', () => {
  // Test vectors with known inputs
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
  
  const testAmount = 1_000_000_000n; // 1 SOL
  const testFee = 10_000_000n; // 0.01 SOL

  it('should verify domain tags match circuit values', () => {
    expect(DOMAIN_NULLIFIER).toBe(1853189228n);
    expect(DOMAIN_COMMIT).toBe(1668246637n);
    expect(DOMAIN_BIND).toBe(1651076196n);
  });

  it('should generate nullifier hash (2 inputs with domain)', async () => {
    const result = await generateNullifierHash(testNullifier);
    
    console.log('\n=== Nullifier Hash Test Vector ===');
    console.log('Input nullifier:', bytesToHex(testNullifier));
    console.log('Domain:', DOMAIN_NULLIFIER.toString());
    console.log('Output hash:', bytesToHex(result));
    console.log('Output (decimal):', bytesToBigInt(result).toString());
    
    // Verify deterministic
    const result2 = await generateNullifierHash(testNullifier);
    expect(bytesToHex(result)).toBe(bytesToHex(result2));
  });

  it('should generate commitment (4 inputs with domain)', async () => {
    const result = await generateCommitment(testNullifier, testSecret, testAmount);
    
    console.log('\n=== Commitment Test Vector ===');
    console.log('Input nullifier:', bytesToHex(testNullifier));
    console.log('Input secret:', bytesToHex(testSecret));
    console.log('Input amount:', testAmount.toString());
    console.log('Domain:', DOMAIN_COMMIT.toString());
    console.log('Output commitment:', bytesToHex(result));
    console.log('Output (decimal):', bytesToBigInt(result).toString());
    
    // Verify deterministic
    const result2 = await generateCommitment(testNullifier, testSecret, testAmount);
    expect(bytesToHex(result)).toBe(bytesToHex(result2));
  });

  it('should generate binding hash (5 inputs with domain)', async () => {
    const nullifierHash = await generateNullifierHash(testNullifier);
    const result = await generateWithdrawalBindingHash(
      nullifierHash,
      testRecipient,
      testRelayer,
      testFee
    );
    
    console.log('\n=== Binding Hash Test Vector ===');
    console.log('Input nullifierHash:', bytesToHex(nullifierHash));
    console.log('Input recipient:', bytesToHex(testRecipient));
    console.log('Input relayer:', bytesToHex(testRelayer));
    console.log('Input fee:', testFee.toString());
    console.log('Domain:', DOMAIN_BIND.toString());
    console.log('Output bindingHash:', bytesToHex(result));
    console.log('Output (decimal):', bytesToBigInt(result).toString());
    
    // Verify deterministic
    const result2 = await generateWithdrawalBindingHash(
      nullifierHash,
      testRecipient,
      testRelayer,
      testFee
    );
    expect(bytesToHex(result)).toBe(bytesToHex(result2));
  });

  it('should hash merkle tree nodes (2 inputs, no domain)', async () => {
    const left = testNullifier;
    const right = testSecret;
    
    const result = await hashMerkleNodes(left, right);
    
    console.log('\n=== Merkle Node Hash Test Vector ===');
    console.log('Input left:', bytesToHex(left));
    console.log('Input right:', bytesToHex(right));
    console.log('Output hash:', bytesToHex(result));
    console.log('Output (decimal):', bytesToBigInt(result).toString());
    
    // Verify deterministic
    const result2 = await hashMerkleNodes(left, right);
    expect(bytesToHex(result)).toBe(bytesToHex(result2));
    
    // Verify not commutative (order matters)
    const resultReversed = await hashMerkleNodes(right, left);
    expect(bytesToHex(result)).not.toBe(bytesToHex(resultReversed));
  });

  it('should handle zero inputs', async () => {
    const zero = new Uint8Array(32);
    
    const nullifierHash = await generateNullifierHash(zero);
    console.log('\n=== Zero Nullifier Hash ===');
    console.log('Output:', bytesToHex(nullifierHash));
    
    const commitment = await generateCommitment(zero, zero, 0n);
    console.log('\n=== Zero Commitment ===');
    console.log('Output:', bytesToHex(commitment));
    
    // Should be deterministic
    const nullifierHash2 = await generateNullifierHash(zero);
    expect(bytesToHex(nullifierHash)).toBe(bytesToHex(nullifierHash2));
  });

  it('should handle maximum field element', async () => {
    // BN254 modulus - 1
    const maxField = hexToBytes(
      '30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000'
    );
    
    const result = await generateNullifierHash(maxField);
    console.log('\n=== Max Field Nullifier Hash ===');
    console.log('Input:', bytesToHex(maxField));
    console.log('Output:', bytesToHex(result));
    
    // Should be deterministic
    const result2 = await generateNullifierHash(maxField);
    expect(bytesToHex(result)).toBe(bytesToHex(result2));
  });

  it('should generate comprehensive test vectors for Rust verification', async () => {
    console.log('\n\n=== COMPREHENSIVE TEST VECTORS FOR RUST ===\n');
    
    // Test 1: Nullifier Hash
    const nullifierHash = await generateNullifierHash(testNullifier);
    console.log('// Test 1: Nullifier Hash');
    console.log('let expected_nullifier_hash = [');
    for (let i = 0; i < 32; i += 8) {
      const chunk = Array.from(nullifierHash.slice(i, i + 8))
        .map(b => `0x${b.toString(16).padStart(2, '0')}`)
        .join(', ');
      console.log(`    ${chunk},`);
    }
    console.log('];');
    console.log('');
    
    // Test 2: Commitment
    const commitment = await generateCommitment(testNullifier, testSecret, testAmount);
    console.log('// Test 2: Commitment');
    console.log('let expected_commitment = [');
    for (let i = 0; i < 32; i += 8) {
      const chunk = Array.from(commitment.slice(i, i + 8))
        .map(b => `0x${b.toString(16).padStart(2, '0')}`)
        .join(', ');
      console.log(`    ${chunk},`);
    }
    console.log('];');
    console.log('');
    
    // Test 3: Binding Hash
    const bindingHash = await generateWithdrawalBindingHash(
      nullifierHash,
      testRecipient,
      testRelayer,
      testFee
    );
    console.log('// Test 3: Binding Hash');
    console.log('let expected_binding_hash = [');
    for (let i = 0; i < 32; i += 8) {
      const chunk = Array.from(bindingHash.slice(i, i + 8))
        .map(b => `0x${b.toString(16).padStart(2, '0')}`)
        .join(', ');
      console.log(`    ${chunk},`);
    }
    console.log('];');
    console.log('');
    
    // Test 4: Merkle Node Hash
    const merkleHash = await hashMerkleNodes(testNullifier, testSecret);
    console.log('// Test 4: Merkle Node Hash');
    console.log('let expected_merkle_hash = [');
    for (let i = 0; i < 32; i += 8) {
      const chunk = Array.from(merkleHash.slice(i, i + 8))
        .map(b => `0x${b.toString(16).padStart(2, '0')}`)
        .join(', ');
      console.log(`    ${chunk},`);
    }
    console.log('];');
  });
});
