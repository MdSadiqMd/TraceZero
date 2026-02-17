/// Requires ZK proof of ownership to prevent griefing
/// The proof demonstrates knowledge of the nullifier preimage, and binds to the specific pending withdrawal ID
/// Ownership proof now outputs a binding hash that is verified on-chain to prevent proof reuse
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::PrivacyProxyError;
use crate::state::{GlobalConfig, PendingWithdrawal, WithdrawalStatus};

pub mod zk_verifier {
    use super::*;
    declare_id!("2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu");
}

#[derive(Accounts)]
pub struct CancelWithdrawal<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        constraint = pending_withdrawal.status == WithdrawalStatus::Pending @ PrivacyProxyError::WithdrawalNotPending,
        close = relayer,
    )]
    pub pending_withdrawal: Account<'info, PendingWithdrawal>,

    /// CHECK: Validated by address constraint
    #[account(address = zk_verifier::ID)]
    pub zk_verifier_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CancelWithdrawal>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    binding_hash: [u8; 32], // Circuit output - binding hash
) -> Result<()> {
    let config = &ctx.accounts.config;
    let pending = &mut ctx.accounts.pending_withdrawal;

    require!(!config.paused, PrivacyProxyError::ProtocolPaused);

    // Verify ownership proof via CPI to zk_verifier, it outputs binding hash that is verified
    verify_ownership_proof_cpi(
        &ctx.accounts.zk_verifier_program,
        &ctx.accounts.relayer,
        &proof_a,
        &proof_b,
        &proof_c,
        &pending.nullifier_hash,
        pending.tx_id,
        &binding_hash,
    )?;

    pending.status = WithdrawalStatus::Cancelled;

    msg!("Withdrawal cancelled");
    msg!("TX ID: {}", pending.tx_id);
    msg!("Binding hash verified: {:?}", &binding_hash[..8]);
    msg!("Nullifier can be reused for new withdrawal");

    Ok(())
}

/// Verify ownership proof via CPI to zk_verifier program
fn verify_ownership_proof_cpi<'info>(
    zk_verifier_program: &AccountInfo<'info>,
    caller: &Signer<'info>,
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    nullifier_hash: &[u8; 32],
    pending_withdrawal_id: u64,
    binding_hash: &[u8; 32],
) -> Result<()> {
    use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
    use anchor_lang::solana_program::program::invoke;

    let discriminator: [u8; 8] = compute_verify_ownership_discriminator();

    let mut data = Vec::with_capacity(8 + 64 + 128 + 64 + 32 + 8 + 32);
    data.extend_from_slice(&discriminator);

    // Groth16Proof struct
    data.extend_from_slice(proof_a);
    data.extend_from_slice(proof_b);
    data.extend_from_slice(proof_c);

    // OwnershipPublicInputs struct
    data.extend_from_slice(nullifier_hash);
    data.extend_from_slice(&pending_withdrawal_id.to_le_bytes());

    // Binding hash (circuit output)
    data.extend_from_slice(binding_hash);

    let accounts = vec![AccountMeta::new_readonly(caller.key(), true)];
    let ix = Instruction {
        program_id: zk_verifier_program.key(),
        accounts,
        data,
    };

    invoke(
        &ix,
        &[caller.to_account_info(), zk_verifier_program.clone()],
    )?;

    msg!("✓ Ownership proof verified via CPI");
    msg!("  Bound to withdrawal ID: {}", pending_withdrawal_id);
    Ok(())
}

fn compute_verify_ownership_discriminator() -> [u8; 8] {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(b"global:verify_ownership");
    let result = hasher.finalize();

    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&result[0..8]);
    discriminator
}
