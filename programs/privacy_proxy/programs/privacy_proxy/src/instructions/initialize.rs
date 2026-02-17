use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::GlobalConfig;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    pub relayer_treasury: Pubkey,
    pub authorized_relayer: Pubkey,
    pub relayer_signing_key_n: [u8; 256],
    pub relayer_signing_key_e: [u8; 4],
    pub fee_bps: u16,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = GlobalConfig::SIZE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, GlobalConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    let config = &mut ctx.accounts.config;

    config.admin = ctx.accounts.admin.key();
    config.relayer_treasury = params.relayer_treasury;
    config.authorized_relayer = params.authorized_relayer;
    config.relayer_signing_key_n = params.relayer_signing_key_n;
    config.relayer_signing_key_e = params.relayer_signing_key_e;
    config.fee_bps = params.fee_bps;
    config.min_delay_hours = MIN_DELAY_HOURS;
    config.max_delay_hours = MAX_DELAY_HOURS;
    config.paused = false;
    config.bump = ctx.bumps.config;

    msg!("Privacy-Proxy initialized");
    msg!("Admin: {}", config.admin);
    msg!("Relayer: {}", config.authorized_relayer);
    msg!("Fee: {} bps", config.fee_bps);

    Ok(())
}
