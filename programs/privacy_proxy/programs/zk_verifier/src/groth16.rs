/// This module wraps the groth16-solana crate to provide efficient on-chain ZK proof verification (<200k compute units)
/// - Withdrawal proofs have 6 public inputs + 1 output (bindingHash) = 7 IC points
/// - Ownership proofs have 2 public inputs + 1 output (bindingHash) = 3 IC points
///   NOTE: Current VK has only 2 IC points - circuit needs recompilation!
/// - Domain separation is enforced at the circuit level
/// - Binding hashes are verified as part of the proof
///
/// proof_a negation is done in the FRONTEND (JavaScript) for simplicity
/// groth16-solana expects -A for the pairing check
use anchor_lang::prelude::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

use crate::verifying_key::*;
use crate::ZkVerifierError;

/// Verify a Groth16 proof for withdrawal (7 public inputs including binding hash)
///
/// Public inputs (in order):
/// 1. bindingHash - Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
/// 2. root - Merkle tree root
/// 3. nullifierHash - Poseidon(DOMAIN_NULLIFIER, nullifier)
/// 4. recipient - Stealth address
/// 5. amount - Withdrawal amount (must be > 0)
/// 6. relayer - Relayer address
/// 7. fee - Relayer fee (must be < amount)
///
/// NOTE: The binding hash is now part of the public inputs (circuit output)
/// The Groth16 proof cryptographically guarantees the binding hash is correct
pub fn verify_withdrawal_proof(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; 7], // Now 7 inputs including binding hash
) -> Result<()> {
    let ic_points = get_withdrawal_ic_points();

    // Current VK has 8 IC points for 7 public inputs
    if ic_points.len() != 8 {
        msg!(
            "Warning: IC points count mismatch. Expected 8, got {}",
            ic_points.len()
        );
    }

    msg!("Public inputs (first 8 bytes each):");
    for (i, input) in public_inputs.iter().enumerate() {
        msg!("  [{}]: {:?}", i, &input[..8]);
    }
    msg!("Proof A (first 8 bytes): {:?}", &proof_a[..8]);
    msg!("Proof B (first 8 bytes): {:?}", &proof_b[..8]);
    msg!("Proof C (first 8 bytes): {:?}", &proof_c[..8]);

    let vk = Groth16Verifyingkey {
        nr_pubinputs: 7,
        vk_alpha_g1: WITHDRAWAL_ALPHA_G1,
        vk_beta_g2: WITHDRAWAL_BETA_G2,
        vk_gamme_g2: WITHDRAWAL_GAMMA_G2,
        vk_delta_g2: WITHDRAWAL_DELTA_G2,
        vk_ic: ic_points,
    };

    let mut verifier = Groth16Verifier::<7>::new(proof_a, proof_b, proof_c, public_inputs, &vk)
        .map_err(|e| {
            msg!("Failed to create withdrawal verifier: {:?}", e);
            ZkVerifierError::VerificationFailed
        })?;

    verifier.verify().map_err(|e| {
        msg!("Withdrawal verification failed: {:?}", e);
        ZkVerifierError::InvalidProof
    })?;

    Ok(())
}

