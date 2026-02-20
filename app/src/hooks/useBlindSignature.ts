import { useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  blindMessage,
  unblindSignature,
  parsePublicKey,
  type RSAPublicKey,
} from "@/lib/blind";
import relayerClient from "@/lib/api/relayer";
import { randomBytes } from "@/lib/crypto/poseidon";
import { RELAYER_FEE_PERCENT } from "@/lib/constants";

interface BlindSignatureState {
  isPaying: boolean;
  isBlinding: boolean;
  isSigning: boolean;
  isUnblinding: boolean;
  error: string | null;
}

export function useBlindSignature() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [state, setState] = useState<BlindSignatureState>({
    isPaying: false,
    isBlinding: false,
    isSigning: false,
    isUnblinding: false,
    error: null,
  });

  const [relayerPubkey, setRelayerPubkey] = useState<RSAPublicKey | null>(null);
  const [relayerSolanaPubkey, setRelayerSolanaPubkey] = useState<string | null>(
    null,
  );

  /**
   * Fetch relayer's RSA public key (cached)
   */
  const getRelayerPubkey = useCallback(async (): Promise<RSAPublicKey> => {
    if (relayerPubkey) return relayerPubkey;

    const { n, e } = await relayerClient.getPublicKey();
    const pubkey = parsePublicKey({ n, e });
    setRelayerPubkey(pubkey);
    return pubkey;
  }, [relayerPubkey]);

  /**
   * Get relayer's Solana pubkey for payment
   */
  const getRelayerSolanaPubkey = useCallback(async (): Promise<string> => {
    if (relayerSolanaPubkey) return relayerSolanaPubkey;

    const info = await relayerClient.getRelayerInfo();
    setRelayerSolanaPubkey(info.solanaPubkey);
    return info.solanaPubkey;
  }, [relayerSolanaPubkey]);

  /**
   * Create a signed token through the blind signature protocol
   *
   * Flow:
   * 1. Send SOL payment to relayer (on-chain, visible)
   * 2. Generate random token ID
   * 3. Blind the token ID
   * 4. Send blinded token + payment tx to relayer for signing
   * 5. Unblind the signature
   *
   * Result: User has a valid signature on tokenId that relayer cannot link
   */
  const createSignedToken = useCallback(
    async (
      amount: number,
    ): Promise<{ tokenId: Uint8Array; signature: Uint8Array }> => {
      if (!publicKey) {
        throw new Error("Wallet not connected");
      }

      setState({
        isPaying: false,
        isBlinding: false,
        isSigning: false,
        isUnblinding: false,
        error: null,
      });

      try {
        // Step 1: Get relayer info
        const [rsaPubkey, relayerSolana] = await Promise.all([
          getRelayerPubkey(),
          getRelayerSolanaPubkey(),
        ]);
        const relayerPubkeyObj = new PublicKey(relayerSolana);

        // Step 2: Calculate payment amount (amount + fee)
        const feeAmount = Math.floor((amount * RELAYER_FEE_PERCENT) / 100);
        const totalPayment = amount + feeAmount;

        // Step 3: Send SOL payment to relayer
        setState((s) => ({ ...s, isPaying: true }));

        const paymentTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: relayerPubkeyObj,
            lamports: totalPayment,
          }),
        );

        const paymentSig = await sendTransaction(paymentTx, connection);

        // Wait for confirmation (use 'finalized' for devnet reliability)
        console.log("Waiting for payment confirmation...");
        const confirmation = await connection.confirmTransaction(
          paymentSig,
          "finalized",
        );
        if (confirmation.value.err) {
          throw new Error("Payment transaction failed");
        }

        // Extra delay to ensure RPC nodes have synced
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log("Payment confirmed:", paymentSig);
        setState((s) => ({ ...s, isPaying: false }));

        // Step 4: Generate random token ID
        const tokenId = randomBytes(32);

        // Step 5: Blind the token ID
        setState((s) => ({ ...s, isBlinding: true }));
        const [blindedToken, blindingFactor] = await blindMessage(
          tokenId,
          rsaPubkey,
        );
        setState((s) => ({ ...s, isBlinding: false }));

        // Step 6: Send to relayer for signing (with payment proof)
        setState((s) => ({ ...s, isSigning: true }));
        const response = await relayerClient.purchaseCredits({
          blindedToken: bytesToHex(blindedToken),
          amount,
          paymentTx: paymentSig,
          payer: publicKey.toBase58(),
        });
        setState((s) => ({ ...s, isSigning: false }));

        // Step 7: Unblind the signature
        setState((s) => ({ ...s, isUnblinding: true }));
        const blindedSig = hexToBytes(response.blindedSignature);
        const signature = unblindSignature(
          blindedSig,
          blindingFactor,
          rsaPubkey,
        );
        setState((s) => ({ ...s, isUnblinding: false }));

        return { tokenId, signature };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Blind signature failed";
        setState((s) => ({
          ...s,
          isPaying: false,
          isBlinding: false,
          isSigning: false,
          isUnblinding: false,
          error: message,
        }));
        throw error;
      }
    },
    [
      publicKey,
      connection,
      sendTransaction,
      getRelayerPubkey,
      getRelayerSolanaPubkey,
    ],
  );

  return {
    ...state,
    createSignedToken,
    getRelayerPubkey,
  };
}

// Helper functions
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
