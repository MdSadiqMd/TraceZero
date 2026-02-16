use anchor_lang::prelude::*;

use crate::constants::MAX_ENCRYPTED_NOTE_SIZE;

/// Contains encrypted (nullifier, secret, commitment, merkle_index)
/// Only the user can decrypt with their viewing key
#[account]
pub struct EncryptedNote {
    /// Pool this note belongs to
    pub pool: Pubkey,

    /// Leaf index in the Merkle tree (for user to locate their note)
    /// This is NOT the commitment - it's just a sequential index
    pub leaf_index: u64,

    /// Encrypted data (nullifier, secret, commitment, merkle_index)
    /// The commitment is ONLY stored encrypted, never in plaintext
    pub ciphertext: [u8; MAX_ENCRYPTED_NOTE_SIZE],

    /// Actual length of ciphertext
    pub ciphertext_len: u16,

    /// Ephemeral public key for ECDH decryption
    pub ephemeral_pubkey: [u8; 32],

    /// Timestamp when created
    pub created_at: i64,

    /// PDA bump
    pub bump: u8,
}

impl Default for EncryptedNote {
    fn default() -> Self {
        Self {
            pool: Pubkey::default(),
            leaf_index: 0,
            ciphertext: [0u8; MAX_ENCRYPTED_NOTE_SIZE],
            ciphertext_len: 0,
            ephemeral_pubkey: [0u8; 32],
            created_at: 0,
            bump: 0,
        }
    }
}

impl EncryptedNote {
    pub const SIZE: usize = 8 + // discriminator
        32 + // pool
        8 + // leaf_index (replaced commitment)
        MAX_ENCRYPTED_NOTE_SIZE + // ciphertext
        2 + // ciphertext_len
        32 + // ephemeral_pubkey
        8 + // created_at
        1 + // bump
        32; // padding
}
