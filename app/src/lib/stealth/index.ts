// Protocol:
// 1. Recipient publishes (spendPubkey, viewPubkey)
// 2. Sender generates ephemeral keypair (r, R = r*G)
// 3. Sender computes shared secret S = ECDH(r, viewPubkey)
// 4. Sender derives stealth address from H(S || spendPubkey)
// 5. Recipient scans by computing S' = ECDH(viewPrivkey, R) and checking addresses
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export interface StealthAddress {
  address: PublicKey;
  secretKey: Uint8Array; // The secret key for the stealth address
  ephemeralPubkey: Uint8Array;
  viewingKey: Uint8Array;
}

export interface StealthKeypair {
  spendKey: Keypair;
  viewKey: Uint8Array; // X25519 private key (32 bytes)
  viewPubkey: Uint8Array; // X25519 public key (32 bytes)
}

// Helper to convert Uint8Array to ArrayBuffer for Web Crypto API
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

/**
 * Generate a new stealth keypair
 * - spendKey: Ed25519 keypair for spending funds
 * - viewKey: X25519 private key for scanning incoming payments
 * - viewPubkey: X25519 public key (shared with senders)
 *
 * IMPORTANT: The spendKey pubkey must be within BN254 field (top 3 bits = 0)
 * to ensure the on-chain recipient matches the keypair we control.
 */
export async function generateStealthKeypair(): Promise<StealthKeypair> {
  // Generate spend key that's within BN254 field
  let spendKey = Keypair.generate();
  let attempts = 0;
  const maxAttempts = 100;

  while (
    (spendKey.publicKey.toBytes()[0] & 0xe0) !== 0 &&
    attempts < maxAttempts
  ) {
    spendKey = Keypair.generate();
    attempts++;
  }

  if ((spendKey.publicKey.toBytes()[0] & 0xe0) !== 0) {
    throw new Error(
      "Failed to generate BN254-compatible spend key after 100 attempts",
    );
  }

  // Generate X25519 keypair for ECDH
  // Note: We need to export as PKCS8 for private key (raw export not supported)
  const x25519KeyPair = (await crypto.subtle.generateKey(
    { name: "X25519" },
    true, // extractable - needed for PKCS8 export
    ["deriveBits"],
  )) as CryptoKeyPair;

  // Export the public key (raw format works for public keys)
  const viewPubkeyRaw = await crypto.subtle.exportKey(
    "raw",
    x25519KeyPair.publicKey,
  );

  // Export private key as PKCS8 and extract the raw 32 bytes
  // PKCS8 for X25519 is: header (16 bytes) + raw private key (32 bytes)
  const privateKeyPkcs8 = await crypto.subtle.exportKey(
    "pkcs8",
    x25519KeyPair.privateKey,
  );
  const pkcs8Bytes = new Uint8Array(privateKeyPkcs8);
  // The raw private key is the last 32 bytes of PKCS8
  const viewKey = pkcs8Bytes.slice(-32);

  return {
    spendKey,
    viewKey,
    viewPubkey: new Uint8Array(viewPubkeyRaw),
  };
}

/**
 * Generate a one-time stealth address for receiving funds
 * The sender generates this using the recipient's public keys
 *
 * SECURITY: Uses proper X25519 ECDH for shared secret derivation
 */
