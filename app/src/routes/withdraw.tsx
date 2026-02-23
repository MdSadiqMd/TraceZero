import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useDepositStore, type Deposit } from "@/hooks/useDeposit";
import { useWithdraw } from "@/hooks/useWithdraw";
import { generateStealthKeypair } from "@/lib/stealth";
import relayerClient, { type PendingWithdrawalInfo } from "@/lib/api/relayer";

export const Route = createFileRoute("/withdraw")({
  component: WithdrawPage,
});

function WithdrawPage() {
  const { connected, publicKey } = useWallet();
  const { deposits } = useDepositStore();
  const { isWithdrawing, step, error, proofProgress, withdraw } = useWithdraw();

  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [useStealth, setUseStealth] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [stealthAddr, setStealthAddr] = useState<string | null>(null);
  const [pendingWithdrawals, setPendingWithdrawals] = useState<
    PendingWithdrawalInfo[]
  >([]);
  const [executingHash, setExecutingHash] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executeTx, setExecuteTx] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  const availableDeposits = deposits.filter((d) => !d.withdrawn);

  const fetchPending = useCallback(async () => {
    try {
      const data = await relayerClient.getPendingWithdrawals();
      setPendingWithdrawals(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchPending();
    const interval = setInterval(fetchPending, 10000);
    return () => clearInterval(interval);
  }, [fetchPending]);

  useEffect(() => {
    const interval = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, []);

  const handleWithdraw = async () => {
    if (!selectedDeposit) return;
    try {
      if (!useStealth) {
        if (!recipientAddress && !publicKey)
          throw new Error("No recipient address");
        if (recipientAddress) new PublicKey(recipientAddress);
      }
      const stealthKeypair = useStealth
        ? await generateStealthKeypair()
        : undefined;
      const result = await withdraw(selectedDeposit, {
        stealthKeypair,
        devMode,
      });
      setTxSignature(result.txSignature);
      setStealthAddr(result.stealthAddress.toBase58());
      setSelectedDeposit(null);
      setTimeout(fetchPending, 2000);
    } catch (err) {
      console.error("Withdrawal failed:", err);
    }
  };

  const handleExecute = async (nullifierHash: string) => {
    setExecutingHash(nullifierHash);
    setExecuteError(null);
    setExecuteTx(null);
    try {
      const result = await relayerClient.executeWithdrawal(nullifierHash);
      if (!result.success) throw new Error(result.error || "Execution failed");
      setExecuteTx(result.txSignature || null);
      setTimeout(fetchPending, 2000);
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setExecutingHash(null);
    }
  };

  const formatCountdown = (executeAfter: number) => {
    const diff = executeAfter - now;
    if (diff <= 0) return null;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const getStepMessage = () => {
    switch (step) {
      case "generating-stealth":
        return "GENERATING_STEALTH_ADDRESS...";
      case "fetching-proof":
        return "FETCHING_MERKLE_PROOF...";
      case "verifying-proof":
        return "VERIFYING_MERKLE_PROOF...";
      case "generating-zk-proof":
        return `GENERATING_ZK_PROOF... ${proofProgress}%`;
      case "submitting":
        return "SUBMITTING_WITHDRAWAL_REQUEST...";
      default:
        return "READY";
    }
  };

  const activePending = pendingWithdrawals.filter((p) => !p.executed);
  const executedRecently = pendingWithdrawals.filter((p) => p.executed);

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

  if (txSignature) {
    return (
      <div className="min-h-screen bg-black text-white py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12">
            <div className="inline-block border-2 border-lime px-4 py-2 mb-6">
              <span className="font-mono text-lime text-sm font-bold">
                [STEP_03_OF_03]
              </span>
            </div>
            <h1 className="font-mono font-black text-5xl lg:text-6xl mb-4">
              <span className="text-lime">[</span>
              <span className="text-white">WITHDRAW_WITH_ZK</span>
              <span className="text-lime">]</span>
            </h1>
          </div>

          <div className="border-2 border-lime bg-lime/10 p-6 mb-6">
            <div className="flex items-start gap-2 font-mono text-sm">
              <span className="text-lime">{">"}</span>
              <div>
                <div className="text-lime font-bold mb-2">
                  WITHDRAWAL_REQUESTED
                </div>
                <div className="text-lime/80 mb-4">
                  {devMode
                    ? "DEV_MODE: NO_TIMELOCK // EXECUTES_IMMEDIATELY"
                    : "TIMELOCK_ACTIVE // AUTO_EXECUTE_WHEN_EXPIRED"}
                </div>
                {stealthAddr && (
                  <div className="mb-3">
                    <div className="text-xs text-lime/60 mb-1">
                      RECIPIENT_STEALTH:
                    </div>
                    <code className="text-xs break-all text-lime/80">
                      {stealthAddr}
                    </code>
                  </div>
                )}
                <div className="text-xs text-lime/60 mb-1">REQUEST_TX:</div>
                <code className="text-xs break-all text-lime">
                  {txSignature}
                </code>
                <div className="mt-4">
                  <button
                    onClick={() => {
                      setTxSignature(null);
                      setStealthAddr(null);
                    }}
                    className="border-2 border-lime text-lime px-4 py-2 text-sm font-mono font-bold hover:bg-lime hover:text-black transition-colors"
                  >
                    [DONE]
                  </button>
                </div>
              </div>
            </div>
          </div>

          <PendingSection
            pending={activePending}
            executed={executedRecently}
            now={now}
            formatCountdown={formatCountdown}
            onExecute={handleExecute}
            executingHash={executingHash}
            executeError={executeError}
            executeTx={executeTx}
          />
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
              [STEP_03_OF_03]
            </span>
          </div>
          <h1 className="font-mono font-black text-5xl lg:text-6xl mb-4">
            <span className="text-lime">[</span>
            <span className="text-white">WITHDRAW_WITH_ZK</span>
            <span className="text-lime">]</span>
          </h1>
          <p className="font-mono text-white/60">
            Generate ZK proof to withdraw to stealth address
          </p>
        </div>

        {/* Dev Mode */}
        <div className="border-2 border-yellow-500/50 p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-yellow-500 font-bold mb-1">
                DEV_MODE
              </div>
              <div className="font-mono text-xs text-white/60">
                Skip timelock delay
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
        </div>

        {/* Pending Withdrawals */}
        <PendingSection
          pending={activePending}
          executed={executedRecently}
          now={now}
          formatCountdown={formatCountdown}
          onExecute={handleExecute}
          executingHash={executingHash}
          executeError={executeError}
          executeTx={executeTx}
        />

        {availableDeposits.length === 0 ? (
          <div className="terminal-box flex items-center justify-center py-20">
            <div className="text-center">
              <div className="text-4xl text-red-500/20 mb-4">[ ! ]</div>
              <div className="font-mono text-white/40 mb-4">
                {">"} NO_DEPOSITS_AVAILABLE
              </div>
              <a href="/deposit" className="btn-terminal inline-block">
                [MAKE_DEPOSIT]
              </a>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Left - Deposit Selection */}
            <div className="space-y-6">
              <div className="terminal-box">
                <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                  <div className="w-3 h-3 bg-lime"></div>
                  <div className="w-3 h-3 bg-lime/50"></div>
                  <div className="w-3 h-3 bg-lime/20"></div>
                  <span className="ml-4 text-lime font-mono">
                    SELECT_DEPOSIT
                  </span>
                </div>
                <div className="space-y-2">
                  {availableDeposits.map((deposit, idx) => (
                    <button
                      key={deposit.id}
                      onClick={() => setSelectedDeposit(deposit)}
                      disabled={isWithdrawing}
                      className={`w-full text-left p-4 border-2 transition-all duration-200 font-mono text-sm ${
                        selectedDeposit?.id === deposit.id
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-lime/20 text-white/60 hover:border-lime/50"
                      } ${isWithdrawing ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="text-xs text-lime/60 mb-1">
                            DEPOSIT_0x
                            {idx.toString(16).toUpperCase().padStart(4, "0")} //
                            LEAF_#{deposit.leafIndex}
                          </div>
                          <div className="font-bold tabular-nums">
                            {deposit.amount / 1e9} SOL
                          </div>
                        </div>
                        {selectedDeposit?.id === deposit.id && (
                          <span className="text-lime">{">"} SELECTED</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Stealth toggle */}
              {selectedDeposit && (
                <div className="border-2 border-lime/20 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="font-mono text-white font-bold mb-1">
                        STEALTH_ADDRESS
                      </div>
                      <div className="font-mono text-xs text-white/60">
                        One-time address for maximum privacy
                      </div>
                    </div>
                    <button
                      onClick={() => setUseStealth(!useStealth)}
                      className={`border-2 px-4 py-2 font-mono font-bold text-sm transition-colors ${
                        useStealth
                          ? "border-lime bg-lime text-black"
                          : "border-lime/50 text-lime hover:bg-lime/10"
                      }`}
                    >
                      [{useStealth ? "ON" : "OFF"}]
                    </button>
                  </div>
                  {!useStealth && (
                    <div>
                      <label className="block font-mono text-xs text-lime/60 mb-2">
                        RECIPIENT_ADDRESS:
                      </label>
                      <input
                        type="text"
                        value={recipientAddress}
                        onChange={(e) => setRecipientAddress(e.target.value)}
                        placeholder={
                          publicKey?.toBase58() || "ENTER_SOLANA_ADDRESS"
                        }
                        className="w-full bg-black border-2 border-lime/30 px-4 py-2 font-mono text-sm text-white focus:border-lime focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right - Withdrawal Action */}
            <div>
              {selectedDeposit ? (
                <div className="space-y-6">
                  {/* Summary */}
                  <div className="terminal-box">
                    <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                      <div className="w-3 h-3 bg-lime"></div>
                      <div className="w-3 h-3 bg-lime/50"></div>
                      <div className="w-3 h-3 bg-lime/20"></div>
                      <span className="ml-4 text-lime font-mono">
                        WITHDRAWAL_INFO
                      </span>
                    </div>
                    <div className="space-y-2 text-sm font-mono">
                      <div className="flex justify-between">
                        <span className="text-white/60">AMOUNT:</span>
                        <span className="text-lime tabular-nums">
                          {selectedDeposit.amount / 1e9} SOL
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">FEE_0.5%:</span>
                        <span className="text-lime tabular-nums">
                          {(selectedDeposit.amount * 0.005) / 1e9} SOL
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">YOU_RECEIVE:</span>
                        <span className="text-lime tabular-nums">
                          {(selectedDeposit.amount * 0.995) / 1e9} SOL
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">RECIPIENT:</span>
                        <span className="text-lime">
                          {useStealth ? "STEALTH_ADDR" : "CUSTOM"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">TIMELOCK:</span>
                        <span
                          className={devMode ? "text-yellow-500" : "text-lime"}
                        >
                          {devMode ? "NONE" : "1-24_HRS"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Progress */}
                  {isWithdrawing && (
                    <div className="border-2 border-lime p-4">
                      <div className="font-mono text-sm text-lime mb-3">
                        {">"} {getStepMessage()}
                      </div>
                      <div className="h-2 bg-black border-2 border-lime/30 overflow-hidden mb-2">
                        <div
                          className="h-full bg-lime transition-all duration-300"
                          style={{ width: `${proofProgress}%` }}
                        ></div>
                      </div>
                      <div className="font-mono text-xs text-lime/60 tabular-nums">
                        PROGRESS: {proofProgress}%
                      </div>
                      <div className="mt-2 font-mono text-xs text-lime/40">
                        COMPUTING_0x
                        {Math.random().toString(16).substr(2, 8).toUpperCase()}
                        ...
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

                  {/* Withdraw button */}
                  <button
                    onClick={handleWithdraw}
                    disabled={isWithdrawing}
                    className="btn-terminal w-full text-lg"
                  >
                    {isWithdrawing
                      ? "[GENERATING_PROOF...]"
                      : "[EXECUTE_WITHDRAWAL]"}
                  </button>
                </div>
              ) : (
                <div className="terminal-box h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl text-lime/20 mb-4">[ ]</div>
                    <div className="font-mono text-white/40">
                      {">"} SELECT_DEPOSIT_TO_CONTINUE
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingSection({
  pending,
  executed,
  now,
  formatCountdown,
  onExecute,
  executingHash,
  executeError,
  executeTx,
}: any) {
  if (pending.length === 0 && executed.length === 0) return null;

  return (
    <div className="mb-8">
      {pending.length > 0 && (
        <div className="terminal-box mb-6">
          <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
            <div className="w-3 h-3 bg-yellow-500 animate-pulse"></div>
            <div className="w-3 h-3 bg-yellow-500/50"></div>
            <div className="w-3 h-3 bg-yellow-500/20"></div>
            <span className="ml-4 text-yellow-500 font-mono">
              PENDING_WITHDRAWALS
            </span>
          </div>
          <div className="space-y-3">
            {pending.map((pw: any, _: number) => {
              const countdown = formatCountdown(pw.executeAfter);
              const ready = countdown === null;
              return (
                <div
                  key={pw.nullifierHash}
                  className="border-2 border-lime/20 p-4"
                >
                  <div className="flex justify-between items-center mb-2 font-mono text-sm">
                    <span className="text-white font-bold tabular-nums">
                      {pw.amount / 1e9} SOL
                    </span>
                    {ready ? (
                      <span className="text-lime text-xs">[READY]</span>
                    ) : (
                      <span className="text-yellow-500 text-xs tabular-nums">
                        ⏱ {countdown}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-white/40 mb-3 break-all">
                    {">"} {pw.recipient}
                  </div>
                  {ready ? (
                    <button
                      onClick={() => onExecute(pw.nullifierHash)}
                      disabled={executingHash === pw.nullifierHash}
                      className="btn-terminal w-full text-sm"
                    >
                      {executingHash === pw.nullifierHash
                        ? "[EXECUTING...]"
                        : "[EXECUTE_NOW]"}
                    </button>
                  ) : (
                    <div className="h-1 bg-black border border-lime/30 overflow-hidden">
                      <div
                        className="h-full bg-lime/40 transition-all duration-1000"
                        style={{
                          width: `${Math.max(0, Math.min(100, ((now - (pw.executeAfter - 86400)) / 86400) * 100))}%`,
                        }}
                      ></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {executeError && (
            <div className="mt-4 border-2 border-red-500 bg-red-500/10 p-3">
              <div className="font-mono text-sm text-red-400">
                {">"} {executeError}
              </div>
            </div>
          )}
          {executeTx && (
            <div className="mt-4 border-2 border-lime bg-lime/10 p-3">
              <div className="font-mono text-sm text-lime">
                {">"} WITHDRAWAL_EXECUTED
              </div>
              <code className="text-xs break-all text-lime/80">
                {executeTx}
              </code>
            </div>
          )}

          <div className="mt-4 text-xs font-mono text-white/40">
            {">"} AUTO_EXECUTE_EVERY_30S_WHEN_TIMELOCK_EXPIRES
          </div>
        </div>
      )}
    </div>
  );
}
