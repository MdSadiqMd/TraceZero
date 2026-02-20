import { useState, useCallback } from "react";
import { useDepositStore, type Deposit } from "./useDeposit";
import { useProof } from "./useProof";
import relayerClient from "@/lib/api/relayer";
import {
  generateStealthAddress,
  generateStealthKeypair,
  type StealthKeypair,
} from "@/lib/stealth";
import { PublicKey } from "@solana/web3.js";
import { BUCKET_AMOUNTS, RELAYER_URL } from "@/lib/constants";
import {
  addStealthKey,
  type StoredStealthKey,
} from "@/lib/crypto/secureStorage";

// Minimum delay for withdrawals (1-24 hours)
const MIN_DELAY_HOURS = 1;
const MAX_DELAY_HOURS = 24;

interface WithdrawState {
  isWithdrawing: boolean;
  step:
    | "idle"
    | "verifying-tor"
    | "generating-stealth"
    | "fetching-proof"
    | "verifying-proof"
    | "generating-zk-proof"
    | "submitting";
  error: string | null;
  torVerified: boolean;
  torExitIp: string | null;
}

export function useWithdraw() {
  const [state, setState] = useState<WithdrawState>({
    isWithdrawing: false,
    step: "idle",
    error: null,
    torVerified: false,
    torExitIp: null,
  });

  const { markWithdrawn } = useDepositStore();
  const { generateProof, formatForSolana, isGenerating, progress } = useProof();

  /**
   * Verify Tor connection before withdrawal
   */
  const verifyTor = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, step: "verifying-tor", error: null }));

    try {
      const result = await relayerClient.verifyTorConnection();
      setState((s) => ({
        ...s,
        torVerified: result.isTor,
        torExitIp: result.exitIp,
      }));
      return result.isTor;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tor verification failed";
      setState((s) => ({ ...s, error: message, torVerified: false }));
      return false;
    }
  }, []);

  /**
   * Execute withdrawal with full privacy:
   * 1. Verify Tor connection
   * 2. Generate stealth address (MANDATORY)
   * 3. Fetch and verify merkle proof
   * 4. Generate ZK proof with binding hash
   * 5. Submit via Tor
   */
  const withdraw = useCallback(
    async (
      deposit: Deposit,
      options: {
        stealthKeypair?: StealthKeypair;
        delayHours?: number;
        devMode?: boolean;
      } = {},
    ): Promise<{ txSignature: string; stealthAddress: PublicKey }> => {
      setState({
        isWithdrawing: true,
        step: "idle",
        error: null,
        torVerified: false,
        torExitIp: null,
      });

      try {
        // Step 1: Verify Tor connection
        setState((s) => ({ ...s, step: "verifying-tor" }));
        const torOk = await verifyTor();
        if (!torOk) {
          throw new Error("Tor connection required for withdrawals");
        }

        // Step 2: Generate stealth address (MANDATORY for privacy)
        setState((s) => ({ ...s, step: "generating-stealth" }));
        const stealthKeypair =
          options.stealthKeypair || (await generateStealthKeypair());
        const stealth = await generateStealthAddress(
          stealthKeypair.spendKey.publicKey,
          stealthKeypair.viewPubkey, // Use public key, not private key
        );
        const stealthAddress = stealth.address;

        // Step 3: Fetch merkle proof from relayer
        setState((s) => ({ ...s, step: "fetching-proof" }));
        const bucketId = BUCKET_AMOUNTS.findIndex((b) => b === deposit.amount);
        if (bucketId === -1) {
          throw new Error("Invalid deposit amount");
        }

        const merkleProofResponse = await relayerClient.getMerkleProof(
          bucketId,
          deposit.leafIndex,
        );

        const merkleProof = {
          root: hexToBytes(
            merkleProofResponse.siblings[
              merkleProofResponse.siblings.length - 1
            ] || "",
          ),
          pathElements: merkleProofResponse.siblings.map(hexToBytes),
          pathIndices: merkleProofResponse.pathIndices,
        };

        // Step 4: Verify merkle proof locally
        setState((s) => ({ ...s, step: "verifying-proof" }));

        // Import merkle verification
        const { verifyMerkleProof, computeMerkleRoot } =
          await import("@/lib/crypto/poseidon");

        // Get pool info for current merkle root
        const poolInfo = await relayerClient.getPoolInfo(bucketId);
        const currentRoot = hexToBytes(poolInfo.merkleRoot);

        // Debug: Log commitment and proof details
        console.log("=== Merkle Proof Verification Debug ===");
        console.log("Bucket ID:", bucketId);
        console.log("Leaf Index:", deposit.leafIndex);
        console.log("Local commitment (hex):", bytesToHex(deposit.commitment));
        console.log("Pool merkle root:", poolInfo.merkleRoot);
        console.log("Pool tree size:", poolInfo.treeSize);
        console.log(
          "Proof siblings count:",
          merkleProofResponse.siblings.length,
        );
        console.log("First sibling:", merkleProofResponse.siblings[0]);
        console.log(
          "Path indices:",
          merkleProofResponse.pathIndices.slice(0, 5),
          "...",
        );

        // Fetch the commitment stored in the relayer for comparison
        try {
          const relayerCommitment = (await fetch(
            `${RELAYER_URL}/commitment/${bucketId}/${deposit.leafIndex}`,
          ).then((r) => r.json())) as {
            success: boolean;
            commitment?: string;
            error?: string;
          };
          if (relayerCommitment.success && relayerCommitment.commitment) {
            console.log(
              "Relayer commitment (hex):",
              relayerCommitment.commitment,
            );
            if (
              relayerCommitment.commitment !== bytesToHex(deposit.commitment)
            ) {
              console.error("❌ COMMITMENT MISMATCH!");
              console.error("  Local:", bytesToHex(deposit.commitment));
              console.error("  Relayer:", relayerCommitment.commitment);
              throw new Error(
                "Commitment mismatch: Your local deposit data does not match the relayer's records. " +
                  "This can happen if the relayer was reset or if there was a sync issue during deposit. " +
                  "Please clear your deposits and make a new deposit.",
              );
            } else {
              console.log("✓ Commitments match");
            }
          } else {
            console.warn(
              "Could not fetch relayer commitment:",
              relayerCommitment.error,
            );
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("Commitment mismatch")) {
            throw e;
          }
          console.warn("Could not fetch relayer commitment:", e);
        }

        // Compute what root we get from the proof
        const computedRoot = await computeMerkleRoot(
          deposit.commitment,
          merkleProof.pathElements.map((e) => new Uint8Array(e)),
          merkleProof.pathIndices,
        );
        console.log(
          "Computed root from local commitment:",
          bytesToHex(computedRoot),
        );
        console.log("Expected root from relayer:", poolInfo.merkleRoot);
        console.log("=== End Debug ===");

        // Verify the proof is valid
        const proofValid = await verifyMerkleProof(
          new Uint8Array(currentRoot),
          deposit.commitment,
          merkleProof.pathElements.map((e) => new Uint8Array(e)),
          merkleProof.pathIndices,
        );

        if (!proofValid) {
          throw new Error(
            "Merkle proof verification failed - relayer may be compromised",
          );
        }

        // Step 5: Generate ZK proof with binding hash
        setState((s) => ({ ...s, step: "generating-zk-proof" }));

        // Fetch relayer's Solana pubkey and fee info from the relayer service
        const relayerInfo = await relayerClient.getRelayerInfo();
        const relayer = new PublicKey(relayerInfo.solanaPubkey);

        // Compute fee exactly as the on-chain program does:
        // fee = amount * fee_bps / 10000
        // This MUST match request_withdrawal.rs or the ZK proof will fail
        const feeBps = BigInt(relayerInfo.feeBps);
        const fee = (BigInt(deposit.amount) * feeBps) / 10000n;
        console.log(
          `Fee computation: amount=${deposit.amount}, feeBps=${feeBps}, fee=${fee}`,
        );

        const delayHours = options.devMode
          ? 0
          : options.delayHours ||
            Math.floor(Math.random() * (MAX_DELAY_HOURS - MIN_DELAY_HOURS)) +
              MIN_DELAY_HOURS;

        const depositNote = {
          nullifier: deposit.nullifier,
          secret: deposit.secret,
          amount: BigInt(deposit.amount),
          commitment: deposit.commitment,
          leafIndex: deposit.leafIndex,
        };

        const proofResult = await generateProof(
          depositNote,
          {
            root: new Uint8Array(currentRoot),
            pathElements: merkleProof.pathElements.map(
              (e) => new Uint8Array(e),
            ),
            pathIndices: merkleProof.pathIndices,
          },
          stealthAddress.toBytes(),
          relayer.toBytes(),
          fee,
        );

        // Verify proof locally before sending to chain
        const { verifyProof } = await import("@/lib/zk/prover");
        const localVerifyResult = await verifyProof(
          proofResult.proof,
          proofResult.publicSignals,
        );
        console.log("=== Local Proof Verification ===");
        console.log("Local verification result:", localVerifyResult);
        if (!localVerifyResult) {
          throw new Error("Local proof verification failed - proof is invalid");
        }
        console.log("=== End Local Verification ===");

        // Get the actual values from publicSignals (these are the reduced field elements)
        // snarkjs publicSignals order: [bindingHash, root, nullifierHash, recipient, amount, relayer, fee]
        const bindingHashFromCircuit = proofResult.publicSignals[0];
        const nullifierHash = proofResult.publicSignals[2];
        const recipientFromCircuit = proofResult.publicSignals[3];
        const relayerFromCircuit = proofResult.publicSignals[5];

        console.log("=== ZK Proof Public Signals Debug ===");
        console.log("publicSignals:", proofResult.publicSignals);
        console.log("bindingHash:", bindingHashFromCircuit);
        console.log("nullifierHash:", nullifierHash);
        console.log("recipient:", recipientFromCircuit);
        console.log("relayer:", relayerFromCircuit);
        console.log("Original relayer pubkey:", relayer.toBase58());
        console.log("=== End Debug ===");

        const nullifierHashBytes = bigIntToBytes(BigInt(nullifierHash));
        const bindingHashBytes = bigIntToBytes(BigInt(bindingHashFromCircuit));
        const recipientBytes = bigIntToBytes(BigInt(recipientFromCircuit));
        const relayerBytes = bigIntToBytes(BigInt(relayerFromCircuit));

        // Format proof for submission
        const { proof, publicInputs } = formatForSolana(proofResult);

        // Debug: Log formatted proof
        console.log("=== Formatted Proof Debug ===");
        console.log("Proof length:", proof.length);
        console.log("pi_a (first 16 bytes):", bytesToHex(proof.slice(0, 16)));
        console.log("pi_b (first 16 bytes):", bytesToHex(proof.slice(64, 80)));
        console.log(
          "pi_c (first 16 bytes):",
          bytesToHex(proof.slice(192, 208)),
        );
        console.log(
          "Original pi_a from snarkjs:",
          proofResult.proof.pi_a[0].substring(0, 30) + "...",
        );
        console.log(
          "Original pi_a[1] from snarkjs:",
          proofResult.proof.pi_a[1].substring(0, 30) + "...",
        );
        console.log("=== End Formatted Proof Debug ===");

        // Step 6: Submit withdrawal request via Tor
        setState((s) => ({ ...s, step: "submitting" }));

        // IMPORTANT: Send the EXACT values from publicSignals, not the original pubkeys
        // This ensures the on-chain verifier receives the same values the circuit used
        const response = await relayerClient.requestWithdrawal({
          proof: bytesToHex(proof),
          publicInputs: publicInputs.map(bytesToHex),
          nullifierHash: bytesToHex(nullifierHashBytes),
          recipient: bytesToHex(recipientBytes), // Use circuit's reduced value
          relayer: bytesToHex(relayerBytes), // Use circuit's reduced value
          fee: Number(fee),
          merkleRoot: poolInfo.merkleRoot,
          bindingHash: bytesToHex(bindingHashBytes), // Use circuit's output
          delayHours,
          amount: deposit.amount,
        });

        if (!response.success) {
          throw new Error(response.error || "Withdrawal request failed");
        }

        // Mark deposit as withdrawn
        markWithdrawn(deposit.id);

        // Save stealth keypair so user can sweep funds later
        // The stealth address is now guaranteed to be BN254-compatible,
        // so it matches the on-chain recipient exactly (no reduction needed)
        // IMPORTANT: Use stealth.secretKey, not stealthKeypair.spendKey.secretKey
        // because generateStealthAddress creates a different keypair internally
        if (stealthKeypair) {
          const entry: StoredStealthKey = {
            id: `stealth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            stealthAddress: stealthAddress.toBase58(),
            stealthSecretKey: btoa(String.fromCharCode(...stealth.secretKey)), // Use the correct secret key
            ephemeralPubkey: btoa(
              String.fromCharCode(...stealth.ephemeralPubkey),
            ),
            amount: deposit.amount,
            createdAt: Date.now(),
            swept: false,
          };
          addStealthKey(entry);
          console.log(
            "✓ Stealth keypair saved for later sweep:",
            entry.stealthAddress,
          );
        }

        setState({
          isWithdrawing: false,
          step: "idle",
          error: null,
          torVerified: true,
          torExitIp: state.torExitIp,
        });

        return {
          txSignature: response.txSignature!,
          stealthAddress,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Withdrawal failed";
        setState((s) => ({
          ...s,
          isWithdrawing: false,
          step: "idle",
          error: message,
        }));
        throw error;
      }
    },
    [generateProof, formatForSolana, markWithdrawn, verifyTor, state.torExitIp],
  );

  return {
    ...state,
    isGenerating,
    proofProgress: progress,
    verifyTor,
    withdraw,
  };
}

// Helper functions
function hexToBytes(hex: string): Uint8Array {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bigIntToBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}
