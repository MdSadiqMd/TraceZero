import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCreditsStore, type Credit } from "@/hooks/useCredits";
import { useBlindSignature } from "@/hooks/useBlindSignature";
import { BUCKET_AMOUNTS, RELAYER_FEE_PERCENT } from "@/lib/constants";

export const Route = createFileRoute("/credits")({
  component: CreditsPage,
});

function CreditsPage() {
  const { connected, publicKey } = useWallet();
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const { credits, addCredit } = useCreditsStore();
  const {
    createSignedToken,
    isBlinding,
    isSigning,
    isUnblinding,
    error: blindError,
  } = useBlindSignature();

  const handlePurchase = async () => {
    if (!connected || !publicKey || selectedBucket === null) return;

    setIsPurchasing(true);
    setPurchaseError(null);
    setPurchaseSuccess(false);

    try {
      const amount = BUCKET_AMOUNTS[selectedBucket];
      const { tokenId, signature } = await createSignedToken(amount);

      const credit: Credit = {
        id: crypto.randomUUID(),
        amount,
        tokenId,
        signature,
        createdAt: Date.now(),
        used: false,
      };
      addCredit(credit);
      setPurchaseSuccess(true);
      setTimeout(() => {
        setPurchaseSuccess(false);
        setSelectedBucket(null);
      }, 5000);
    } catch (error) {
      console.error("Failed to purchase credit:", error);
      setPurchaseError(
        error instanceof Error ? error.message : "Failed to purchase credit",
      );
    } finally {
      setIsPurchasing(false);
    }
  };

  const isLoading = isPurchasing || isBlinding || isSigning || isUnblinding;
  const displayError = purchaseError || blindError;
  const availableCredits = credits.filter((c) => !c.used);

  const getStatusMessage = () => {
    if (isBlinding) return "BLINDING_TOKEN...";
    if (isSigning) return "REQUESTING_SIGNATURE...";
    if (isUnblinding) return "UNBLINDING_SIGNATURE...";
    return "PROCESSING_TRANSACTION...";
  };

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-black">
        <div className="terminal-box max-w-md w-full">
          <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
            <div className="w-3 h-3 bg-red-500"></div>
            <div className="w-3 h-3 bg-red-500/50"></div>
            <div className="w-3 h-3 bg-red-500/20"></div>
            <span className="ml-4 text-red-500 font-mono">ERROR</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="text-red-500">
              <span className="mr-2">{">"}</span>
              WALLET_NOT_CONNECTED
            </div>
            <div className="text-white/60 mt-4">
              <span className="mr-2">{">"}</span>
              PLEASE_CONNECT_WALLET_TO_CONTINUE
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white py-12 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="inline-block border-2 border-lime px-4 py-2 mb-6">
            <span className="font-mono text-lime text-sm font-bold">
              [STEP_01_OF_03]
            </span>
          </div>
          <h1 className="font-mono font-black text-5xl lg:text-6xl mb-4">
            <span className="text-lime">[</span>
            <span className="text-white">PURCHASE_CREDITS</span>
            <span className="text-lime">]</span>
          </h1>
          <p className="font-mono text-white/60">
            Select amount to purchase blinded credits using RSA blind signatures
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left - Selection */}
          <div>
            <div className="terminal-box mb-6">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                <div className="w-3 h-3 bg-lime"></div>
                <div className="w-3 h-3 bg-lime/50"></div>
                <div className="w-3 h-3 bg-lime/20"></div>
                <span className="ml-4 text-lime">AMOUNT_SELECTION</span>
              </div>

              <div className="space-y-3">
                {BUCKET_AMOUNTS.map((amount, index) => {
                  const hexCode = `0x${(index + 1).toString(16).toUpperCase().padStart(6, "0")}`;
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedBucket(index)}
                      disabled={isLoading}
                      className={`w-full text-left p-4 border-2 transition-all duration-200 font-mono ${
                        selectedBucket === index
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-lime/20 text-white/60 hover:border-lime/50 hover:bg-lime/5"
                      } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-lime/60">{hexCode}</span>
                        {selectedBucket === index && (
                          <span className="text-lime text-xs">
                            {">"} SELECTED
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-black tabular-nums">
                          {amount / 1e9}
                        </span>
                        <span className="text-sm">SOL</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Info */}
            <div className="border-2 border-lime/20 p-6">
              <div className="text-xs text-lime/60 font-mono mb-3">
                PROTOCOL_INFO:
              </div>
              <div className="space-y-2 text-sm text-white/60">
                <div className="flex gap-2">
                  <span className="text-lime">{">"}</span>
                  <span>RSA blind signatures ensure unlinkable payments</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-lime">{">"}</span>
                  <span>Relayer signs without seeing token value</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-lime">{">"}</span>
                  <span>
                    Mathematically impossible to link payment to deposit
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right - Confirmation */}
          <div>
            {selectedBucket !== null ? (
              <div className="space-y-6">
                {/* Transaction preview */}
                <div className="terminal-box">
                  <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                    <div className="w-3 h-3 bg-lime"></div>
                    <div className="w-3 h-3 bg-lime/50"></div>
                    <div className="w-3 h-3 bg-lime/20"></div>
                    <span className="ml-4 text-lime">TRANSACTION_PREVIEW</span>
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between font-mono">
                      <span className="text-white/60">CREDIT_AMOUNT:</span>
                      <span className="text-lime tabular-nums">
                        {BUCKET_AMOUNTS[selectedBucket] / 1e9} SOL
                      </span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span className="text-white/60">RELAYER_FEE:</span>
                      <span className="text-lime tabular-nums">
                        {(BUCKET_AMOUNTS[selectedBucket] *
                          RELAYER_FEE_PERCENT) /
                          100 /
                          1e9}{" "}
                        SOL
                      </span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span className="text-white/60">FEE_PERCENT:</span>
                      <span className="text-lime">{RELAYER_FEE_PERCENT}%</span>
                    </div>
                    <div className="border-t-2 border-lime/30 pt-3 flex justify-between font-mono">
                      <span className="text-white font-bold">
                        TOTAL_PAYMENT:
                      </span>
                      <span className="text-lime font-black text-lg tabular-nums">
                        {(BUCKET_AMOUNTS[selectedBucket] *
                          (1 + RELAYER_FEE_PERCENT / 100)) /
                          1e9}{" "}
                        SOL
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status messages */}
                {displayError && (
                  <div className="border-2 border-red-500 bg-red-500/10 p-4">
                    <div className="flex items-start gap-2 font-mono text-sm">
                      <span className="text-red-500">{">"}</span>
                      <div>
                        <div className="text-red-500 font-bold mb-1">
                          ERROR:
                        </div>
                        <div className="text-red-400">{displayError}</div>
                      </div>
                    </div>
                  </div>
                )}

                {purchaseSuccess && (
                  <div className="border-2 border-lime bg-lime/10 p-4">
                    <div className="flex items-start gap-2 font-mono text-sm">
                      <span className="text-lime">{">"}</span>
                      <div>
                        <div className="text-lime font-bold mb-1">SUCCESS:</div>
                        <div className="text-lime/80">
                          CREDIT_PURCHASED_SUCCESSFULLY
                        </div>
                        <div className="text-lime/60 text-xs mt-2">
                          READY_FOR_ANONYMOUS_DEPOSIT
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Progress */}
                {isLoading && (
                  <div className="border-2 border-lime p-4">
                    <div className="font-mono text-sm text-lime mb-3">
                      {">"} {getStatusMessage()}
                    </div>
                    <div className="h-2 bg-black border-2 border-lime/30 overflow-hidden">
                      <div
                        className="h-full bg-lime animate-[pulse_1s_ease-in-out_infinite]"
                        style={{ width: "60%" }}
                      ></div>
                    </div>
                    <div className="mt-2 font-mono text-xs text-lime/60">
                      PROCESSING_0x
                      {Math.random().toString(16).substr(2, 8).toUpperCase()}...
                    </div>
                  </div>
                )}

                {/* Purchase button */}
                <button
                  onClick={handlePurchase}
                  disabled={isLoading}
                  className="btn-terminal w-full text-lg"
                >
                  {isLoading ? "[PROCESSING...]" : "[EXECUTE_PURCHASE]"}
                </button>

                {/* Your credits */}
                {credits.length > 0 && (
                  <div className="border-2 border-lime/20 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-mono text-sm text-lime">
                        YOUR_CREDITS:
                      </span>
                      <span className="font-mono text-xs text-lime/60">
                        {availableCredits.length}_AVAILABLE
                      </span>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {credits.slice(0, 5).map((credit) => (
                        <div
                          key={credit.id}
                          className={`p-3 border-2 font-mono text-sm ${
                            credit.used
                              ? "border-white/10 text-white/30"
                              : "border-lime/30 text-lime/80"
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <span className="tabular-nums">
                              {credit.amount / 1e9} SOL
                            </span>
                            <span className="text-xs">
                              {credit.used ? "[USED]" : "[READY]"}
                            </span>
                          </div>
                          <div className="text-xs text-white/40 mt-1">
                            {
                              new Date(credit.createdAt)
                                .toISOString()
                                .split("T")[0]
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="terminal-box h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl text-lime/20 mb-4">[ ]</div>
                  <div className="font-mono text-white/40">
                    {">"} SELECT_AMOUNT_TO_CONTINUE
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
