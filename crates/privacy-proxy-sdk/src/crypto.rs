use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use ark_bn254::Fr;
use light_poseidon::{Poseidon, PoseidonBytesHasher};
use rand::RngCore;

use crate::error::{Result, SdkError};

// Domain tags for hash separation (MUST match circuits/*.circom)
pub const DOMAIN_NULLIFIER: u64 = 1853189228; // "null" as u32
pub const DOMAIN_COMMIT: u64 = 1668246637; // "comm" as u32
pub const DOMAIN_BIND: u64 = 1651076196; // "bind" as u32
pub const DOMAIN_OWNER_BIND: u64 = 1869771618; // "ownb" as u32

// BN254 field modulus (approximately 2^254)
// We ensure all inputs are less than this by masking the top bits
#[allow(dead_code)]
const BN254_MODULUS_BYTES: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// Generate a random 32-byte secret that is valid for BN254 field
/// (guaranteed non-zero and less than field modulus)
pub fn random_secret() -> [u8; 32] {
    let mut secret = [0u8; 32];
    loop {
        rand::thread_rng().fill_bytes(&mut secret);
        // Mask top bits to ensure value is less than field modulus
        // BN254 modulus starts with 0x30, so we mask to ensure first byte < 0x30
        secret[0] &= 0x1F;
        if secret.iter().any(|&b| b != 0) {
            return secret;
        }
    }
}

/// Reduce a 32-byte value to be within BN254 field
/// This ensures the value is less than the field modulus
pub fn reduce_to_field(value: &[u8; 32]) -> [u8; 32] {
    let mut result = *value;
    // Simple reduction: mask top bits to ensure value < modulus
    // BN254 modulus is ~2^254, so we clear the top 2 bits
    result[0] &= 0x1F;
    result
}

pub fn validate_non_zero(value: &[u8; 32]) -> Result<()> {
    if value.iter().all(|&b| b == 0) {
        return Err(SdkError::Crypto("Value must be non-zero".into()));
    }
    Ok(())
}

pub fn validate_fee(fee: u64, amount: u64) -> Result<()> {
    if fee >= amount {
        return Err(SdkError::Crypto(format!(
            "Fee ({}) must be less than amount ({})",
            fee, amount
        )));
    }
    Ok(())
}

/// Poseidon hash of multiple 32-byte inputs
pub fn poseidon_hash(inputs: &[&[u8; 32]]) -> Result<[u8; 32]> {
    let mut poseidon = Poseidon::<Fr>::new_circom(inputs.len())
        .map_err(|e| SdkError::Crypto(format!("Poseidon init failed: {}", e)))?;

    // Convert &[&[u8; 32]] to Vec<&[u8]> for hash_bytes_be
    let inputs_as_slices: Vec<&[u8]> = inputs.iter().map(|arr| arr.as_slice()).collect();

    let result = poseidon
        .hash_bytes_be(&inputs_as_slices)
        .map_err(|e| SdkError::Crypto(format!("Poseidon hash failed: {}", e)))?;

    Ok(result)
}

pub fn poseidon_hash_with_domain(domain: u64, inputs: &[&[u8; 32]]) -> Result<[u8; 32]> {
    let mut domain_bytes = [0u8; 32];
    domain_bytes[24..32].copy_from_slice(&domain.to_be_bytes());

    let mut all_inputs = vec![&domain_bytes];
    all_inputs.extend(inputs);

    poseidon_hash(&all_inputs)
}

/// Generate commitment: Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
pub fn generate_commitment(
    nullifier: &[u8; 32],
    secret: &[u8; 32],
    amount: u64,
) -> Result<[u8; 32]> {
    validate_non_zero(nullifier)?;
    validate_non_zero(secret)?;

    if amount == 0 {
        return Err(SdkError::Crypto("Amount must be non-zero".into()));
    }

    let mut amount_bytes = [0u8; 32];
    amount_bytes[24..32].copy_from_slice(&amount.to_be_bytes());

    poseidon_hash_with_domain(DOMAIN_COMMIT, &[nullifier, secret, &amount_bytes])
}