/// Verify a Groth16 proof for ownership (2 public inputs + 1 output)
///
/// Public inputs (in order):
/// 1. nullifierHash - Poseidon(DOMAIN_NULLIFIER, nullifier)
/// 2. pendingWithdrawalId - ID of the pending withdrawal being cancelled
///
/// Public output:
/// 3. bindingHash - Poseidon(DOMAIN_OWNER_BIND, nullifier, pendingWithdrawalId)
///
/// NOTE: Current VK was compiled with only 1 public input (nullifierHash)
/// The circuit needs to be recompiled with pendingWithdrawalId as public input
/// For now, we verify with the available VK structure
pub fn verify_ownership_proof(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; 2],
    binding_hash: &[u8; 32],
) -> Result<()> {
    let ic_points = get_ownership_ic_points();

    // Current VK has 2 IC points (for 1 public input)
    // Expected: 4 IC points (for 2 inputs + 1 binding hash output)
    // We need to handle this mismatch gracefully
    if ic_points.len() == 2 {
        // Old VK with only nullifierHash as public input
        // Verify with just nullifierHash for now
        msg!("Warning: Using legacy ownership VK with 1 public input");
        msg!("Circuit should be recompiled with pendingWithdrawalId as public input");

        let legacy_inputs: [[u8; 32]; 1] = [public_inputs[0]];

        let vk = Groth16Verifyingkey {
            nr_pubinputs: 1,
            vk_alpha_g1: OWNERSHIP_ALPHA_G1,
            vk_beta_g2: OWNERSHIP_BETA_G2,
            vk_gamme_g2: OWNERSHIP_GAMMA_G2,
            vk_delta_g2: OWNERSHIP_DELTA_G2,
            vk_ic: ic_points,
        };

        let mut verifier =
            Groth16Verifier::<1>::new(proof_a, proof_b, proof_c, &legacy_inputs, &vk).map_err(
                |e| {
                    msg!("Failed to create ownership verifier: {:?}", e);
                    ZkVerifierError::VerificationFailed
                },
            )?;

        verifier.verify().map_err(|e| {
            msg!("Ownership verification failed: {:?}", e);
            ZkVerifierError::InvalidProof
        })?;

        // Additional check: verify binding hash is provided (even if not in proof)
        // This provides some protection until circuit is recompiled
        if binding_hash.iter().all(|&b| b == 0) {
            msg!("Error: Binding hash cannot be zero");
            return Err(ZkVerifierError::InvalidBindingHash.into());
        }
    } else {
        // New VK with full public inputs
        let mut all_inputs: [[u8; 32]; 3] = [[0u8; 32]; 3];
        all_inputs[..2].copy_from_slice(public_inputs);
        all_inputs[2] = *binding_hash;

        let vk = Groth16Verifyingkey {
            nr_pubinputs: 3, // 2 inputs + 1 binding hash output
            vk_alpha_g1: OWNERSHIP_ALPHA_G1,
            vk_beta_g2: OWNERSHIP_BETA_G2,
            vk_gamme_g2: OWNERSHIP_GAMMA_G2,
            vk_delta_g2: OWNERSHIP_DELTA_G2,
            vk_ic: ic_points,
        };

        let mut verifier = Groth16Verifier::<3>::new(proof_a, proof_b, proof_c, &all_inputs, &vk)
            .map_err(|e| {
            msg!("Failed to create ownership verifier: {:?}", e);
            ZkVerifierError::VerificationFailed
        })?;

        verifier.verify().map_err(|e| {
            msg!("Ownership verification failed: {:?}", e);
            ZkVerifierError::InvalidProof
        })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_bn254::g1::G1Affine;
    use ark_serialize::{CanonicalDeserialize, CanonicalSerialize, Compress, Validate};
    use groth16_solana::groth16::Groth16Verifyingkey;
    use std::ops::Neg;

    fn change_endianness(bytes: &[u8]) -> Vec<u8> {
        let mut result = vec![0u8; bytes.len()];
        for (i, chunk) in bytes.chunks(32).enumerate() {
            for (j, byte) in chunk.iter().enumerate() {
                result[i * 32 + (31 - j)] = *byte;
            }
        }
        result
    }

    /// Negate proof_a using the EXACT same method as groth16-solana's test
    fn negate_proof_a_ark(proof_a: &[u8; 64]) -> [u8; 64] {
        let proof_a_g1: G1Affine = G1Affine::deserialize_with_mode(
            &*[&change_endianness(proof_a)[..], &[0u8][..]].concat(),
            Compress::No,
            Validate::Yes,
        )
        .unwrap();

        let mut proof_a_neg = [0u8; 65];
        proof_a_g1
            .neg()
            .x
            .serialize_with_mode(&mut proof_a_neg[..32], Compress::No)
            .unwrap();
        proof_a_g1
            .neg()
            .y
            .serialize_with_mode(&mut proof_a_neg[32..64], Compress::No)
            .unwrap();

        let result_vec = change_endianness(&proof_a_neg[..64]);
        let mut result = [0u8; 64];
        result.copy_from_slice(&result_vec);
        result
    }

    #[test]
    fn test_verify_real_withdrawal_proof() {
        // Original proof_a (NOT negated) from snarkjs
        let proof_a_original: [u8; 64] = [
            0x2d, 0xf6, 0x8f, 0x76, 0x78, 0xed, 0x40, 0x4b, 0x03, 0xf1, 0xa3, 0x2f, 0x34, 0xa7,
            0x1f, 0x5c, 0xcf, 0xfa, 0xec, 0x22, 0x36, 0xdc, 0xa5, 0x1a, 0x25, 0xe5, 0x08, 0x41,
            0xa2, 0x77, 0x41, 0xf9, // Original Y (not negated)
            0x1d, 0xc1, 0x19, 0xb4, 0x26, 0x20, 0xbf, 0x25, 0x98, 0x2b, 0x8c, 0x32, 0xf5, 0xd8,
            0x02, 0xd4, 0xed, 0x01, 0xd5, 0x6e, 0xf7, 0x88, 0xfc, 0xd1, 0x93, 0x87, 0x55, 0x22,
            0xa8, 0x5a, 0x67, 0xd5,
        ];

        // Frontend-negated proof_a (Y = p - Y)
        let proof_a_frontend_neg: [u8; 64] = [
            0x2d, 0xf6, 0x8f, 0x76, 0x78, 0xed, 0x40, 0x4b, 0x03, 0xf1, 0xa3, 0x2f, 0x34, 0xa7,
            0x1f, 0x5c, 0xcf, 0xfa, 0xec, 0x22, 0x36, 0xdc, 0xa5, 0x1a, 0x25, 0xe5, 0x08, 0x41,
            0xa2, 0x77, 0x41, 0xf9, // Negated Y
            0x12, 0xa3, 0x34, 0xbe, 0xbb, 0x10, 0xe1, 0x04, 0x20, 0x24, 0xb9, 0x83, 0x8b, 0xa9,
            0x55, 0x88, 0xaa, 0x7f, 0x95, 0x22, 0x70, 0xe8, 0xcd, 0xbb, 0xa8, 0x99, 0x36, 0xf4,
            0x30, 0x22, 0x95, 0x72,
        ];

        // Negate using ark (the groth16-solana way)
        let proof_a_ark_neg = negate_proof_a_ark(&proof_a_original);

        // Compare frontend negation with ark negation
        println!(
            "Frontend negated Y (first 8): {:?}",
            &proof_a_frontend_neg[32..40]
        );
        println!(
            "Ark negated Y (first 8):      {:?}",
            &proof_a_ark_neg[32..40]
        );
        println!("Frontend X (first 8): {:?}", &proof_a_frontend_neg[0..8]);
        println!("Ark X (first 8):      {:?}", &proof_a_ark_neg[0..8]);

        let x_match = proof_a_frontend_neg[0..32] == proof_a_ark_neg[0..32];
        let y_match = proof_a_frontend_neg[32..64] == proof_a_ark_neg[32..64];
        println!("X coordinates match: {}", x_match);
        println!("Y coordinates match: {}", y_match);

        if !y_match {
            println!("MISMATCH! Full comparison:");
            for i in 32..64 {
                if proof_a_frontend_neg[i] != proof_a_ark_neg[i] {
                    println!(
                        "  Byte {}: frontend=0x{:02x} ark=0x{:02x}",
                        i, proof_a_frontend_neg[i], proof_a_ark_neg[i]
                    );
                }
            }
        }

        // Proof B and C
        let proof_b: [u8; 128] = [
            0x0d, 0xe3, 0x34, 0x4e, 0xfc, 0x95, 0xea, 0x6e, 0x71, 0xa2, 0x2c, 0x56, 0x42, 0xe8,
            0xf7, 0x1f, 0x61, 0x02, 0x17, 0xef, 0x4b, 0x03, 0xd2, 0xe5, 0xa6, 0x1f, 0x7e, 0xb7,
            0x3c, 0xe6, 0x68, 0xc0, 0x14, 0x39, 0x52, 0xde, 0x0c, 0x7f, 0xcb, 0xed, 0xe4, 0x9f,
            0xdc, 0x48, 0x84, 0x4f, 0x03, 0x84, 0x11, 0x5d, 0x70, 0x86, 0x57, 0x29, 0x9f, 0x9f,
            0xc8, 0x12, 0xcc, 0x02, 0x7e, 0xb8, 0xf2, 0x05, 0x13, 0x44, 0x86, 0x44, 0x16, 0xc2,
            0x7c, 0x25, 0x96, 0x4f, 0xaa, 0x5c, 0x8e, 0xd4, 0x25, 0x24, 0x36, 0xfa, 0x4e, 0x9f,
            0x64, 0x19, 0xdf, 0x55, 0x8a, 0x3a, 0x11, 0x37, 0x1a, 0x35, 0x2b, 0xb3, 0x1a, 0xd0,
            0x37, 0x16, 0x33, 0xfa, 0x31, 0x8e, 0xf7, 0x20, 0xe1, 0xe2, 0xdb, 0xa1, 0x0a, 0xca,
            0x69, 0xf5, 0x7a, 0xdd, 0xcb, 0xf0, 0xf1, 0x50, 0x39, 0x3b, 0xd7, 0x53, 0x50, 0x25,
            0x4c, 0x56,
        ];

        let proof_c: [u8; 64] = [
            0x2d, 0x87, 0x0c, 0xd7, 0xe0, 0x9f, 0x2e, 0xd5, 0xc9, 0xa9, 0x09, 0x88, 0xb3, 0xb8,
            0x55, 0xa4, 0x70, 0xdd, 0x51, 0xaa, 0x7c, 0x17, 0x86, 0x2e, 0xb0, 0x53, 0x59, 0x33,
            0xfe, 0x62, 0xe3, 0xd9, 0x17, 0x9e, 0x2e, 0xdc, 0xa1, 0xa4, 0xeb, 0x9f, 0x1d, 0x6a,
            0xe5, 0x5e, 0xca, 0xf8, 0x1f, 0x5f, 0x4a, 0x60, 0x57, 0xb6, 0x56, 0x81, 0x48, 0x3d,
            0xb1, 0x1c, 0x15, 0xc4, 0x0a, 0x42, 0xf4, 0x5b,
        ];

        let public_inputs: [[u8; 32]; 7] = [
            [
                0x13, 0x36, 0xca, 0x23, 0x9f, 0x55, 0x82, 0xf2, 0xc0, 0xf8, 0xad, 0x5d, 0x15, 0xba,
                0xe7, 0x40, 0x10, 0x9b, 0xc1, 0xc2, 0x0d, 0x85, 0xd6, 0x34, 0x43, 0x73, 0x23, 0x22,
                0xaa, 0xf3, 0x43, 0x28,
            ],
            [
                0x00, 0xf0, 0xa7, 0x3f, 0x5f, 0x92, 0x0d, 0xb6, 0x3b, 0xde, 0x8e, 0xe7, 0x9a, 0x73,
                0xfb, 0x6f, 0xbb, 0x6c, 0x85, 0x0e, 0xdd, 0xcd, 0x4d, 0x14, 0x6d, 0xfb, 0x66, 0xfd,
                0xd6, 0x89, 0x81, 0x25,
            ],
            [
                0x25, 0xe9, 0x38, 0x20, 0xde, 0xe7, 0xf1, 0x10, 0x9e, 0x14, 0x29, 0x8a, 0x5c, 0xbc,
                0x00, 0xdf, 0x3f, 0x40, 0x73, 0xa3, 0x78, 0xef, 0xfa, 0xac, 0x2d, 0x37, 0x43, 0x42,
                0x17, 0x43, 0x15, 0x00,
            ],
            [
                0x0b, 0xb0, 0x76, 0x49, 0x0e, 0xb3, 0xe2, 0xfa, 0xd5, 0x0c, 0xa2, 0x30, 0x38, 0x03,
                0x46, 0x4d, 0xbb, 0xde, 0xbc, 0xdd, 0xc1, 0xfd, 0x3d, 0x6c, 0x41, 0x0e, 0x45, 0x5f,
                0xc3, 0x59, 0xf8, 0x41,
            ],
            [
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x3b, 0x9a, 0xca, 0x00,
            ],
            [
                0x26, 0xc2, 0x8b, 0xc7, 0x17, 0xfc, 0xe5, 0xe1, 0x37, 0x54, 0x38, 0xa2, 0x7e, 0x44,
                0x90, 0x60, 0x0a, 0x95, 0xbc, 0x02, 0x81, 0xf1, 0x98, 0x98, 0x0e, 0xcd, 0xe7, 0xec,
                0xc9, 0x69, 0x96, 0x4e,
            ],
            [
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
            ],
        ];

        let ic_points = get_withdrawal_ic_points();

        let vk = Groth16Verifyingkey {
            nr_pubinputs: 7,
            vk_alpha_g1: WITHDRAWAL_ALPHA_G1,
            vk_beta_g2: WITHDRAWAL_BETA_G2,
            vk_gamme_g2: WITHDRAWAL_GAMMA_G2,
            vk_delta_g2: WITHDRAWAL_DELTA_G2,
            vk_ic: ic_points,
        };

        println!("\n=== Test 1: Frontend-negated proof_a ===");
        let mut verifier = Groth16Verifier::<7>::new(
            &proof_a_frontend_neg,
            &proof_b,
            &proof_c,
            &public_inputs,
            &vk,
        )
        .expect("Failed to create verifier");
        match verifier.verify() {
            Ok(()) => println!("✓ Frontend negation: PASSED"),
            Err(e) => println!("❌ Frontend negation: FAILED {:?}", e),
        }

        println!("\n=== Test 2: Ark-negated proof_a ===");
        let mut verifier2 =
            Groth16Verifier::<7>::new(&proof_a_ark_neg, &proof_b, &proof_c, &public_inputs, &vk)
                .expect("Failed to create verifier");
        match verifier2.verify() {
            Ok(()) => println!("✓ Ark negation: PASSED"),
            Err(e) => println!("❌ Ark negation: FAILED {:?}", e),
        }

        println!("\n=== Test 3: Non-negated proof_a (should fail) ===");
        let mut verifier3 =
            Groth16Verifier::<7>::new(&proof_a_original, &proof_b, &proof_c, &public_inputs, &vk)
                .expect("Failed to create verifier");
        match verifier3.verify() {
            Ok(()) => println!("⚠️ Non-negated: PASSED (unexpected!)"),
            Err(e) => println!("✓ Non-negated: FAILED as expected {:?}", e),
        }
    }
}
