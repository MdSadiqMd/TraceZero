// Poseidon hash implementation for browser
// Uses circomlibjs for compatibility with ZK circuits
import { buildPoseidon, type Poseidon } from "circomlibjs";

let poseidonInstance: Poseidon | null = null;

// Domain tags (MUST match circuits/*.circom and SDK)
export const DOMAIN_NULLIFIER = 1853189228n; // "null" as u32
export const DOMAIN_COMMIT = 1668246637n; // "comm" as u32
export const DOMAIN_BIND = 1651076196n; // "bind" as u32
export const DOMAIN_OWNER_BIND = 1869771618n; // "ownb" as u32

/**
 * Initialize Poseidon hasher (lazy loaded)
 */
async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/**
 * Convert Uint8Array to bigint (big-endian)
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Convert bigint to Uint8Array (big-endian, 32 bytes)
 */
export function bigIntToBytes(value: bigint, length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

/**
 * Generate random 32-byte secret (guaranteed non-zero)
 */
export function randomSecret(): Uint8Array {
  const bytes = new Uint8Array(32);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes.every((b) => b === 0));
  return bytes;
}

/**
 * Generate random bytes
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Poseidon hash of multiple inputs
 */
export async function poseidonHash(inputs: bigint[]): Promise<Uint8Array> {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs);
  const hashBigInt = poseidon.F.toObject(hash) as bigint;
  return bigIntToBytes(hashBigInt);
}

/**
 * Poseidon hash with domain separation
 */
export async function poseidonHashWithDomain(
  domain: bigint,
  inputs: bigint[],
): Promise<Uint8Array> {
  return poseidonHash([domain, ...inputs]);
}

/**
 * Generate commitment: Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
 */
export async function generateCommitment(
  nullifier: Uint8Array,
  secret: Uint8Array,
  amount: bigint,
): Promise<Uint8Array> {
  const nullifierBigInt = bytesToBigInt(nullifier);
  const secretBigInt = bytesToBigInt(secret);

  return poseidonHashWithDomain(DOMAIN_COMMIT, [
    nullifierBigInt,
    secretBigInt,
    amount,
  ]);
}

/**
 * Generate nullifier hash: Poseidon(DOMAIN_NULLIFIER, nullifier)
 */
export async function generateNullifierHash(
  nullifier: Uint8Array,
): Promise<Uint8Array> {
  const nullifierBigInt = bytesToBigInt(nullifier);
  return poseidonHashWithDomain(DOMAIN_NULLIFIER, [nullifierBigInt]);
}

/**
 * Reduce a 32-byte value to be within BN254 field
 * This ensures the value is less than the field modulus
 * MUST match SDK's reduce_to_field function
 */
function reduceToField(value: Uint8Array): Uint8Array {
  const result = new Uint8Array(value);
  // Simple reduction: mask top bits to ensure value < modulus
  // BN254 modulus is ~2^254, so we clear the top 3 bits (0x1F = 00011111)
  result[0] &= 0x1f;
  return result;
}

/**
 * Generate withdrawal binding hash: Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
 * Note: recipient and relayer are reduced to field to handle Solana pubkeys
 */
export async function generateWithdrawalBindingHash(
  nullifierHash: Uint8Array,
  recipient: Uint8Array,
  relayer: Uint8Array,
  fee: bigint,
): Promise<Uint8Array> {
  // Reduce pubkeys to field (they may exceed BN254 modulus)
  const recipientReduced = reduceToField(recipient);
  const relayerReduced = reduceToField(relayer);

  return poseidonHashWithDomain(DOMAIN_BIND, [
    bytesToBigInt(nullifierHash),
    bytesToBigInt(recipientReduced),
    bytesToBigInt(relayerReduced),
    fee,
  ]);
}

/**
 * Generate ownership binding hash: Poseidon(DOMAIN_OWNER_BIND, nullifier, pendingWithdrawalId)
 */
export async function generateOwnershipBindingHash(
  nullifier: Uint8Array,
  pendingWithdrawalId: bigint,
): Promise<Uint8Array> {
  return poseidonHashWithDomain(DOMAIN_OWNER_BIND, [
    bytesToBigInt(nullifier),
    pendingWithdrawalId,
  ]);
}

/**
 * Hash two nodes together for Merkle tree: Poseidon(left, right)
 */
export async function hashMerkleNodes(
  left: Uint8Array,
  right: Uint8Array,
): Promise<Uint8Array> {
  return poseidonHash([bytesToBigInt(left), bytesToBigInt(right)]);
}

/**
 * Verify a Merkle proof client-side
 * SECURITY: Always verify proofs from relayer before generating ZK proofs
 */
export async function verifyMerkleProof(
  root: Uint8Array,
  leaf: Uint8Array,
  siblings: Uint8Array[],
  pathIndices: number[],
): Promise<boolean> {
  if (siblings.length !== pathIndices.length) {
    console.error("Merkle proof: siblings and pathIndices length mismatch");
    return false;
  }

  let current = leaf;

  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    const isRight = pathIndices[i] === 1;

    if (isRight) {
      current = await hashMerkleNodes(sibling, current);
    } else {
      current = await hashMerkleNodes(current, sibling);
    }
  }

  // Compare computed root with expected root
  const computedRoot = current;
  const match =
    computedRoot.length === root.length &&
    computedRoot.every((byte, i) => byte === root[i]);

  if (!match) {
    console.error("Merkle proof verification failed: root mismatch");
    console.error("Expected:", bytesToHex(root));
    console.error("Computed:", bytesToHex(computedRoot));
  }

  return match;
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute Merkle root from leaf and proof (without verification)
 */
export async function computeMerkleRoot(
  leaf: Uint8Array,
  siblings: Uint8Array[],
  pathIndices: number[],
): Promise<Uint8Array> {
  let current = leaf;

  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    const isRight = pathIndices[i] === 1;

    if (isRight) {
      current = await hashMerkleNodes(sibling, current);
    } else {
      current = await hashMerkleNodes(current, sibling);
    }
  }

  return current;
}
