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

const EXPLORER_BASE = "https://explorer.solana.com/tx";
const SOLSCAN_BASE = "https://solscan.io/tx";

function explorerUrl(sig: string) {
  return `${EXPLORER_BASE}/${sig}?cluster=devnet`;
}

function solscanUrl(sig: string) {
  return `${SOLSCAN_BASE}/${sig}?cluster=devnet`;
}

function TxLinks({ sig }: { sig: string }) {
  return (
    <div className="flex gap-3 text-xs mt-2">
      <a
        href={explorerUrl(sig)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-400 hover:underline"
      >
        Solana Explorer ↗
      </a>
      <a
        href={solscanUrl(sig)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-400 hover:underline"
      >
        Solscan ↗
      </a>
    </div>
  );
}

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
    } catch {
      /* relayer might not be up */
    }
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
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const getStepLabel = () => {
    switch (step) {
      case "generating-stealth":
        return "Generating stealth address...";
      case "fetching-proof":
        return "Fetching Merkle proof...";
      case "verifying-proof":
        return "Verifying Merkle proof...";
      case "generating-zk-proof":
        return `Generating ZK proof... ${proofProgress}%`;
      case "submitting":
        return "Submitting withdrawal request...";
      default:
        return "";
    }
  };

  const activePending = pendingWithdrawals.filter((p) => !p.executed);
  const executedRecently = pendingWithdrawals.filter((p) => p.executed);

  // ── Success view after requesting withdrawal ──
  if (txSignature) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Withdraw</h1>
        <p className="text-gray-400 mb-8">
          Withdraw funds using a ZK proof. Your identity remains completely
          hidden.
        </p>

        <div className="card mb-6 bg-green-500/10 border-green-500/30">
          <div className="text-green-400 text-lg font-semibold mb-3">
            ✓ Withdrawal Requested
          </div>
          <p className="text-sm text-gray-300 mb-4">
            {devMode
              ? "Dev mode: no timelock. The relayer will execute immediately (within 30s)."
              : "Your withdrawal is pending with a timelock delay. The relayer will auto-execute once it expires."}
          </p>

          {stealthAddr && (
            <div className="mb-3">
              <div className="text-xs text-gray-500 mb-1">
                Recipient (stealth address):
              </div>
              <code className="text-xs break-all text-gray-300">
                {stealthAddr}
              </code>
            </div>
          )}

          <div className="text-xs text-gray-500 mb-1">Request tx:</div>
          <code className="text-xs break-all text-green-300/80">
            {txSignature}
          </code>
          <TxLinks sig={txSignature} />

          <div className="mt-4">
            <button
              onClick={() => {
                setTxSignature(null);
                setStealthAddr(null);
              }}
              className="btn-secondary text-sm"
            >
              Done
            </button>
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
    );
  }

  // ── Main withdraw form ──
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Withdraw</h1>
      <p className="text-gray-400 mb-8">
        Withdraw funds using a ZK proof. Your identity remains completely
        hidden.
      </p>

      {/* Dev Mode Toggle */}
      <div className="card mb-6 border-yellow-500/30">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-yellow-400">🧪 Dev Mode</h2>
            <p className="text-sm text-gray-500">
              Skip timelock delay — withdrawal executes immediately
            </p>
          </div>
          <button
            onClick={() => setDevMode(!devMode)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              devMode
                ? "bg-yellow-500 text-black"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {devMode ? "ON" : "OFF"}
          </button>
        </div>
        {devMode && (
          <p className="text-xs text-yellow-400 mt-2">
            ⚠️ Timelock set to 0 hours. Withdrawal can be executed immediately
            after request.
          </p>
        )}
      </div>

      {/* Pending withdrawals */}
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

      {!connected ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 mb-4">Connect your wallet to withdraw</p>
        </div>
      ) : availableDeposits.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 mb-4">
            No deposits available to withdraw
          </p>
          <a href="/deposit" className="btn-primary">
            Make a Deposit
          </a>
        </div>
      ) : (
        <>
          {/* Deposit Selection */}
          <div className="card mb-6">
            <h2 className="text-xl font-semibold mb-4">Select Deposit</h2>
            <div className="space-y-3">
              {availableDeposits.map((deposit) => (
                <button
                  key={deposit.id}
                  onClick={() => setSelectedDeposit(deposit)}
                  className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                    selectedDeposit?.id === deposit.id
                      ? "border-primary-500 bg-primary-500/10"
                      : "border-gray-700 hover:border-gray-600"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-semibold">
                        {deposit.amount / 1e9} SOL
                      </div>
                      <div className="text-sm text-gray-500">
                        Leaf #{deposit.leafIndex} •{" "}
                        {new Date(deposit.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-primary-400">
                      {selectedDeposit?.id === deposit.id
                        ? "✓ Selected"
                        : "Select"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Withdrawal Options */}
          {selectedDeposit && (
            <div className="card mb-6">
              <h2 className="text-xl font-semibold mb-4">Withdrawal Options</h2>

              {/* Stealth Address Toggle */}
              <div className="flex items-center justify-between mb-4 p-3 rounded-lg bg-gray-800">
                <div>
                  <div className="font-medium">Use Stealth Address</div>
                  <div className="text-sm text-gray-500">
                    Generate a one-time address for maximum privacy
                  </div>
                </div>
                <button
                  onClick={() => setUseStealth(!useStealth)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    useStealth ? "bg-primary-500" : "bg-gray-600"
                  }`}
                  aria-label="Toggle stealth address"
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      useStealth ? "translate-x-6" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Recipient Address (only when stealth is off) */}
              {!useStealth && (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">
                    Recipient Address
                  </label>
                  <input
                    type="text"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder={
                      publicKey?.toBase58() || "Enter Solana address"
                    }
                    className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:border-primary-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Leave empty to use your connected wallet
                  </p>
                </div>
              )}

              {/* Summary */}
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-gray-400">Amount</span>
                  <span>{selectedDeposit.amount / 1e9} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Fee (0.5%)</span>
                  <span>{(selectedDeposit.amount * 0.005) / 1e9} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">You receive</span>
                  <span className="text-green-400">
                    {(selectedDeposit.amount * 0.995) / 1e9} SOL
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Recipient</span>
                  <span className="text-green-400">
                    {useStealth
                      ? "Stealth (auto-generated)"
                      : recipientAddress || "Connected wallet"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Timelock</span>
                  <span
                    className={devMode ? "text-yellow-400" : "text-gray-300"}
                  >
                    {devMode ? "None (dev mode)" : "1-24 hours (random)"}
                  </span>
                </div>
              </div>

              {/* Info */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
                <p className="text-sm text-blue-400">
                  ℹ️ Proof generation takes 30-60s.{" "}
                  {devMode
                    ? "Dev mode: withdrawal will execute immediately after."
                    : "After that, a timelock delay applies before funds are released."}
                </p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              {isWithdrawing && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">{getStepLabel()}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 transition-all duration-300"
                      style={{ width: `${proofProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleWithdraw}
                disabled={isWithdrawing}
                className="btn-primary w-full"
              >
                {isWithdrawing ? "Processing..." : "Withdraw Now"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Pending Withdrawals Section ─────────────────────────────────────────────

function PendingSection({
  pending,
  executed,
  now,
  formatCountdown,
  onExecute,
  executingHash,
  executeError,
  executeTx,
}: {
  pending: PendingWithdrawalInfo[];
  executed: PendingWithdrawalInfo[];
  now: number;
  formatCountdown: (t: number) => string | null;
  onExecute: (hash: string) => void;
  executingHash: string | null;
  executeError: string | null;
  executeTx: string | null;
}) {
  if (pending.length === 0 && executed.length === 0) return null;

  return (
    <>
      {pending.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold mb-4">Pending Withdrawals</h2>
          <div className="space-y-3">
            {pending.map((pw) => {
              const countdown = formatCountdown(pw.executeAfter);
              const ready = countdown === null;
              return (
                <div
                  key={pw.nullifierHash}
                  className="p-4 rounded-lg bg-gray-800/60 border border-gray-700/50"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold">{pw.amount / 1e9} SOL</span>
                    {ready ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                        Ready
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-gray-400">
                        ⏱ {countdown}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mb-1 break-all">
                    → {pw.recipient}
                  </div>
                  <div className="text-xs text-gray-600 mb-3">
                    Fee: {pw.fee / 1e9} SOL · Bucket #{pw.bucketId}
                  </div>
                  {ready ? (
                    <button
                      onClick={() => onExecute(pw.nullifierHash)}
                      disabled={executingHash === pw.nullifierHash}
                      className="btn-primary w-full text-sm py-2"
                    >
                      {executingHash === pw.nullifierHash
                        ? "Executing..."
                        : "Execute Now"}
                    </button>
                  ) : (
                    <div className="w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-primary-500/40 transition-all duration-1000"
                        style={{
                          width: `${Math.max(0, Math.min(100, ((now - (pw.executeAfter - 86400)) / 86400) * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {executeError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mt-3">
              <p className="text-sm text-red-400">{executeError}</p>
            </div>
          )}
          {executeTx && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mt-3">
              <p className="text-sm text-green-400 mb-1">
                ✓ Withdrawal executed
              </p>
              <code className="text-xs break-all text-green-300/80">
                {executeTx}
              </code>
              <TxLinks sig={executeTx} />
            </div>
          )}

          <p className="text-xs text-gray-600 mt-3">
            The relayer auto-executes every 30s when timelocks expire. You can
            also trigger manually.
          </p>
        </div>
      )}

      {executed.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold mb-3 text-green-400/80">
            Completed
          </h2>
          <div className="space-y-2">
            {executed.slice(0, 5).map((pw) => (
              <div
                key={pw.nullifierHash}
                className="flex justify-between items-center text-sm p-2 rounded bg-gray-800/30"
              >
                <span className="text-gray-400">
                  {pw.amount / 1e9} SOL → {pw.recipient.slice(0, 12)}...
                </span>
                <span className="text-green-500 text-xs">✓</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
