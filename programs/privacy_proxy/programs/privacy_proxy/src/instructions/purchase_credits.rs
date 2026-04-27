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
    /// CHECK: We manually verify this matches config.relayer_treasury
    #[account(mut)]
    pub relayer_treasury: AccountInfo<'info>,

    /// Global config - we only read paused and fee_bps
    /// CHECK: We manually verify this is the correct config PDA in the handler
    pub config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<PurchaseCredits>,
    amount_lamports: u64,
    blinded_token: [u8; 256],
) -> Result<()> {
    // Verify config is the correct PDA
    let (expected_config_pda, _) = Pubkey::find_program_address(
        &[CONFIG_SEED],
        ctx.program_id,
    );
    require!(
        ctx.accounts.config.key() == expected_config_pda,
        PrivacyProxyError::UnauthorizedRelayer
    );
    
    // Manually deserialize only the fields we need from GlobalConfig
    let config_data = ctx.accounts.config.try_borrow_data()?;
    
    // OLD GlobalConfig layout (434 bytes):
    // 8: discriminator
    // 32: admin (8-39)
    // 32: relayer_treasury (40-71)
    // 32: authorized_relayer (72-103)
    // 256: relayer_signing_key_n (104-359)
    // 4: relayer_signing_key_e (360-363)
    // 2: fee_bps (364-365)
    // 1: min_delay_hours (366)
    // 1: max_delay_hours (367)
    // 1: paused (368)
    // 1: bump (369)
    // 64: padding (370-433)
    
    if config_data.len() < 369 {
        return Err(PrivacyProxyError::ProtocolPaused.into());
    }
    
    let mut relayer_treasury_bytes = [0u8; 32];
    relayer_treasury_bytes.copy_from_slice(&config_data[40..72]);
    let relayer_treasury = Pubkey::new_from_array(relayer_treasury_bytes);
    let fee_bps = u16::from_le_bytes([config_data[364], config_data[365]]);
    let paused = config_data[368] != 0;
    
    // Verify relayer_treasury matches
    require!(
        ctx.accounts.relayer_treasury.key() == relayer_treasury,
        PrivacyProxyError::UnauthorizedRelayer
    );

    // Check protocol not paused
    require!(!paused, PrivacyProxyError::ProtocolPaused);

    // Validate amount is for a valid bucket + fee
    let base_amount = find_bucket_amount(amount_lamports, fee_bps)?;

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
