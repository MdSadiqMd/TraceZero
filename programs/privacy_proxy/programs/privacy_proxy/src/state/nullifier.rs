use anchor_lang::prelude::*;

/// Nullifier record - created when withdrawal is executed
/// Existence of this account proves the nullifier was used
#[account]
#[derive(Default)]
pub struct NullifierRecord {
    /// The nullifier hash that was spent
    pub nullifier_hash: [u8; 32],

    /// Timestamp when spent
    pub spent_at: i64,

    /// Pool this nullifier was spent from
    pub pool: Pubkey,

    /// PDA bump
    pub bump: u8,
}

impl NullifierRecord {
    pub const SIZE: usize = 8 + // discriminator
        32 + // nullifier_hash
        8 + // spent_at
        32 + // pool
        1 + // bump
        16; // padding
}
