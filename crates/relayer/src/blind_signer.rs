/// Signs blinded tokens without seeing the actual token value
/// RSA keypair is saved to disk to survive restarts. This ensures credits purchased before a restart remain valid
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use rsa::{
    traits::{PrivateKeyParts, PublicKeyParts},
    RsaPrivateKey, RsaPublicKey,
};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::error::{RelayerError, Result};

type BigUint = rsa::BigUint;

const DEFAULT_RSA_KEY_PATH: &str = "rsa_signing_key.der";

pub struct BlindSigner {
    private_key: RsaPrivateKey,
    public_key: RsaPublicKey,
}

impl BlindSigner {
    pub fn new_or_load(key_bits: usize) -> Result<Self> {
        let key_path = std::env::var("RSA_KEY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_RSA_KEY_PATH));
        if key_path.exists() {
            match Self::load_from_file(&key_path) {
                Ok(signer) => {
                    info!("Loaded RSA keypair from {}", key_path.display());
                    return Ok(signer);
                }
                Err(e) => {
                    warn!("Failed to load RSA key from {}: {}", key_path.display(), e);
                    warn!("Generating new keypair (old credits will be invalid!)");
                }
            }
        }

        let signer = Self::new(key_bits)?;
        if let Err(e) = signer.save_to_file(&key_path) {
            warn!("Failed to save RSA key to {}: {}", key_path.display(), e);
        } else {
            info!("Saved RSA keypair to {}", key_path.display());
        }

        Ok(signer)
    }

    pub fn new(key_bits: usize) -> Result<Self> {
        let mut rng = rand::thread_rng();
        let private_key = RsaPrivateKey::new(&mut rng, key_bits)
            .map_err(|e| RelayerError::Crypto(format!("Failed to generate RSA key: {}", e)))?;
        let public_key = RsaPublicKey::from(&private_key);

        info!("Generated RSA-{} keypair for blind signatures", key_bits);

        Ok(Self {
            private_key,
            public_key,
        })
    }

    fn load_from_file(path: &PathBuf) -> Result<Self> {
        let bytes = std::fs::read(path)
            .map_err(|e| RelayerError::Crypto(format!("Failed to read key file: {}", e)))?;
        Self::from_private_key_bytes(&bytes)
    }

    fn save_to_file(&self, path: &PathBuf) -> Result<()> {
        let bytes = self
            .private_key
            .to_pkcs8_der()
            .map_err(|e| RelayerError::Crypto(format!("Failed to encode key: {}", e)))?;
        std::fs::write(path, bytes.as_bytes())
            .map_err(|e| RelayerError::Crypto(format!("Failed to write key file: {}", e)))?;
        Ok(())
    }

    pub fn from_private_key_bytes(bytes: &[u8]) -> Result<Self> {
        let private_key = RsaPrivateKey::from_pkcs8_der(bytes)
            .map_err(|e| RelayerError::Crypto(format!("Invalid private key: {}", e)))?;
        let public_key = RsaPublicKey::from(&private_key);

        Ok(Self {
            private_key,
            public_key,
        })
    }

    /// Get the public key for clients
    #[allow(dead_code)]
    pub fn public_key(&self) -> &RsaPublicKey {
        &self.public_key
    }

    /// Get public key N component as bytes (for on-chain storage)
    pub fn public_key_n_bytes(&self) -> Vec<u8> {
        self.public_key.n().to_bytes_be()
    }

    /// Get public key E component as bytes
    pub fn public_key_e_bytes(&self) -> Vec<u8> {
        self.public_key.e().to_bytes_be()
    }

    pub fn sign_blinded(&self, blinded_message: &[u8]) -> Result<Vec<u8>> {
        let n = self.private_key.n();
        let d = self.private_key.d();

        let m_blind = BigUint::from_bytes_be(blinded_message);
        if m_blind >= *n {
            return Err(RelayerError::InvalidBlindedToken);
        }

        // Sign: s' = m'^d mod n
        let s_blind = m_blind.modpow(d, n);

        Ok(s_blind.to_bytes_be())
    }

    pub fn verify_signature(&self, message: &[u8], signature: &[u8]) -> Result<bool> {
        let n = self.public_key.n();
        let e = self.public_key.e();

        let hash = Sha256::digest(message);
        let m = BigUint::from_bytes_be(&hash);

        // Verify: m == s^e mod n
        let s = BigUint::from_bytes_be(signature);
        let computed = s.modpow(e, n);

        Ok(computed == m)
    }
}

pub struct BlindSignerService {
    signer: Arc<RwLock<BlindSigner>>,
}

impl BlindSignerService {
    pub fn new(key_bits: usize) -> Result<Self> {
        Ok(Self {
            signer: Arc::new(RwLock::new(BlindSigner::new_or_load(key_bits)?)),
        })
    }

    pub async fn sign_blinded(&self, blinded_message: &[u8]) -> Result<Vec<u8>> {
        let signer = self.signer.read().await;
        signer.sign_blinded(blinded_message)
    }

    pub async fn verify_signature(&self, message: &[u8], signature: &[u8]) -> Result<bool> {
        let signer = self.signer.read().await;
        signer.verify_signature(message, signature)
    }

    pub async fn public_key_n_bytes(&self) -> Vec<u8> {
        let signer = self.signer.read().await;
        signer.public_key_n_bytes()
    }

    pub async fn public_key_e_bytes(&self) -> Vec<u8> {
        let signer = self.signer.read().await;
        signer.public_key_e_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use privacy_proxy_sdk::blind_sig::{blind_message, unblind_signature};

    #[test]
    fn test_blind_signature_flow() {
        let signer = BlindSigner::new(2048).unwrap();
        let pubkey = signer.public_key();

        // User creates token and blinds it
        let token_id = [42u8; 32];
        let (blinded, blinding_factor) = blind_message(&token_id, pubkey).unwrap();

        // Relayer signs blinded token (cannot see token_id)
        let blinded_sig = signer.sign_blinded(&blinded).unwrap();

        // User unblinds signature
        let signature = unblind_signature(&blinded_sig, &blinding_factor, pubkey).unwrap();

        // Verify signature is valid for original token
        assert!(signer.verify_signature(&token_id, &signature).unwrap());
    }
}
