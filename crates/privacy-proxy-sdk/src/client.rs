/// Orchestrates the flow: credit purchase → deposit → withdrawal
use rsa::RsaPublicKey;
use solana_sdk::pubkey::Pubkey;
use tracezero::{Config as TorConfig, TorHttpClient};

use crate::credits::{BlindedCredit, SignedCredit};
use crate::crypto::encrypt_payload;
use crate::deposit::{DepositNote, DepositRequest, DepositResponse};
use crate::error::{Result, SdkError};
use crate::merkle::MerkleProof;
use crate::stealth::{StealthAddress, StealthMaster};
use crate::withdrawal::{WithdrawalRequest, WithdrawalResponse};

pub struct ClientConfig {
    /// Relayer URL (accessed via Tor)
    pub relayer_url: String,
    /// Relayer's RSA public key for blind signatures
    pub relayer_pubkey: RsaPublicKey,
    /// Tor SOCKS5 proxy address
    pub tor_socks_addr: String,
    /// Shared secret for payload encryption (derived from relayer pubkey)
    pub encryption_secret: [u8; 32],
}

pub struct PrivacyClient {
    config: ClientConfig,
    tor_client: TorHttpClient,
    stealth_master: StealthMaster,
    tor_verified: bool,
}

impl PrivacyClient {
    pub fn new(config: ClientConfig) -> Result<Self> {
        let tor_config = TorConfig::default().with_socks_addr(&config.tor_socks_addr);
        let tor_client = TorHttpClient::new(tor_config)?;

        Ok(Self {
            config,
            tor_client,
            stealth_master: StealthMaster::new(),
            tor_verified: false,
        })
    }

    pub fn with_stealth_master(config: ClientConfig, stealth_secret: [u8; 32]) -> Result<Self> {
        let tor_config = TorConfig::default().with_socks_addr(&config.tor_socks_addr);
        let tor_client = TorHttpClient::new(tor_config)?;

        Ok(Self {
            config,
            tor_client,
            stealth_master: StealthMaster::from_secret(stealth_secret),
            tor_verified: false,
        })
    }

    async fn ensure_tor(&mut self) -> Result<()> {
        if self.tor_verified {
            return Ok(());
        }

        let is_tor = self
            .tor_client
            .verify_tor_connection()
            .await
            .map_err(|e| SdkError::Network(e))?;
        if !is_tor {
            return Err(SdkError::TorRequired(
                "Tor connection required but not detected. Refusing to send sensitive data.".into(),
            ));
        }

        self.tor_verified = true;
        Ok(())
    }

    pub fn create_blinded_credit(&self, amount: u64) -> Result<BlindedCredit> {
        BlindedCredit::new(amount, &self.config.relayer_pubkey)
    }

    pub fn unblind_credit(
        &self,
        credit: BlindedCredit,
        blinded_signature: &[u8],
    ) -> Result<SignedCredit> {
        credit.unblind(blinded_signature, &self.config.relayer_pubkey)
    }

    pub fn create_deposit_note(&self, amount: u64) -> DepositNote {
        DepositNote::new(amount)
    }

    pub async fn submit_deposit(
        &mut self,
        credit: SignedCredit,
        note: &DepositNote,
    ) -> Result<DepositResponse> {
        self.ensure_tor().await?;

        let request = DepositRequest::new(credit, note)?;
        let plaintext =
            serde_json::to_vec(&request).map_err(|e| SdkError::Serialization(e.to_string()))?;
        let encrypted = encrypt_payload(&plaintext, &self.config.encryption_secret);
        let url = format!("{}/deposit", self.config.relayer_url);
        let response = self
            .tor_client
            .post_json(&url, &encrypted)
            .await
            .map_err(|e| SdkError::Relayer(e.to_string()))?;

        Ok(response)
    }

    pub fn derive_stealth_address(&self, index: u64) -> StealthAddress {
        self.stealth_master.derive(index)
    }

    pub async fn submit_withdrawal(
        &mut self,
        note: &DepositNote,
        merkle_proof: &MerkleProof,
        root: [u8; 32],
        recipient: &StealthAddress,
        relayer: Pubkey,
        fee: u64,
    ) -> Result<WithdrawalResponse> {
        self.ensure_tor().await?;

        let request = WithdrawalRequest::new(note, merkle_proof, root, recipient, relayer, fee)?;
        let plaintext =
            serde_json::to_vec(&request).map_err(|e| SdkError::Serialization(e.to_string()))?;
        let encrypted = encrypt_payload(&plaintext, &self.config.encryption_secret);
        let url = format!("{}/withdraw", self.config.relayer_url);
        let response = self
            .tor_client
            .post_json(&url, &encrypted)
            .await
            .map_err(|e| SdkError::Relayer(e.to_string()))?;

        Ok(response)
    }

    pub async fn verify_tor(&mut self) -> Result<bool> {
        let result = self
            .tor_client
            .verify_tor_connection()
            .await
            .map_err(|e| SdkError::Network(e))?;

        self.tor_verified = result;
        Ok(result)
    }

    pub async fn get_exit_ip(&self) -> Result<String> {
        self.tor_client
            .get_exit_ip()
            .await
            .map_err(|e| SdkError::Network(e))
    }

    pub fn export_stealth_secret(&self) -> [u8; 32] {
        self.stealth_master.export_secret()
    }

    pub fn is_tor_verified(&self) -> bool {
        self.tor_verified
    }

    pub fn invalidate_tor_verification(&mut self) {
        self.tor_verified = false;
    }
}
