import { useState } from "react";
import { useProof } from "@/hooks/useProof";
import type { DepositNote, MerkleProof } from "@/lib/zk/witness";

interface ProofGeneratorProps {
  note: DepositNote;
  merkleProof: MerkleProof;
  recipient: Uint8Array;
  relayer: Uint8Array;
  fee: bigint;
  onProofGenerated?: (proof: Uint8Array, publicInputs: Uint8Array[]) => void;
}

export function ProofGenerator({
  note,
  merkleProof,
  recipient,
  relayer,
  fee,
  onProofGenerated,
}: ProofGeneratorProps) {
  const { generateProof, formatForSolana, isGenerating, progress, error } =
    useProof();
  const [proofGenerated, setProofGenerated] = useState(false);

  const handleGenerate = async () => {
    try {
      const result = await generateProof(
        note,
        merkleProof,
        recipient,
        relayer,
        fee,
      );
      const { proof, publicInputs } = formatForSolana(result);

      setProofGenerated(true);
      onProofGenerated?.(proof, publicInputs);
    } catch (err) {
      console.error("Proof generation failed:", err);
    }
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <h3 className="font-semibold mb-2">ZK Proof Generator</h3>

      <div className="text-sm text-gray-600 mb-4">
        Generate a zero-knowledge proof that you own a deposit without revealing
        which one.
      </div>

      {isGenerating && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <svg
              className="animate-spin h-5 w-5 text-blue-600"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm">Generating proof... {progress}%</span>
          </div>
          <div className="bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {proofGenerated && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
          ✓ Proof generated successfully
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={isGenerating || proofGenerated}
        className={`w-full py-2 px-4 rounded-lg font-semibold transition-colors ${
          !isGenerating && !proofGenerated
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        {isGenerating
          ? "Generating..."
          : proofGenerated
            ? "Proof Generated"
            : "Generate Proof"}
      </button>

      <div className="mt-4 text-xs text-gray-500">
        <div className="font-semibold mb-1">Proof Details:</div>
        <ul className="list-disc list-inside space-y-1">
          <li>Amount: {Number(note.amount) / 1e9} SOL</li>
          <li>Leaf Index: {note.leafIndex}</li>
          <li>Merkle Depth: {merkleProof.pathElements.length}</li>
          <li>Fee: {Number(fee) / 1e9} SOL</li>
        </ul>
      </div>
    </div>
  );
}
