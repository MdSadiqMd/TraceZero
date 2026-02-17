/// Purchase credits - user pays relayer, gets blinded token signed
/// This TX is visible on-chain but the blinded token is UNLINKABLE to future deposits due to blind signature cryptography
use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::PrivacyProxyError;
use crate::state::GlobalConfig;

#[derive(Accounts)]
pub struct PurchaseCredits<'info> {
    /// User purchasing credits
    #[account(mut)]
    pub user: Signer<'info>,

    /// Relayer treasury receives payment
    /// CHECK: Validated against config
    #[account(
        mut,
        constraint = relayer_treasury.key() == config.relayer_treasury @ PrivacyProxyError::UnauthorizedRelayer
    )]
    pub relayer_treasury: AccountInfo<'info>,

    /// Global config
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, GlobalConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<PurchaseCredits>,
    amount_lamports: u64,
    blinded_token: [u8; 256],
) -> Result<()> {
    let config = &ctx.accounts.config;

    // Check protocol not paused
    require!(!config.paused, PrivacyProxyError::ProtocolPaused);

    // Validate amount is for a valid bucket + fee
    let base_amount = find_bucket_amount(amount_lamports, config.fee_bps)?;

    // Validate blinded token is not empty (basic sanity check)
    require!(
        blinded_token.iter().any(|&b| b != 0),
        PrivacyProxyError::InvalidBlindedToken
    );

    // Transfer payment to relayer treasury
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.relayer_treasury.to_account_info(),
            },
        ),
        amount_lamports,
    )?;

    // Emit event for relayer to pick up and sign
    // The blinded_token will be signed off-chain by the relayer
    msg!("Credits purchased");
    msg!("Amount: {} lamports", amount_lamports);
    msg!("Base amount: {} lamports", base_amount);
    msg!("Blinded token hash: {:?}", &blinded_token[..8]); // Only log first 8 bytes

    Ok(())
}

/// Find the bucket amount from total payment (amount + fee)
fn find_bucket_amount(total_payment: u64, fee_bps: u16) -> Result<u64> {
    // total = base + (base * fee_bps / 10000)
    // total = base * (1 + fee_bps / 10000)
    // total = base * (10000 + fee_bps) / 10000
    // base = total * 10000 / (10000 + fee_bps)
    let fee_multiplier = 10000u64 + fee_bps as u64;

    for &bucket_amount in BUCKET_AMOUNTS.iter() {
        let expected_total = bucket_amount
            .checked_mul(fee_multiplier)
            .ok_or(PrivacyProxyError::Overflow)?
            .checked_div(10000)
            .ok_or(PrivacyProxyError::Overflow)?;

        // Allow small rounding tolerance
        if total_payment >= expected_total && total_payment <= expected_total + 1000 {
            return Ok(bucket_amount);
        }
    }

    Err(PrivacyProxyError::InvalidDepositAmount.into())
}