export async function generateStealthAddress(
  recipientSpendPubkey: PublicKey,
  recipientViewPubkey: Uint8Array,
): Promise<StealthAddress> {
  // Generate ephemeral X25519 keypair
  const ephemeralKeyPair = (await crypto.subtle.generateKey(
    { name: "X25519" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;

  // Import recipient's view public key
  const recipientViewKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(recipientViewPubkey),
    { name: "X25519" },
    false,
    [],
  );

  // Compute shared secret via ECDH: S = ECDH(ephemeralPrivate, recipientViewPubkey)
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "X25519", public: recipientViewKey },
    ephemeralKeyPair.privateKey,
    256,
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // Export ephemeral public key
  const ephemeralPubkeyRaw = await crypto.subtle.exportKey(
    "raw",
    ephemeralKeyPair.publicKey,
  );
  const ephemeralPubkey = new Uint8Array(ephemeralPubkeyRaw);

  // Derive stealth address seed: H(sharedSecret || spendPubkey)
  const stealthSeedInput = new Uint8Array(32 + 32);
  stealthSeedInput.set(sharedSecret, 0);
  stealthSeedInput.set(recipientSpendPubkey.toBytes(), 32);
  let stealthSeed = await sha256(stealthSeedInput);

  // Create deterministic Ed25519 keypair from seed
  // IMPORTANT: Keep regenerating until we get a pubkey within BN254 field
  // This ensures the on-chain recipient matches the keypair we control
  let stealthKeypair = Keypair.fromSeed(stealthSeed);
  let attempts = 0;
  const maxAttempts = 100;

  while (
    (stealthKeypair.publicKey.toBytes()[0] & 0xe0) !== 0 &&
    attempts < maxAttempts
  ) {
    // Pubkey exceeds BN254 field - regenerate with modified seed
    // Append attempt counter to seed and rehash
    const newSeedInput = new Uint8Array(33);
    newSeedInput.set(stealthSeed, 0);
    newSeedInput[32] = attempts;
    stealthSeed = await sha256(newSeedInput);
    stealthKeypair = Keypair.fromSeed(stealthSeed);
    attempts++;
  }

  if ((stealthKeypair.publicKey.toBytes()[0] & 0xe0) !== 0) {
    throw new Error(
      "Failed to generate BN254-compatible stealth address after 100 attempts",
    );
  }

  return {
    address: stealthKeypair.publicKey,
    secretKey: stealthKeypair.secretKey, // Return the actual secret key for this address
    ephemeralPubkey,
    viewingKey: sharedSecret,
  };
}

/**
 * Recover stealth address private key (recipient side)
 * Used to spend funds sent to a stealth address
 *
 * SECURITY: Uses proper X25519 ECDH with recipient's view private key
 */
export async function recoverStealthPrivateKey(
  ephemeralPubkey: Uint8Array,
  spendKey: Keypair,
  viewKey: Uint8Array,
): Promise<Keypair> {
  // Build PKCS8 format for X25519 private key
  // PKCS8 header for X25519: 302e020100300506032b656e04220420 (16 bytes)
  const pkcs8Header = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e,
    0x04, 0x22, 0x04, 0x20,
  ]);
  const pkcs8Key = new Uint8Array(48);
  pkcs8Key.set(pkcs8Header, 0);
  pkcs8Key.set(viewKey, 16);

  // Import recipient's view private key
  const viewPrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(pkcs8Key),
    { name: "X25519" },
    false,
    ["deriveBits"],
  );

  // Import sender's ephemeral public key
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(ephemeralPubkey),
    { name: "X25519" },
    false,
    [],
  );

  // Compute shared secret via ECDH: S = ECDH(viewPrivate, ephemeralPubkey)
  // This produces the same shared secret as the sender computed
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "X25519", public: ephemeralPublicKey },
    viewPrivateKey,
    256,
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // Derive stealth address seed: H(sharedSecret || spendPubkey)
  // This MUST match what the sender computed
  const stealthSeedInput = new Uint8Array(32 + 32);
  stealthSeedInput.set(sharedSecret, 0);
  stealthSeedInput.set(spendKey.publicKey.toBytes(), 32);
  const stealthSeed = await sha256(stealthSeedInput);

  // Recover the stealth keypair
  return Keypair.fromSeed(stealthSeed);
}

/**
 * Check if a stealth address belongs to us
 * Used to scan for incoming payments
 */
export async function scanStealthAddress(
  stealthAddress: PublicKey,
  ephemeralPubkey: Uint8Array,
  spendKey: Keypair,
  viewKey: Uint8Array,
): Promise<boolean> {
  try {
    const recovered = await recoverStealthPrivateKey(
      ephemeralPubkey,
      spendKey,
      viewKey,
    );
    return recovered.publicKey.equals(stealthAddress);
  } catch {
    return false;
  }
}

// Helper functions
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(hash);
}

/**
 * Encode stealth address data for storage/transmission
 */
export function encodeStealthData(stealth: StealthAddress): string {
  return JSON.stringify({
    address: stealth.address.toBase58(),
    ephemeralPubkey: bs58.encode(stealth.ephemeralPubkey),
    viewingKey: bs58.encode(stealth.viewingKey),
  });
}

/**
 * Decode stealth address data
 * Note: secretKey is not stored in this format, so it's set to empty.
 * Use the stored stealth keys from secureStorage for claiming.
 */
export function decodeStealthData(encoded: string): StealthAddress {
  const parsed = JSON.parse(encoded);
  return {
    address: new PublicKey(parsed.address),
    secretKey: new Uint8Array(64), // Placeholder - actual key stored separately
    ephemeralPubkey: bs58.decode(parsed.ephemeralPubkey),
    viewingKey: bs58.decode(parsed.viewingKey),
  };
}

/**
 * Encode stealth keypair for secure storage
 */
export function encodeStealthKeypair(keypair: StealthKeypair): string {
  return JSON.stringify({
    spendKey: bs58.encode(keypair.spendKey.secretKey),
    viewKey: bs58.encode(keypair.viewKey),
    viewPubkey: bs58.encode(keypair.viewPubkey),
  });
}

/**
 * Decode stealth keypair from storage
 */
export function decodeStealthKeypair(encoded: string): StealthKeypair {
  const parsed = JSON.parse(encoded);
  return {
    spendKey: Keypair.fromSecretKey(bs58.decode(parsed.spendKey)),
    viewKey: bs58.decode(parsed.viewKey),
    viewPubkey: bs58.decode(parsed.viewPubkey),
  };
}
