import { useState, useCallback } from "react";
import {
  generateWithdrawalProof,
  formatProofForSolana,
  formatPublicInputsForSolana,
  type ProofResult,
} from "@/lib/zk/prover";
import {
  generateWithdrawalWitness,
  validateWithdrawalWitness,
  type DepositNote,
  type MerkleProof,
} from "@/lib/zk/witness";
import { generateNullifierHash, bytesToBigInt } from "@/lib/crypto/poseidon";

interface ProofState {
  isGenerating: boolean;
  progress: number;
  error: string | null;
}

export function useProof() {
  const [state, setState] = useState<ProofState>({
    isGenerating: false,
    progress: 0,
    error: null,
  });

  /**
   * Generate a withdrawal ZK proof
   *
   * Proves knowledge of a valid deposit without revealing which one
   */
  const generateProof = useCallback(
    async (
      note: DepositNote,
      merkleProof: MerkleProof,
      recipient: Uint8Array,
      relayer: Uint8Array,
      fee: bigint,
    ): Promise<ProofResult> => {
      setState({ isGenerating: true, progress: 0, error: null });

      try {
        // Step 1: Generate nullifier hash (10%)
        setState((s) => ({ ...s, progress: 10 }));
        const nullifierHash = await generateNullifierHash(note.nullifier);

        // Step 2: Generate witness (20%)
        setState((s) => ({ ...s, progress: 20 }));
        const witness = generateWithdrawalWitness(
          note,
          merkleProof,
          nullifierHash,
          recipient,
          relayer,
          fee,
        );

        // Step 3: Validate witness (30%)
        setState((s) => ({ ...s, progress: 30 }));
        validateWithdrawalWitness(witness);

        // Step 4: Generate proof (30% -> 90%)
        setState((s) => ({ ...s, progress: 40 }));

        // Simulate progress during proof generation
        const progressInterval = setInterval(() => {
          setState((s) => ({
            ...s,
            progress: Math.min(s.progress + 5, 85),
          }));
        }, 500);

        const proofInput = {
          nullifier: bytesToBigInt(note.nullifier),
          secret: bytesToBigInt(note.secret),
          pathElements: merkleProof.pathElements.map((e) => bytesToBigInt(e)),
          pathIndices: merkleProof.pathIndices,
          merkleRoot: bytesToBigInt(merkleProof.root),
          nullifierHash: bytesToBigInt(nullifierHash),
          recipient: bytesToBigInt(recipient),
          relayer: bytesToBigInt(relayer),
          fee,
          amount: note.amount,
        };

        const result = await generateWithdrawalProof(proofInput);

        clearInterval(progressInterval);

        // Step 5: Complete (100%)
        setState((s) => ({ ...s, progress: 100 }));

        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Proof generation failed";
        setState((s) => ({
          ...s,
          isGenerating: false,
          error: message,
        }));
        throw error;
      } finally {
        setState((s) => ({ ...s, isGenerating: false }));
      }
    },
    [],
  );

  /**
   * Format proof for Solana on-chain verification
   */
  const formatForSolana = useCallback(
    (
      result: ProofResult,
    ): { proof: Uint8Array; publicInputs: Uint8Array[] } => {
      return {
        proof: formatProofForSolana(result.proof),
        publicInputs: formatPublicInputsForSolana(result.publicSignals),
      };
    },
    [],
  );

  return {
    ...state,
    generateProof,
    formatForSolana,
  };
}
