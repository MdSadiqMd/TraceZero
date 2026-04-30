/// M-13 FIX: Validate field elements used as Solana addresses
/// Ensures that BN254 field elements can be safely used as Pubkeys
use anchor_lang::prelude::*;
use crate::errors::PrivacyProxyError;

/// BN254 field modulus (same as used in circuits)
/// p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
const BN254_FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// Validate that a field element can be safely used as a Solana address
/// 
/// Checks:
/// 1. Value is not zero (invalid address)
/// 2. Value is less than BN254 field modulus (circuit constraint)
/// 
/// Note: We do NOT check Ed25519 order because Solana Pubkeys are Ed25519 points
/// (public keys), not scalars (private keys). The Ed25519 order constraint only
/// applies to scalars. Any 32-byte value can potentially be a valid Ed25519 point.
/// 
/// The stealth address generation already ensures BN254 compatibility, and the
/// circuit verification ensures the proof is valid for this recipient.
pub fn validate_field_as_address(field_element: &[u8; 32]) -> Result<()> {
    // 1. Check not zero
    if field_element.iter().all(|&b| b == 0) {
        msg!("Invalid address: zero address");
        return Err(PrivacyProxyError::InvalidRecipient.into());
    }

    // 2. Check less than BN254 field modulus
    // This should always be true if the circuit is correct, but we verify
    // as defense-in-depth
    if !is_less_than(field_element, &BN254_FIELD_MODULUS) {
        msg!("Invalid address: >= BN254 field modulus");
        return Err(PrivacyProxyError::InvalidRecipient.into());
    }

    // Note: We intentionally do NOT check Ed25519 order here because:
    // - Solana addresses are Ed25519 points (public keys), not scalars
    // - Ed25519 order only constrains scalars (private keys)
    // - Most 32-byte values are valid Ed25519 points
    // - The stealth address generation ensures proper derivation
    // - The ZK proof ensures the recipient is correctly committed

    Ok(())
}

/// Compare two 32-byte values in big-endian
/// Returns true if a < b
fn is_less_than(a: &[u8; 32], b: &[u8; 32]) -> bool {
    for i in 0..32 {
        if a[i] < b[i] {
            return true;
        } else if a[i] > b[i] {
            return false;
        }
    }
    // Equal
    false
}

/// Additional validation: Check if recipient account can receive lamports
/// This is called during execute_withdrawal to ensure funds won't be lost
pub fn validate_recipient_can_receive(
    recipient: &AccountInfo,
    amount: u64,
) -> Result<()> {
    // 1. Check if account exists
    let exists = recipient.lamports() > 0 || !recipient.data_is_empty();

    if exists {
        // Account exists - verify it's not a program account
        // (programs can't receive lamports directly)
        if recipient.executable {
            msg!("Invalid recipient: cannot send to executable account");
            return Err(PrivacyProxyError::InvalidRecipient.into());
        }

        // Account exists and is not executable - OK to receive
        return Ok(());
    }

    // 2. Account doesn't exist - will be created by receiving lamports
    // Verify amount is >= rent-exempt minimum for a new account
    let rent = Rent::get()?;
    let min_balance = rent.minimum_balance(0); // 0 bytes of data

    if amount < min_balance {
        msg!(
            "Invalid recipient: amount {} < rent-exempt minimum {}",
            amount,
            min_balance
        );
        return Err(PrivacyProxyError::InvalidRecipient.into());
    }

    // Amount is sufficient to create account - OK
    Ok(())
}

/// Validate recipient during withdrawal request
/// This is a lightweight check that doesn't require the recipient account
pub fn validate_recipient_field_element(recipient: &[u8; 32]) -> Result<Pubkey> {
    // Validate the field element
    validate_field_as_address(recipient)?;

    // Convert to Pubkey
    let pubkey = Pubkey::new_from_array(*recipient);

    // Additional check: Ensure it's not the system program
    if pubkey == anchor_lang::solana_program::system_program::ID {
        msg!("Invalid recipient: cannot send to system program");
        return Err(PrivacyProxyError::InvalidRecipient.into());
    }

    Ok(pubkey)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_less_than() {
        // Test a < b
        let a = [0u8; 32];
        let mut b = [0u8; 32];
        b[31] = 1;
        assert!(is_less_than(&a, &b));

        // Test a > b
        assert!(!is_less_than(&b, &a));

        // Test a == b
        assert!(!is_less_than(&a, &a));
    }

    #[test]
    fn test_validate_zero_address() {
        let zero = [0u8; 32];
        assert!(validate_field_as_address(&zero).is_err());
    }

    #[test]
    fn test_validate_max_value() {
        let max = [0xFFu8; 32];
        // Should fail - exceeds both moduli
        assert!(validate_field_as_address(&max).is_err());
    }

    #[test]
    fn test_validate_valid_address() {
        // Small value - should pass
        let mut addr = [0u8; 32];
        addr[31] = 1;
        assert!(validate_field_as_address(&addr).is_ok());
    }

    #[test]
    fn test_validate_bn254_boundary() {
        // Value equal to BN254 modulus - should fail
        assert!(validate_field_as_address(&BN254_FIELD_MODULUS).is_err());

        // Value just below BN254 modulus - should pass
        let mut just_below = BN254_FIELD_MODULUS;
        just_below[31] = just_below[31].wrapping_sub(1);
        assert!(validate_field_as_address(&just_below).is_ok());
    }

    #[test]
    fn test_validate_typical_solana_address() {
        // Typical Solana address (random-looking bytes)
        let addr = [
            20, 97, 83, 150, 62, 251, 183, 69,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
        ];
        // Should pass - it's < BN254 modulus and non-zero
        assert!(validate_field_as_address(&addr).is_ok());
    }

    #[test]
    fn test_validate_recipient_field_element() {
        // Valid address
        let mut addr = [0u8; 32];
        addr[31] = 1;
        assert!(validate_recipient_field_element(&addr).is_ok());

        // Zero address
        let zero = [0u8; 32];
        assert!(validate_recipient_field_element(&zero).is_err());

        // System program (11111111111111111111111111111111)
        // This is actually all zeros in bytes, so already caught above
    }
}
