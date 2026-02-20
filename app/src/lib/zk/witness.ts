// Witness generation for ZK circuits
import { bytesToBigInt } from "../crypto/poseidon";

export interface WithdrawalWitness {
  // Private inputs
  nullifier: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];

  // Public inputs
  root: string;
  nullifierHash: string;
  recipient: string;
  amount: string;
  relayer: string;
  fee: string;
}

export interface OwnershipWitness {
  // Private inputs
  nullifier: string;

  // Public inputs
  nullifierHash: string;
  pendingWithdrawalId: string;
}

export interface DepositNote {
  nullifier: Uint8Array;
  secret: Uint8Array;
  amount: bigint;
  commitment: Uint8Array;
  leafIndex: number;
}

export interface MerkleProof {
  root: Uint8Array;
  pathElements: Uint8Array[];
  pathIndices: number[];
}

/**
 * Generate witness for withdrawal circuit
 */
export function generateWithdrawalWitness(
  note: DepositNote,
  merkleProof: MerkleProof,
  nullifierHash: Uint8Array,
  recipient: Uint8Array,
  relayer: Uint8Array,
  fee: bigint,
): WithdrawalWitness {
  return {
    // Private inputs
    nullifier: bytesToBigInt(note.nullifier).toString(),
    secret: bytesToBigInt(note.secret).toString(),
    pathElements: merkleProof.pathElements.map((e) =>
      bytesToBigInt(e).toString(),
    ),
    pathIndices: merkleProof.pathIndices,

    // Public inputs
    root: bytesToBigInt(merkleProof.root).toString(),
    nullifierHash: bytesToBigInt(nullifierHash).toString(),
    recipient: bytesToBigInt(recipient).toString(),
    amount: note.amount.toString(),
    relayer: bytesToBigInt(relayer).toString(),
    fee: fee.toString(),
  };
}

/**
 * Generate witness for ownership circuit (cancellation)
 */
export function generateOwnershipWitness(
  nullifier: Uint8Array,
  nullifierHash: Uint8Array,
  pendingWithdrawalId: bigint,
): OwnershipWitness {
  return {
    nullifier: bytesToBigInt(nullifier).toString(),
    nullifierHash: bytesToBigInt(nullifierHash).toString(),
    pendingWithdrawalId: pendingWithdrawalId.toString(),
  };
}

/**
 * Validate witness inputs match circuit constraints
 */
export function validateWithdrawalWitness(witness: WithdrawalWitness): void {
  // Nullifier must be non-zero
  if (BigInt(witness.nullifier) === 0n) {
    throw new Error("Nullifier must be non-zero");
  }

  // Secret must be non-zero
  if (BigInt(witness.secret) === 0n) {
    throw new Error("Secret must be non-zero");
  }

  // Amount must be non-zero
  if (BigInt(witness.amount) === 0n) {
    throw new Error("Amount must be non-zero");
  }

  // Fee must be less than amount
  if (BigInt(witness.fee) >= BigInt(witness.amount)) {
    throw new Error("Fee must be less than amount");
  }

  // Path elements must match tree depth
  if (witness.pathElements.length !== witness.pathIndices.length) {
    throw new Error("Path elements and indices must have same length");
  }
}
