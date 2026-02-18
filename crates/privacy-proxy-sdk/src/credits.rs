/// Flow:
/// 1. User generates token_id, blinds it
/// 2. User sends blinded_token + payment to relayer
/// 3. Relayer signs blinded_token (cannot see token_id)
/// 4. User unblinds signature → has valid SignedCredit
/// 5. User redeems SignedCredit via Tor (UNLINKABLE to purchase)
use rand::RngCore;
use rsa::RsaPublicKey;
use serde::{Deserialize, Serialize};

use crate::blind_sig::{blind_message, unblind_signature, BlindingFactor};
use crate::error::{Result, SdkError};

/// A credit before signing - contains blinded token
#[derive(Clone)]
pub struct BlindedCredit {
    /// Unique token ID (secret, only user knows)
    pub token_id: [u8; 32],
    /// Blinded token sent to relayer
    pub blinded_token: Vec<u8>,
    /// Blinding factor for unblinding signature
    blinding_factor: BlindingFactor,
    /// Amount in lamports
    pub amount: u64,
}

/// A signed credit ready for redemption
#[derive(Clone, Serialize, Deserialize)]
pub struct SignedCredit {
    /// Token ID (revealed during redemption)
    pub token_id: [u8; 32],
    /// Unblinded signature from relayer
    pub signature: Vec<u8>,
    /// Amount in lamports
    pub amount: u64,
}

impl BlindedCredit {
    pub fn new(amount: u64, relayer_pubkey: &RsaPublicKey) -> Result<Self> {
        let mut token_id = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut token_id);

        let (blinded_token, blinding_factor) = blind_message(&token_id, relayer_pubkey)?;

        Ok(Self {
            token_id,
            blinded_token,
            blinding_factor,
            amount,
        })
    }

    pub fn unblind(
        self,
        blinded_signature: &[u8],
        relayer_pubkey: &RsaPublicKey,
    ) -> Result<SignedCredit> {
        let signature =
            unblind_signature(blinded_signature, &self.blinding_factor, relayer_pubkey)?;

        Ok(SignedCredit {
            token_id: self.token_id,
            signature,
            amount: self.amount,
        })
    }

    pub fn blinded_token(&self) -> &[u8] {
        &self.blinded_token
    }
}

impl SignedCredit {
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(self).map_err(|e| SdkError::Serialization(e.to_string()))
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        serde_json::from_slice(bytes).map_err(|e| SdkError::Serialization(e.to_string()))
    }

    pub fn token_id_hex(&self) -> String {
        hex::encode(self.token_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blind_sig::{sign_blinded, verify_signature};
    use rsa::RsaPrivateKey;

    #[test]
    fn test_credit_flow() {
        // Generate relayer keypair
        let mut rng = rand::thread_rng();
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key = RsaPublicKey::from(&private_key);

        // User creates blinded credit
        let credit = BlindedCredit::new(1_000_000_000, &public_key).unwrap();
        let original_token_id = credit.token_id;

        // Relayer signs blinded token (cannot see token_id)
        let blinded_sig = sign_blinded(&credit.blinded_token, &private_key).unwrap();

        // User unblinds to get valid signature
        let signed_credit = credit.unblind(&blinded_sig, &public_key).unwrap();

        // Verify the signature is valid for the original token_id
        assert_eq!(signed_credit.token_id, original_token_id);
        assert!(verify_signature(
            &signed_credit.token_id,
            &signed_credit.signature,
            &public_key
        )
        .unwrap());
    }
}
