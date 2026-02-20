// ZK proof generation using snarkjs
// Generates Groth16 proofs for withdrawal circuit
import * as snarkjs from "snarkjs";

export interface WithdrawalProofInput {
  // Private inputs
  nullifier: bigint;
  secret: bigint;
  pathElements: bigint[];
  pathIndices: number[];

  // Public inputs
  merkleRoot: bigint;
  nullifierHash: bigint;
  recipient: bigint;
  relayer: bigint;
  fee: bigint;
  amount: bigint;
}

export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
}

export interface ProofResult {
  proof: Groth16Proof;
  publicSignals: string[];
}

// Circuit file paths (loaded from public directory)
const WITHDRAWAL_WASM = "/circuits/withdrawal.wasm";
const WITHDRAWAL_ZKEY = "/circuits/withdrawal_final.zkey";

/**
 * Generate a withdrawal proof
 */
export async function generateWithdrawalProof(
  input: WithdrawalProofInput,
): Promise<ProofResult> {
  // Prepare circuit input
  const circuitInput = {
    // Private inputs
    nullifier: input.nullifier.toString(),
    secret: input.secret.toString(),
    pathElements: input.pathElements.map((e) => e.toString()),
    pathIndices: input.pathIndices,

    // Public inputs
    root: input.merkleRoot.toString(),
    nullifierHash: input.nullifierHash.toString(),
    recipient: input.recipient.toString(),
    relayer: input.relayer.toString(),
    fee: input.fee.toString(),
    amount: input.amount.toString(),
  };

  try {
    // Generate proof using snarkjs
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      WITHDRAWAL_WASM,
      WITHDRAWAL_ZKEY,
    );

    return {
      proof: proof as Groth16Proof,
      publicSignals,
    };
  } catch (error) {
    console.error("Proof generation failed:", error);
    throw new Error(`Failed to generate proof: ${error}`);
  }
}

/**
 * Verify a proof locally (for testing)
 */
export async function verifyProof(
  proof: Groth16Proof,
  publicSignals: string[],
  vkeyPath = "/circuits/withdrawal_vk.json",
): Promise<boolean> {
  try {
    const vkeyResponse = await fetch(vkeyPath);
    const vkey = await vkeyResponse.json();

    return await snarkjs.groth16.verify(vkey, publicSignals, proof);
  } catch (error) {
    console.error("Proof verification failed:", error);
    return false;
  }
}

// BN254 base field modulus
const BN254_P =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

/**
 * Format proof for Solana on-chain verification
 * Converts snarkjs proof format to the format expected by groth16-solana
 *
 * NOTE: proof_a is NEGATED here in the frontend.
 * groth16-solana expects -A (negated proof_a) for the pairing check.
 */
export function formatProofForSolana(proof: Groth16Proof): Uint8Array {
  const proofBytes = new Uint8Array(256);

  // pi_a: 2 field elements (32 bytes each) - NEGATED for groth16-solana
  const pi_a_x = BigInt(proof.pi_a[0]);
  const pi_a_y = BigInt(proof.pi_a[1]);

  // Negate Y coordinate: Y_neg = p - Y (where p is the BN254 base field modulus)
  const pi_a_y_neg = BN254_P - pi_a_y;

  console.log("=== Proof A Negation Debug ===");
  console.log("Original pi_a_y:", pi_a_y.toString(16));
  console.log("BN254_P:", BN254_P.toString(16));
  console.log("Negated pi_a_y:", pi_a_y_neg.toString(16));
  console.log("=== End Negation Debug ===");

  writeFieldElement(proofBytes, 0, pi_a_x);
  writeFieldElement(proofBytes, 32, pi_a_y_neg); // Negated Y for groth16-solana

  // pi_b: 2x2 field elements (32 bytes each)
  // Reversed Fq2 order to match VK: x_c1, x_c0, y_c1, y_c0
  const piB = [
    [BigInt(proof.pi_b[0][0]), BigInt(proof.pi_b[0][1])],
    [BigInt(proof.pi_b[1][0]), BigInt(proof.pi_b[1][1])],
  ];
  writeFieldElement(proofBytes, 64, piB[0][1]);
  writeFieldElement(proofBytes, 96, piB[0][0]);
  writeFieldElement(proofBytes, 128, piB[1][1]);
  writeFieldElement(proofBytes, 160, piB[1][0]);

  // pi_c: 2 field elements (32 bytes each)
  writeFieldElement(proofBytes, 192, BigInt(proof.pi_c[0]));
  writeFieldElement(proofBytes, 224, BigInt(proof.pi_c[1]));

  return proofBytes;
}

function writeFieldElement(
  buffer: Uint8Array,
  offset: number,
  value: bigint,
): void {
  for (let i = 31; i >= 0; i--) {
    buffer[offset + i] = Number(value & 0xffn);
    value >>= 8n;
  }
}

/**
 * Format public inputs for Solana
 */
export function formatPublicInputsForSolana(
  publicSignals: string[],
): Uint8Array[] {
  return publicSignals.map((signal) => {
    const value = BigInt(signal);
    const bytes = new Uint8Array(32);
    writeFieldElement(bytes, 0, value);
    return bytes;
  });
}
