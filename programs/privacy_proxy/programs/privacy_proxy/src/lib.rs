use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::cancel_withdrawal::*;
use instructions::deposit::*;
use instructions::execute_withdrawal::*;
use instructions::init_pool::*;
use instructions::initialize::*;
use instructions::purchase_credits::*;
use instructions::request_withdrawal::*;
use instructions::update_config::*;

declare_id!("Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3");

#[program]
pub mod privacy_proxy {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    pub fn init_pool(ctx: Context<InitPool>, bucket_id: u8) -> Result<()> {
        instructions::init_pool::handler(ctx, bucket_id)
    }

    pub fn purchase_credits(
        ctx: Context<PurchaseCredits>,
        amount_lamports: u64,
        blinded_token: [u8; 256],
    ) -> Result<()> {
        instructions::purchase_credits::handler(ctx, amount_lamports, blinded_token)
    }

    pub fn deposit(
        ctx: Context<Deposit>,
        bucket_id: u8,
        commitment: [u8; 32],
        token_hash: [u8; 32],
        encrypted_note: Vec<u8>,
        merkle_root: [u8; 32],
    ) -> Result<()> {
        instructions::deposit::handler(
            ctx,
            bucket_id,
            commitment,
            token_hash,
            encrypted_note,
            merkle_root,
        )
    }

    pub fn request_withdrawal(
        ctx: Context<RequestWithdrawal>,
        bucket_id: u8,
        nullifier_hash: [u8; 32],
        recipient: [u8; 32], // Field element from circuit (potentially reduced mod BN254)
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        merkle_root: [u8; 32],
        delay_hours: u8,
        binding_hash: [u8; 32],
        relayer_field: [u8; 32], // Field element from circuit (potentially reduced mod BN254)
    ) -> Result<()> {
        instructions::request_withdrawal::handler(
            ctx,
            bucket_id,
            nullifier_hash,
            recipient,
            proof_a,
            proof_b,
            proof_c,
            merkle_root,
            delay_hours,
            binding_hash,
            relayer_field,
        )
    }

    pub fn execute_withdrawal(ctx: Context<ExecuteWithdrawal>) -> Result<()> {
        instructions::execute_withdrawal::handler(ctx)
    }

    pub fn cancel_withdrawal(
        ctx: Context<CancelWithdrawal>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        binding_hash: [u8; 32],
    ) -> Result<()> {
        instructions::cancel_withdrawal::handler(ctx, proof_a, proof_b, proof_c, binding_hash)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
        instructions::update_config::handler(ctx, params)
    }
}
