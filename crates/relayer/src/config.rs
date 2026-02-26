use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};
use std::str::FromStr;

pub const BUCKET_AMOUNTS: [u64; 7] = [
    100_000_000,     // 0.1 SOL
    500_000_000,     // 0.5 SOL
    1_000_000_000,   // 1 SOL
    5_000_000_000,   // 5 SOL
    10_000_000_000,  // 10 SOL
    50_000_000_000,  // 50 SOL
    100_000_000_000, // 100 SOL
];

#[derive(Clone)]
pub struct RelayerConfig {
    pub rpc_url: String,
    pub keypair: std::sync::Arc<Keypair>,
    pub treasury_keypair: std::sync::Arc<Keypair>,
    pub program_id: Pubkey,
    pub zk_verifier_id: Pubkey,
    pub host: String,
    pub port: u16,
    pub fee_bps: u16,
    pub rsa_key_bits: usize,
}

impl RelayerConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let rpc_url = std::env::var("RPC_URL")
            .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());

        let keypair_path = std::env::var("KEYPAIR_PATH")
            .unwrap_or_else(|_| shellexpand::tilde("~/.config/solana/id.json").to_string());
        let keypair_bytes = std::fs::read(&keypair_path)
            .map_err(|e| anyhow::anyhow!("Failed to read keypair from {}: {}", keypair_path, e))?;
        let keypair_json: Vec<u8> = serde_json::from_slice(&keypair_bytes)?;
        let keypair = Keypair::try_from(&keypair_json[..])?;

        let treasury_keypair = if let Ok(treasury_path) = std::env::var("TREASURY_KEYPAIR_PATH") {
            let treasury_bytes = std::fs::read(&treasury_path).map_err(|e| {
                anyhow::anyhow!(
                    "Failed to read treasury keypair from {}: {}",
                    treasury_path,
                    e
                )
            })?;
            let treasury_json: Vec<u8> = serde_json::from_slice(&treasury_bytes)?;
            let tk = Keypair::try_from(&treasury_json[..])?;
            tracing::info!(
                "Treasury wallet loaded: {} (separate from deposit wallet: {})",
                tk.pubkey(),
                keypair.pubkey()
            );
            tk
        } else {
            tracing::warn!(
                "TREASURY_KEYPAIR_PATH not set! Using main keypair for credit payments. \
                 This is a PRIVACY RISK - set TREASURY_KEYPAIR_PATH to a separate wallet."
            );
            Keypair::try_from(&keypair.to_bytes()[..])?
        };

        let program_id = std::env::var("PROGRAM_ID")
            .map(|s| Pubkey::from_str(&s))
            .unwrap_or_else(|_| {
                Ok(Pubkey::from_str("Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3").unwrap())
            })?;

        let zk_verifier_id = std::env::var("ZK_VERIFIER_ID")
            .map(|s| Pubkey::from_str(&s))
            .unwrap_or_else(|_| {
                Ok(Pubkey::from_str("2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu").unwrap())
            })?;

        let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = std::env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(8080);

        let fee_bps = std::env::var("FEE_BPS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(50); // 0.5% default

        let rsa_key_bits = std::env::var("RSA_KEY_BITS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(2048);

        Ok(Self {
            rpc_url,
            keypair: std::sync::Arc::new(keypair),
            treasury_keypair: std::sync::Arc::new(treasury_keypair),
            program_id,
            zk_verifier_id,
            host,
            port,
            fee_bps,
            rsa_key_bits,
        })
    }
}

pub fn get_bucket_id(amount: u64) -> Option<u8> {
    BUCKET_AMOUNTS
        .iter()
        .position(|&a| a == amount)
        .map(|i| i as u8)
}

pub fn calculate_total_with_fee(amount: u64, fee_bps: u16) -> u64 {
    let fee = (amount as u128 * fee_bps as u128 / 10000) as u64;
    amount + fee
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bucket_id() {
        assert_eq!(get_bucket_id(100_000_000), Some(0));
        assert_eq!(get_bucket_id(1_000_000_000), Some(1));
        assert_eq!(get_bucket_id(10_000_000_000), Some(2));
        assert_eq!(get_bucket_id(100_000_000_000), Some(3));
        assert_eq!(get_bucket_id(999), None);
    }

    #[test]
    fn test_fee_calculation() {
        // 0.5% fee on 1 SOL
        let total = calculate_total_with_fee(1_000_000_000, 50);
        assert_eq!(total, 1_005_000_000);
    }
}
