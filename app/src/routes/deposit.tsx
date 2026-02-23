import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCreditsStore, type Credit } from "@/hooks/useCredits";
import { useDepositStore, useDeposit } from "@/hooks/useDeposit";

export const Route = createFileRoute("/deposit")({
  component: DepositPage,
});

function DepositPage() {
  const { connected } = useWallet();
  const { credits } = useCreditsStore();
  const { deposits } = useDepositStore();
  const {
    deposit,
    verifyTor,
    isDepositing,
    step,
    delayRemaining,
    torVerified,
    torExitIp,
    error,
  } = useDeposit();
  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null);
  const [depositSuccess, setDepositSuccess] = useState(false);
  const [lastTxSignature, setLastTxSignature] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);

  const availableCredits = credits.filter((c) => !c.used);

  useEffect(() => {
    verifyTor().catch(() => {});
  }, [verifyTor]);

  const handleDeposit = async () => {
    if (!selectedCredit) return;

    setDepositSuccess(false);
    setLastTxSignature(null);

    try {
      const result = await deposit(selectedCredit, {
        skipDelay: devMode,
        testMode: devMode,
      });
      setDepositSuccess(true);
      setLastTxSignature(result.txSignature);
      setSelectedCredit(null);
    } catch (err) {
      console.error("Failed to deposit:", err);
    }
  };

  const formatDelay = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const getStepMessage = () => {
    switch (step) {
      case "verifying-tor":
        return "VERIFYING_TOR_CONNECTION...";
      case "waiting-delay":
        return `TIMING_PROTECTION_DELAY: ${formatDelay(delayRemaining || 0)}`;
      case "generating-commitment":
        return "GENERATING_COMMITMENT_HASH...";
      case "submitting":
        return "SUBMITTING_VIA_TOR_NETWORK...";
      default:
        return "READY";
    }
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
          <div className="text-red-500 font-mono text-sm">
            <span className="mr-2">{">"}</span>
            WALLET_NOT_CONNECTED
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
              [STEP_02_OF_03]
            </span>
          </div>
          <h1 className="font-mono font-black text-5xl lg:text-6xl mb-4">
            <span className="text-lime">[</span>
            <span className="text-white">DEPOSIT_VIA_TOR</span>
            <span className="text-lime">]</span>
          </h1>
          <p className="font-mono text-white/60">
            Redeem credit to deposit into privacy pool via Tor network
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left - System Status */}
          <div className="space-y-6">
            {/* Tor Status */}
            <div className="terminal-box">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                <div
                  className={`w-3 h-3 ${torVerified ? "bg-lime animate-pulse" : "bg-yellow-500"}`}
                ></div>
                <div
                  className={`w-3 h-3 ${torVerified ? "bg-lime/50" : "bg-yellow-500/50"}`}
                ></div>
                <div
                  className={`w-3 h-3 ${torVerified ? "bg-lime/20" : "bg-yellow-500/20"}`}
                ></div>
                <span
                  className={`ml-4 font-mono ${torVerified ? "text-lime" : "text-yellow-500"}`}
                >
                  TOR_NETWORK_STATUS
                </span>
              </div>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex justify-between">
                  <span className="text-white/60">CONNECTION:</span>
                  <span
                    className={torVerified ? "text-lime" : "text-yellow-500"}
                  >
                    {torVerified ? "ESTABLISHED" : "CHECKING..."}
                  </span>
                </div>
                {torExitIp && (
                  <div className="flex justify-between">
                    <span className="text-white/60">EXIT_NODE:</span>
                    <span className="text-lime">{torExitIp}</span>
                  </div>
                )}
                {!torVerified && (
                  <div className="mt-4 pt-4 border-t-2 border-yellow-500/30">
                    <div className="text-yellow-500 text-xs mb-2">
                      {">"} START_TOR_GATEWAY:
                    </div>
                    <div className="text-white/40 text-xs mb-3">
                      docker compose -f crates/network/docker-compose.yml up -d
                    </div>
                    <button
                      onClick={() => verifyTor()}
                      className="border-2 border-yellow-500 text-yellow-500 px-4 py-2 text-xs font-bold hover:bg-yellow-500 hover:text-black transition-colors"
                    >
                      [RETRY_CONNECTION]
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Dev Mode */}
            <div className="border-2 border-yellow-500/50 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-mono text-yellow-500 font-bold mb-1">
                    DEV_MODE
                  </div>
                  <div className="font-mono text-xs text-white/60">
                    Skip timing delay for testing
                  </div>
                </div>
                <button
                  onClick={() => setDevMode(!devMode)}
                  className={`border-2 px-4 py-2 font-mono font-bold text-sm transition-colors ${
                    devMode
                      ? "border-yellow-500 bg-yellow-500 text-black"
                      : "border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10"
                  }`}
                >
                  [{devMode ? "ON" : "OFF"}]
                </button>
              </div>
              {devMode && (
                <div className="text-xs font-mono text-yellow-500/80">
                  {">"} TIMING_DELAY_DISABLED
                </div>
              )}
            </div>

            {/* Credit Selection */}
            {availableCredits.length > 0 && (
              <div className="terminal-box">
                <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                  <div className="w-3 h-3 bg-lime"></div>
                  <div className="w-3 h-3 bg-lime/50"></div>
                  <div className="w-3 h-3 bg-lime/20"></div>
                  <span className="ml-4 text-lime font-mono">
                    SELECT_CREDIT
                  </span>
                </div>
                <div className="space-y-2">
                  {availableCredits.map((credit, idx) => (
                    <button
                      key={credit.id}
                      onClick={() => setSelectedCredit(credit)}
                      disabled={isDepositing}
                      className={`w-full text-left p-4 border-2 transition-all duration-200 font-mono text-sm ${
                        selectedCredit?.id === credit.id
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-lime/20 text-white/60 hover:border-lime/50"
                      } ${isDepositing ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="text-xs text-lime/60 mb-1">
                            CREDIT_0x
                            {idx.toString(16).toUpperCase().padStart(4, "0")}
                          </div>
                          <div className="font-bold tabular-nums">
                            {credit.amount / 1e9} SOL
                          </div>
                        </div>
                        {selectedCredit?.id === credit.id && (
                          <span className="text-lime">{">"} SELECTED</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right - Deposit Action */}
          <div>
            {availableCredits.length === 0 ? (
              <div className="terminal-box h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl text-red-500/20 mb-4">[ ! ]</div>
                  <div className="font-mono text-white/40 mb-4">
                    {">"} NO_AVAILABLE_CREDITS
                  </div>
                  <a href="/credits" className="btn-terminal inline-block">
                    [PURCHASE_CREDITS]
                  </a>
                </div>
              </div>
            ) : selectedCredit ? (
              <div className="space-y-6">
                {/* Transaction Info */}
                <div className="terminal-box">
                  <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                    <div className="w-3 h-3 bg-lime"></div>
                    <div className="w-3 h-3 bg-lime/50"></div>
                    <div className="w-3 h-3 bg-lime/20"></div>
                    <span className="ml-4 text-lime font-mono">
                      DEPOSIT_INFO
                    </span>
                  </div>
                  <div className="space-y-2 text-sm font-mono">
                    <div className="flex justify-between">
                      <span className="text-white/60">AMOUNT:</span>
                      <span className="text-lime tabular-nums">
                        {selectedCredit.amount / 1e9} SOL
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">NETWORK:</span>
                      <span className="text-lime">TOR_ROUTED</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">YOUR_WALLET_IN_TX:</span>
                      <span className="text-lime">NEVER</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">ANONYMITY:</span>
                      <span className="text-lime">COMPLETE</span>
                    </div>
                  </div>
                </div>

                {/* Progress */}
                {isDepositing && (
                  <div className="border-2 border-lime p-4">
                    <div className="font-mono text-sm text-lime mb-3">
                      {">"} {getStepMessage()}
                    </div>
                    <div className="h-2 bg-black border-2 border-lime/30 overflow-hidden">
                      <div
                        className="h-full bg-lime animate-[pulse_1s_ease-in-out_infinite]"
                        style={{ width: "70%" }}
                      ></div>
                    </div>
                    <div className="mt-2 font-mono text-xs text-lime/60">
                      PROCESSING_0x
                      {Math.random().toString(16).substr(2, 8).toUpperCase()}...
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="border-2 border-red-500 bg-red-500/10 p-4">
                    <div className="flex items-start gap-2 font-mono text-sm">
                      <span className="text-red-500">{">"}</span>
                      <div>
                        <div className="text-red-500 font-bold mb-1">
                          ERROR:
                        </div>
                        <div className="text-red-400">{error}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success */}
                {depositSuccess && (
                  <div className="border-2 border-lime bg-lime/10 p-4">
                    <div className="flex items-start gap-2 font-mono text-sm">
                      <span className="text-lime">{">"}</span>
                      <div>
                        <div className="text-lime font-bold mb-1">SUCCESS:</div>
                        <div className="text-lime/80">DEPOSIT_COMPLETED</div>
                        <div className="text-lime/60 text-xs mt-2">
                          YOUR_WALLET_NOT_IN_TRANSACTION
                        </div>
                        {lastTxSignature && (
                          <a
                            href={`https://explorer.solana.com/tx/${lastTxSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-lime/80 hover:text-lime text-xs mt-2 inline-block"
                          >
                            {">"} VIEW_TX: {lastTxSignature.slice(0, 8)}...
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Deposit Button */}
                <button
                  onClick={handleDeposit}
                  disabled={isDepositing || !torVerified}
                  className="btn-terminal w-full text-lg"
                >
                  {isDepositing ? "[DEPOSITING...]" : "[EXECUTE_DEPOSIT]"}
                </button>

                {!torVerified && (
                  <div className="text-center font-mono text-xs text-yellow-500">
                    {">"} TOR_CONNECTION_REQUIRED
                  </div>
                )}
              </div>
            ) : (
              <div className="terminal-box h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl text-lime/20 mb-4">[ ]</div>
                  <div className="font-mono text-white/40">
                    {">"} SELECT_CREDIT_TO_CONTINUE
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Existing Deposits */}
        {deposits.length > 0 && (
          <div className="mt-12 terminal-box">
            <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
              <div className="w-3 h-3 bg-lime"></div>
              <div className="w-3 h-3 bg-lime/50"></div>
              <div className="w-3 h-3 bg-lime/20"></div>
              <span className="ml-4 text-lime font-mono">YOUR_DEPOSITS</span>
            </div>
            <div className="data-grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {deposits.map((deposit, idx) => (
                <div key={deposit.id} className="data-cell">
                  <div className="text-xs text-lime/60 mb-2">
                    DEPOSIT_0x{idx.toString(16).toUpperCase().padStart(4, "0")}
                  </div>
                  <div className="font-bold text-lg tabular-nums mb-1">
                    {deposit.amount / 1e9} SOL
                  </div>
                  <div className="text-xs text-white/40 mb-2">
                    LEAF_#{deposit.leafIndex}
                  </div>
                  <div
                    className={`text-xs font-mono ${deposit.withdrawn ? "text-white/40" : "text-lime"}`}
                  >
                    {deposit.withdrawn ? "[WITHDRAWN]" : "[AVAILABLE]"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
