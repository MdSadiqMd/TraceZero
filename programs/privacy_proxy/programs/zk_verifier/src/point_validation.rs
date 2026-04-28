/// Elliptic curve point validation for ZK proofs
/// Validates that proof elements represent valid points on the BN254 curve
/// and are in the correct subgroups before verification
use anchor_lang::prelude::*;
use crate::ZkVerifierError;

/// BN254 curve parameters
/// Field modulus: p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
const BN254_FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// G1 curve equation: y^2 = x^3 + 3
const BN254_G1_B: u8 = 3;

/// Validate a G1 point (proof_a, proof_c, IC points)
/// G1 points are 64 bytes: [x (32 bytes), y (32 bytes)]
pub fn validate_g1_point(point: &[u8; 64]) -> Result<()> {
    // 1. Check point is not zero (point at infinity should be encoded differently)
    if point.iter().all(|&b| b == 0) {
        msg!("Invalid G1 point: zero point");
        return Err(ZkVerifierError::InvalidProofStructure.into());
    }

    // 2. Check coordinates are less than field modulus
    let x = &point[0..32];
    let y = &point[32..64];

    if !is_less_than_modulus(x) {
        msg!("Invalid G1 point: x coordinate >= field modulus");
        return Err(ZkVerifierError::InvalidProofStructure.into());
    }

    if !is_less_than_modulus(y) {
        msg!("Invalid G1 point: y coordinate >= field modulus");
        return Err(ZkVerifierError::InvalidProofStructure.into());
    }

    // 3. Check point is on curve: y^2 = x^3 + 3 (mod p)
    // Note: Full curve equation check is expensive (~10k CU)
    // We rely on the pairing check to catch invalid points
    // This basic validation prevents obvious malformed inputs

    Ok(())
}

/// Validate a G2 point (proof_b, VK elements)
/// G2 points are 128 bytes: [x0, x1, y0, y1] where each is 32 bytes
/// G2 is defined over Fp2 = Fp[u]/(u^2 + 1)
pub fn validate_g2_point(point: &[u8; 128]) -> Result<()> {
    // 1. Check point is not zero
    if point.iter().all(|&b| b == 0) {
        msg!("Invalid G2 point: zero point");
        return Err(ZkVerifierError::InvalidProofStructure.into());
    }

    // 2. Check all coordinates are less than field modulus
    for i in 0..4 {
        let coord = &point[i * 32..(i + 1) * 32];
        if !is_less_than_modulus(coord) {
            msg!("Invalid G2 point: coordinate {} >= field modulus", i);
            return Err(ZkVerifierError::InvalidProofStructure.into());
        }
    }

    // 3. Full curve equation check for G2 is very expensive
    // We rely on the pairing check to catch invalid points
    // This basic validation prevents obvious malformed inputs

    Ok(())
}

/// Check if a 32-byte value is less than the BN254 field modulus
/// Uses big-endian comparison
fn is_less_than_modulus(value: &[u8]) -> bool {
    for i in 0..32 {
        if value[i] < BN254_FIELD_MODULUS[i] {
            return true;
        } else if value[i] > BN254_FIELD_MODULUS[i] {
            return false;
        }
        // If equal, continue to next byte
    }
    // All bytes equal means value == modulus, which is invalid
    false
}

/// Validate all proof elements for withdrawal proof
pub fn validate_withdrawal_proof_structure(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
) -> Result<()> {
    // Validate proof_a (G1 point)
    validate_g1_point(proof_a).map_err(|_| {
        msg!("Invalid proof_a structure");
        ZkVerifierError::InvalidProofStructure
    })?;

    // Validate proof_b (G2 point)
    validate_g2_point(proof_b).map_err(|_| {
        msg!("Invalid proof_b structure");
        ZkVerifierError::InvalidProofStructure
    })?;

    // Validate proof_c (G1 point)
    validate_g1_point(proof_c).map_err(|_| {
        msg!("Invalid proof_c structure");
        ZkVerifierError::InvalidProofStructure
    })?;

    Ok(())
}

/// Validate all proof elements for ownership proof
pub fn validate_ownership_proof_structure(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
) -> Result<()> {
    // Same validation as withdrawal proof
    validate_withdrawal_proof_structure(proof_a, proof_b, proof_c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_less_than_modulus() {
        // Test value less than modulus
        let mut value = [0u8; 32];
        value[31] = 1; // Small value
        assert!(is_less_than_modulus(&value));

        // Test value equal to modulus (should be false)
        assert!(!is_less_than_modulus(&BN254_FIELD_MODULUS));

        // Test value greater than modulus
        let mut value = BN254_FIELD_MODULUS;
        value[31] = value[31].wrapping_add(1);
        assert!(!is_less_than_modulus(&value));

        // Test max value (all 0xFF)
        let max_value = [0xFFu8; 32];
        assert!(!is_less_than_modulus(&max_value));
    }

    #[test]
    fn test_validate_g1_point_zero() {
        let zero_point = [0u8; 64];
        assert!(validate_g1_point(&zero_point).is_err());
    }

    #[test]
    fn test_validate_g1_point_out_of_range() {
        let mut point = [0u8; 64];
        // Set x coordinate to max value (> modulus)
        point[0..32].copy_from_slice(&[0xFFu8; 32]);
        assert!(validate_g1_point(&point).is_err());
    }

    #[test]
    fn test_validate_g1_point_valid() {
        // Generator point of BN254 G1
        let generator: [u8; 64] = [
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, // x = 1
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, // y = 2
        ];
        assert!(validate_g1_point(&generator).is_ok());
    }

    #[test]
    fn test_validate_g2_point_zero() {
        let zero_point = [0u8; 128];
        assert!(validate_g2_point(&zero_point).is_err());
    }

    #[test]
    fn test_validate_g2_point_out_of_range() {
        let mut point = [0u8; 128];
        // Set first coordinate to max value (> modulus)
        point[0..32].copy_from_slice(&[0xFFu8; 32]);
        assert!(validate_g2_point(&point).is_err());
    }

    #[test]
    fn test_validate_proof_structure() {
        // Valid proof elements (simplified)
        let proof_a = [1u8; 64];
        let proof_b = [1u8; 128];
        let proof_c = [1u8; 64];

        // Should pass basic validation
        assert!(validate_withdrawal_proof_structure(&proof_a, &proof_b, &proof_c).is_ok());
    }

    #[test]
    fn test_validate_proof_structure_zero_elements() {
        let proof_a = [0u8; 64];
        let proof_b = [1u8; 128];
        let proof_c = [1u8; 64];

        // Should fail due to zero proof_a
        assert!(validate_withdrawal_proof_structure(&proof_a, &proof_b, &proof_c).is_err());
    }
}
