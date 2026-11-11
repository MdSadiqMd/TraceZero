use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::PrivacyProxyError;

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Raw bytes — can't use Account<GlobalConfig> because the old layout
    /// has bump at the wrong offset, causing the seeds check to fail.
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: AccountInfo<'info>,
}

pub fn handler(ctx: Context<MigrateConfig>) -> Result<()> {
    let config = &ctx.accounts.config;
    let data = config.try_borrow_data()?;

    let old_bump_offset: usize = 8 + 32 + 32 + 32 + 256 + 4 + 2 + 1 + 1 + 1; // 369

    let admin_bytes = &data[8..40];
    require!(
        admin_bytes == ctx.accounts.admin.key().as_ref(),
        PrivacyProxyError::UnauthorizedRelayer
    );

    let old_bump = data[old_bump_offset];

    let expected_pda = Pubkey::create_program_address(
        &[CONFIG_SEED, &[old_bump]],
        ctx.program_id,
    )
    .map_err(|_| error!(PrivacyProxyError::InvalidMerkleRoot))?;

    require!(
        expected_pda == config.key(),
        PrivacyProxyError::InvalidMerkleRoot
    );

    let mut new_data = vec![0u8; 434];
    new_data[..old_bump_offset].copy_from_slice(&data[..old_bump_offset]);
    new_data[old_bump_offset..old_bump_offset + 32].fill(0);
    new_data[old_bump_offset + 32] = old_bump;

    drop(data);

    let mut data_mut = config.try_borrow_mut_data()?;
    data_mut[..434].copy_from_slice(&new_data);

    msg!("Config migrated: bump {} moved from offset {} to {}", old_bump, old_bump_offset, old_bump_offset + 32);
    Ok(())
}
