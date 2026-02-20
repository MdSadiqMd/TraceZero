use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::GlobalConfig;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateConfigParams {
    pub relayer_treasury: Option<Pubkey>,
    pub authorized_relayer: Option<Pubkey>,
    pub fee_bps: Option<u16>,
    pub paused: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ ProgramError::InvalidArgument,
    )]
    pub config: Account<'info, GlobalConfig>,
}

pub fn handler(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(treasury) = params.relayer_treasury {
        config.relayer_treasury = treasury;
        msg!("Updated relayer_treasury to {}", treasury);
    }

    if let Some(relayer) = params.authorized_relayer {
        config.authorized_relayer = relayer;
        msg!("Updated authorized_relayer to {}", relayer);
    }

    if let Some(fee) = params.fee_bps {
        config.fee_bps = fee;
        msg!("Updated fee_bps to {}", fee);
    }

    if let Some(paused) = params.paused {
        config.paused = paused;
        msg!("Updated paused to {}", paused);
    }

    msg!("Config updated");
    Ok(())
}
