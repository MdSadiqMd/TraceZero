export interface BlindingFactor {
  r: bigint;
  rInv: bigint;
}

export interface RSAPublicKey {
  n: bigint;
  e: bigint;
}

// Convert Uint8Array to bigint
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

// Convert bigint to Uint8Array
function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

// GCD using Euclidean algorithm
function gcd(a: bigint, b: bigint): bigint {
  while (b > 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

// Modular exponentiation
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

// Extended Euclidean algorithm for modular inverse
function modInverse(a: bigint, n: bigint): bigint | null {
  let [oldR, r] = [n, a];
  let [oldS, s] = [0n, 1n];

  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }

  if (oldR > 1n) return null;
  if (oldS < 0n) oldS += n;
  return oldS;
}

// Generate random blinding factor coprime to n
function generateBlindingFactor(n: bigint): bigint {
  const nBytes = Math.ceil(n.toString(16).length / 2);
  const bytes = new Uint8Array(nBytes);

  while (true) {
    crypto.getRandomValues(bytes);
    const r = bytesToBigInt(bytes) % n;
    if (r > 1n && gcd(r, n) === 1n) {
      return r;
    }
  }
}

// Helper to convert Uint8Array to ArrayBuffer for Web Crypto API
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  // Create a new ArrayBuffer and copy data to avoid SharedArrayBuffer issues
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

// SHA-256 hash
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(hash);
}

/**
 * Blind a message before sending to signer
 * Returns [blindedMessage, blindingFactor]
 */
export async function blindMessage(
  message: Uint8Array,
  publicKey: RSAPublicKey,
): Promise<[Uint8Array, BlindingFactor]> {
  const { n, e } = publicKey;

  // Hash the message
  const hash = await sha256(message);
  const m = bytesToBigInt(hash);

  // Generate random blinding factor
  const r = generateBlindingFactor(n);
  const rInv = modInverse(r, n);
  if (!rInv) throw new Error("Failed to compute r inverse");

  // Blind: m' = m * r^e mod n
  const rE = modPow(r, e, n);
  const blinded = (m * rE) % n;

  const nBytes = Math.ceil(n.toString(16).length / 2);
  return [bigIntToBytes(blinded, nBytes), { r, rInv }];
}

/**
 * Unblind a signature received from signer
 */
export function unblindSignature(
  blindedSig: Uint8Array,
  blindingFactor: BlindingFactor,
  publicKey: RSAPublicKey,
): Uint8Array {
  const { n } = publicKey;
  const { rInv } = blindingFactor;

  const sBlind = bytesToBigInt(blindedSig);

  // Unblind: s = s' * r^(-1) mod n
  const s = (sBlind * rInv) % n;

  const nBytes = Math.ceil(n.toString(16).length / 2);
  return bigIntToBytes(s, nBytes);
}

/**
 * Verify a signature using raw RSA
 */
export async function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: RSAPublicKey,
): Promise<boolean> {
  const { n, e } = publicKey;

  // Hash the message
  const hash = await sha256(message);
  const m = bytesToBigInt(hash);

  // Verify: m == s^e mod n
  const s = bytesToBigInt(signature);
  const computed = modPow(s, e, n);

  return computed === m;
}

/**
 * Parse RSA public key from hex-encoded format (from relayer)
 */
export function parsePublicKey(keyData: {
  n: string;
  e: string;
}): RSAPublicKey {
  // Relayer sends hex-encoded n and e
  const nBytes = hexDecode(keyData.n);
  const eBytes = hexDecode(keyData.e);

  return {
    n: bytesToBigInt(nBytes),
    e: bytesToBigInt(eBytes),
  };
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
