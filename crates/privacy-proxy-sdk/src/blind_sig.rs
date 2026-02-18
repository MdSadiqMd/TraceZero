use rand::RngCore;
use rsa::{traits::PublicKeyParts, BigUint, RsaPublicKey};
use sha2::{Digest, Sha256};

use crate::error::{Result, SdkError};

/// Blinding factor for RSA blind signatures
#[derive(Clone)]
pub struct BlindingFactor {
    /// Random blinding value
    pub r: BigUint,
    /// Modular inverse of r
    pub r_inv: BigUint,
}

pub fn blind_message(message: &[u8], pubkey: &RsaPublicKey) -> Result<(Vec<u8>, BlindingFactor)> {
    let n = pubkey.n();
    let e = pubkey.e();

    let hash = Sha256::digest(message);
    let m = BigUint::from_bytes_be(&hash);

    let r = generate_blinding_factor(n)?;
    let r_inv =
        mod_inverse(&r, n).ok_or_else(|| SdkError::Crypto("Failed to compute r inverse".into()))?;

    // Blind: m' = m * r^e mod n
    let r_e = r.modpow(e, n);
    let blinded = (&m * &r_e) % n;

    Ok((blinded.to_bytes_be(), BlindingFactor { r, r_inv }))
}

pub fn unblind_signature(
    blinded_sig: &[u8],
    blinding_factor: &BlindingFactor,
    pubkey: &RsaPublicKey,
) -> Result<Vec<u8>> {
    let n = pubkey.n();
    let s_blind = BigUint::from_bytes_be(blinded_sig);

    // Unblind: s = s' * r^(-1) mod n
    let s = (&s_blind * &blinding_factor.r_inv) % n;

    Ok(s.to_bytes_be())
}

pub fn sign_blinded(blinded_message: &[u8], private_key: &rsa::RsaPrivateKey) -> Result<Vec<u8>> {
    use rsa::traits::PrivateKeyParts;

    let n = private_key.n();
    let d = private_key.d();
    let m_blind = BigUint::from_bytes_be(blinded_message);

    if &m_blind >= n {
        return Err(SdkError::Crypto("Blinded message out of range".into()));
    }

    // Sign: s' = m'^d mod n
    let s_blind = m_blind.modpow(d, n);
    Ok(s_blind.to_bytes_be())
}

pub fn verify_signature(message: &[u8], signature: &[u8], pubkey: &RsaPublicKey) -> Result<bool> {
    let n = pubkey.n();
    let e = pubkey.e();

    let hash = Sha256::digest(message);
    let m = BigUint::from_bytes_be(&hash);

    // Verify: m == s^e mod n
    let s = BigUint::from_bytes_be(signature);
    let computed = s.modpow(e, n);

    Ok(computed == m)
}

fn generate_blinding_factor(n: &BigUint) -> Result<BigUint> {
    let n_bytes = (n.bits() as usize + 7) / 8;
    let mut bytes = vec![0u8; n_bytes];

    for _ in 0..100 {
        rand::thread_rng().fill_bytes(&mut bytes);
        let r = BigUint::from_bytes_be(&bytes) % n;

        if r > BigUint::from(1u32) && gcd(&r, n) == BigUint::from(1u32) {
            return Ok(r);
        }
    }

    Err(SdkError::Crypto(
        "Failed to generate blinding factor".into(),
    ))
}

fn gcd(a: &BigUint, b: &BigUint) -> BigUint {
    let mut a = a.clone();
    let mut b = b.clone();

    while b > BigUint::from(0u32) {
        let t = b.clone();
        b = &a % &b;
        a = t;
    }
    a
}

/// Modular inverse using extended Euclidean algorithm
/// Uses signed arithmetic via conversion to handle negative intermediate values
fn mod_inverse(a: &BigUint, n: &BigUint) -> Option<BigUint> {
    // Extended Euclidean algorithm with signed coefficients
    // We track signs separately since BigUint is unsigned
    let zero = BigUint::from(0u32);
    let one = BigUint::from(1u32);

    let mut old_r = n.clone();
    let mut r = a.clone();

    // Track s as (value, is_negative)
    let mut old_s: (BigUint, bool) = (zero.clone(), false);
    let mut s: (BigUint, bool) = (one.clone(), false);

    while r > zero {
        let quotient = &old_r / &r;

        // r = old_r - quotient * r
        let temp_r = r.clone();
        r = &old_r - &quotient * &r;
        old_r = temp_r;

        // s = old_s - quotient * s (with sign tracking)
        let temp_s = s.clone();
        let qs = &quotient * &s.0;

        // Compute old_s - quotient * s with proper sign handling
        s = if old_s.1 == s.1 {
            // Same sign: subtract magnitudes
            if old_s.0 >= qs {
                (old_s.0.clone() - &qs, old_s.1)
            } else {
                (&qs - &old_s.0, !old_s.1)
            }
        } else {
            // Different signs: add magnitudes, keep old_s sign
            (&old_s.0 + &qs, old_s.1)
        };
        old_s = temp_s;
    }

    // GCD must be 1 for inverse to exist
    if old_r > one {
        return None;
    }

    // If result is negative, add n to make it positive
    if old_s.1 {
        Some(n - &old_s.0)
    } else {
        Some(old_s.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::RsaPrivateKey;

    #[test]
    fn test_blind_signature_roundtrip() {
        let mut rng = rand::thread_rng();
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key = RsaPublicKey::from(&private_key);

        let message = b"test token id";
        let (blinded, factor) = blind_message(message, &public_key).unwrap();
        let blinded_sig = sign_blinded(&blinded, &private_key).unwrap();
        let signature = unblind_signature(&blinded_sig, &factor, &public_key).unwrap();
        assert!(verify_signature(message, &signature, &public_key).unwrap());
    }
}
