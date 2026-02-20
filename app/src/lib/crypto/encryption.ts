// AES-256-GCM encryption for secure payload transmission
export interface EncryptedPayload {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

// Helper to convert Uint8Array to ArrayBuffer for Web Crypto API
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

/**
 * Encrypt a payload using AES-256-GCM
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  key: Uint8Array,
): Promise<EncryptedPayload> {
  // Generate random nonce (12 bytes for GCM)
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);

  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce) },
    cryptoKey,
    toArrayBuffer(plaintext),
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce,
  };
}

/**
 * Decrypt a payload using AES-256-GCM
 */
export async function decryptPayload(
  encrypted: EncryptedPayload,
  key: Uint8Array,
): Promise<Uint8Array> {
  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  // Decrypt
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(encrypted.nonce) },
    cryptoKey,
    toArrayBuffer(encrypted.ciphertext),
  );

  return new Uint8Array(plaintext);
}

/**
 * Derive a shared secret from ECDH key exchange
 */
export async function deriveSharedSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "X25519", public: publicKey },
    privateKey,
    256,
  );
  return new Uint8Array(sharedBits);
}

/**
 * Generate X25519 key pair for ECDH
 */
export async function generateX25519KeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ]) as Promise<CryptoKeyPair>;
}

/**
 * Export public key to raw bytes
 */
export async function exportPublicKey(
  keyPair: CryptoKeyPair,
): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  return new Uint8Array(raw);
}

/**
 * Import public key from raw bytes
 */
export async function importPublicKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(bytes),
    { name: "X25519" },
    false,
    [],
  );
}
