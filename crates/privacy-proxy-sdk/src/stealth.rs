/// User generates a stealth address that only they can spend from
/// No ephemeral keys on-chain - everything derived off-chain
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer;

#[derive(Clone, Serialize, Deserialize)]
pub struct StealthAddress {
    /// The public address (can be shared)
    pub address: Pubkey,
    /// Spending key (secret, derived from master key + index)
    #[serde(with = "serde_bytes")]
    spending_key: [u8; 32],
    /// Index used for derivation
    pub index: u64,
}

/// Master key for deriving stealth addresses
pub struct StealthMaster {
    /// Master secret key
    secret: [u8; 32],
}

impl StealthMaster {
    pub fn new() -> Self {
        let mut secret = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret);
        Self { secret }
    }

    pub fn from_secret(secret: [u8; 32]) -> Self {
        Self { secret }
    }

    pub fn derive(&self, index: u64) -> StealthAddress {
        // Derive spending key: H(master || index)
        let mut hasher = Sha256::new();
        hasher.update(&self.secret);
        hasher.update(&index.to_le_bytes());
        let spending_key: [u8; 32] = hasher.finalize().into();

        // Derive public key from spending key
        let keypair =
            solana_sdk::signer::keypair::keypair_from_seed(&spending_key).expect("Valid seed");
        let address = keypair.pubkey();

        StealthAddress {
            address,
            spending_key,
            index,
        }
    }

    /// Derive next unused stealth address
    pub fn derive_next(&self, last_index: u64) -> StealthAddress {
        self.derive(last_index + 1)
    }

    pub fn export_secret(&self) -> [u8; 32] {
        self.secret
    }
}

impl Default for StealthMaster {
    fn default() -> Self {
        Self::new()
    }
}

impl StealthAddress {
    pub fn keypair(&self) -> solana_sdk::signer::keypair::Keypair {
        solana_sdk::signer::keypair::keypair_from_seed(&self.spending_key).expect("Valid seed")
    }

    pub fn matches(&self, pubkey: &Pubkey) -> bool {
        self.address == *pubkey
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stealth_derivation() {
        let master = StealthMaster::new();

        // Derive multiple addresses
        let addr1 = master.derive(0);
        let addr2 = master.derive(1);
        let addr3 = master.derive(0); // Same index

        // Different indices = different addresses
        assert_ne!(addr1.address, addr2.address);

        // Same index = same address (deterministic)
        assert_eq!(addr1.address, addr3.address);

        // Can sign with derived keypair
        let keypair = addr1.keypair();
        assert_eq!(keypair.pubkey(), addr1.address);
    }

    #[test]
    fn test_master_restore() {
        let master1 = StealthMaster::new();
        let secret = master1.export_secret();

        let master2 = StealthMaster::from_secret(secret);

        // Same secret = same derived addresses
        assert_eq!(master1.derive(5).address, master2.derive(5).address);
    }
}
