/// prevents double-redemption of blinded credits
use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct UsedToken {
    /// Hash of the redeemed token_id
    pub token_hash: [u8; 32],

    /// Timestamp when redeemed
    pub redeemed_at: i64,

    /// PDA bump
    pub bump: u8,
}

impl UsedToken {
    pub const SIZE: usize = 8 + // discriminator
        32 + // token_hash
        8 + // redeemed_at
        1 + // bump
        16; // padding
}