/// Generate nullifier hash: Poseidon(DOMAIN_NULLIFIER, nullifier)
pub fn generate_nullifier_hash(nullifier: &[u8; 32]) -> Result<[u8; 32]> {
    validate_non_zero(nullifier)?;
    poseidon_hash_with_domain(DOMAIN_NULLIFIER, &[nullifier])
}

/// Generate withdrawal binding hash: Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
/// Note: recipient and relayer should already be field elements (from circuit's publicSignals)
pub fn generate_withdrawal_binding_hash(
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32],
    relayer: &[u8; 32],
    fee: u64,
) -> Result<[u8; 32]> {
    let mut fee_bytes = [0u8; 32];
    fee_bytes[24..32].copy_from_slice(&fee.to_be_bytes());

    // recipient and relayer are already field elements from the circuit
    // (snarkjs reduces them mod BN254 if needed)
    // DO NOT apply additional reduction here
    poseidon_hash_with_domain(
        DOMAIN_BIND,
        &[nullifier_hash, recipient, relayer, &fee_bytes],
    )
}

/// Generate ownership binding hash: Poseidon(DOMAIN_OWNER_BIND, nullifier, pendingWithdrawalId)
pub fn generate_ownership_binding_hash(
    nullifier: &[u8; 32],
    pending_withdrawal_id: u64,
) -> Result<[u8; 32]> {
    validate_non_zero(nullifier)?;

    let mut id_bytes = [0u8; 32];
    id_bytes[24..32].copy_from_slice(&pending_withdrawal_id.to_be_bytes());

    poseidon_hash_with_domain(DOMAIN_OWNER_BIND, &[nullifier, &id_bytes])
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct EncryptedPayload {
    pub ciphertext: Vec<u8>,
    pub nonce: [u8; 12],
}

pub fn encrypt_payload(plaintext: &[u8], key: &[u8; 32]) -> EncryptedPayload {
    let cipher = Aes256Gcm::new_from_slice(key).expect("Valid key length");

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .expect("Encryption should not fail");

    EncryptedPayload {
        ciphertext,
        nonce: nonce_bytes,
    }
}

pub fn decrypt_payload(encrypted: &EncryptedPayload, key: &[u8; 32]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).expect("Valid key length");
    let nonce = Nonce::from_slice(&encrypted.nonce);

    cipher
        .decrypt(nonce, encrypted.ciphertext.as_ref())
        .map_err(|_| SdkError::Crypto("Decryption failed".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commitment_generation() {
        let nullifier = random_secret();
        let secret = random_secret();
        let amount = 1_000_000_000u64;

        let commitment1 = generate_commitment(&nullifier, &secret, amount).unwrap();
        let commitment2 = generate_commitment(&nullifier, &secret, amount).unwrap();

        // Deterministic
        assert_eq!(commitment1, commitment2);

        // Different inputs = different commitment
        let other_secret = random_secret();
        let commitment3 = generate_commitment(&nullifier, &other_secret, amount).unwrap();
        assert_ne!(commitment1, commitment3);
    }

    #[test]
    fn test_nullifier_hash() {
        let nullifier = random_secret();

        let hash1 = generate_nullifier_hash(&nullifier).unwrap();
        let hash2 = generate_nullifier_hash(&nullifier).unwrap();

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_encryption_roundtrip() {
        let key = random_secret();
        let plaintext = b"secret message";

        let encrypted = encrypt_payload(plaintext, &key);
        let decrypted = decrypt_payload(&encrypted, &key).unwrap();

        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_zero_validation() {
        let zero = [0u8; 32];
        assert!(validate_non_zero(&zero).is_err());

        let non_zero = random_secret();
        assert!(validate_non_zero(&non_zero).is_ok());
    }
}
