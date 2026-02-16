use anchor_lang::prelude::*;

#[account]
pub struct GlobalConfig {
    /// Admin who can update config
    pub admin: Pubkey,

    /// Treasury that receives credit payments
    pub relayer_treasury: Pubkey,

    /// Only this relayer can execute deposits
    pub authorized_relayer: Pubkey,

    /// RSA public key for blind signatures (n component, 256 bytes)
    pub relayer_signing_key_n: [u8; 256],

    /// RSA public key exponent (e component, typically 65537)
    pub relayer_signing_key_e: [u8; 4],

    /// Fee in basis points (e.g., 50 = 0.5%)
    pub fee_bps: u16,

    /// Minimum withdrawal delay in hours
    pub min_delay_hours: u8,

    /// Maximum withdrawal delay in hours
    pub max_delay_hours: u8,

    /// Whether protocol is paused
    pub paused: bool,

    /// PDA bump
    pub bump: u8,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            admin: Pubkey::default(),
            relayer_treasury: Pubkey::default(),
            authorized_relayer: Pubkey::default(),
            relayer_signing_key_n: [0u8; 256],
            relayer_signing_key_e: [0u8; 4],
            fee_bps: 0,
            min_delay_hours: 0,
            max_delay_hours: 0,
            paused: false,
            bump: 0,
        }
    }
}

impl GlobalConfig {
    pub const SIZE: usize = 8 + // discriminator
        32 + // admin
        32 + // relayer_treasury
        32 + // authorized_relayer
        256 + // relayer_signing_key_n
        4 + // relayer_signing_key_e
        2 + // fee_bps
        1 + // min_delay_hours
        1 + // max_delay_hours
        1 + // paused
        1 + // bump
        64; // padding for future use
}
