import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useClaim } from "@/hooks/useClaim";

export const Route = createFileRoute("/claim")({
  component: ClaimPage,
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

function ClaimPage() {
  const { publicKey } = useWallet();
  const {
    entries,
    loading,
    claiming,
    error,
    refresh,
    claim,
    exportKeys,
    importKeys,
    clearKeys,
  } = useClaim();
  const [destination, setDestination] = useState("");
  const [claimTx, setClaimTx] = useState<Record<string, string>>({});
  const [claimError, setClaimError] = useState<string | null>(null);
  const [showBackup, setShowBackup] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh every 10 seconds to catch balance updates after execution
  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);
  // Only set destination from wallet on initial load, not on every render
  useEffect(() => {
    if (publicKey && destination === "") {
      setDestination(publicKey.toBase58());
    }
  }, [publicKey]); // Remove destination from deps to avoid overwriting user input

  const handleClaim = async (stealthAddress: string) => {
    if (!destination) {
      setClaimError("Enter a destination address");
      return;
    }

    // Confirm destination before claiming
    const confirmed = confirm(
      `Send funds to:\n${destination}\n\nIs this correct?`,
    );
    if (!confirmed) return;

    setClaimError(null);
    try {
      const sig = await claim(stealthAddress, destination);
      setClaimTx((prev) => ({ ...prev, [stealthAddress]: sig }));
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Claim failed");
    }
  };

  const handleExport = () => {
    const data = exportKeys();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stealth-keys-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    try {
      const count = importKeys(importText);
      setImportResult(`Imported ${count} new stealth key(s)`);
      setImportText("");
      refresh();
    } catch {
      setImportResult("Invalid backup file");
    }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const count = importKeys(reader.result as string);
        setImportResult(`Imported ${count} new stealth key(s)`);
        refresh();
      } catch {
        setImportResult("Invalid backup file");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Claim Funds</h1>
      <p className="text-gray-400 mb-8">
        Sweep funds from stealth addresses to any wallet. This is a plain SOL
        transfer — no ZK proof, no relayer, no Tor needed.
      </p>

      {/* Warning */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-400">
          ⚠️ Stealth keys are stored in your browser. Do NOT clear localStorage
          before claiming. Use the backup button below to export your keys.
        </p>
      </div>

      {/* Destination */}
      <div className="card mb-6">
        <label className="block text-sm font-medium mb-2">
          Destination Wallet
        </label>
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Enter Solana address to receive funds"
          className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:border-primary-500 focus:outline-none"
        />
        <p className="text-xs text-gray-500 mt-1">
          {publicKey
            ? "Defaults to your connected wallet"
            : "Connect wallet or paste any address"}
        </p>
        {destination && (
          <div className="mt-2 p-2 rounded bg-primary-500/10 border border-primary-500/30">
            <p className="text-xs text-primary-400">
              ⚠️ Funds will be sent to:{" "}
              <span className="font-mono">{destination}</span>
            </p>
          </div>
        )}
      </div>

      {/* Claimable entries */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Stealth Balances</h2>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-sm text-primary-400 hover:text-primary-300"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {entries.length === 0 && !loading && (
          <p className="text-gray-500 text-center py-8">
            No unclaimed stealth addresses. Make a withdrawal first.
          </p>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          {entries.map((entry) => {
            const txSig = claimTx[entry.stealthAddress];
            return (
              <div
                key={entry.stealthAddress}
                className="p-4 rounded-lg bg-gray-800/60 border border-gray-700/50"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold">
                    {entry.amount / 1e9} SOL
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      entry.balance > 0
                        ? "bg-green-500/20 text-green-400"
                        : "bg-gray-700 text-gray-400"
                    }`}
                  >
                    {entry.balance > 0
                      ? `${(entry.balance / 1e9).toFixed(4)} SOL on-chain`
                      : "Empty (0 SOL)"}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mb-1 break-all">
                  Stealth: {entry.stealthAddress}
                </div>
                <div className="text-xs text-gray-600 mb-1">
                  Expected: ~{((entry.amount * 0.995) / 1e9).toFixed(4)} SOL
                  (after 0.5% fee)
                </div>
                <div className="text-xs text-gray-600 mb-3">
                  Created: {new Date(entry.createdAt).toLocaleString()}
                </div>

                {txSig ? (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                    <p className="text-sm text-green-400 mb-1">
                      ✓ Swept to: {destination.slice(0, 8)}...
                      {destination.slice(-8)}
                    </p>
                    <code className="text-xs break-all text-green-300/80">
                      {txSig}
                    </code>
                    <TxLinks sig={txSig} />
                  </div>
                ) : entry.balance > 0 ? (
                  <button
                    onClick={() => handleClaim(entry.stealthAddress)}
                    disabled={claiming === entry.stealthAddress || !destination}
                    className="btn-primary w-full text-sm py-2"
                  >
                    {claiming === entry.stealthAddress
                      ? "Sweeping..."
                      : "Claim → Destination"}
                  </button>
                ) : (
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-2">
                      Waiting for execute_withdrawal to complete...
                    </p>
                    <p className="text-xs text-gray-600">
                      Check the Withdraw page for execution status. Balance
                      auto-refreshes every 10s.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {claimError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mt-3">
            <p className="text-sm text-red-400">{claimError}</p>
          </div>
        )}
      </div>

      {/* Backup / Import */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Key Backup</h2>
          <button
            onClick={() => setShowBackup(!showBackup)}
            className="text-sm text-primary-400 hover:text-primary-300"
          >
            {showBackup ? "Hide" : "Show"}
          </button>
        </div>

        {showBackup && (
          <div className="space-y-3">
            <button
              onClick={handleExport}
              className="btn-secondary w-full text-sm"
            >
              Export Stealth Keys (JSON)
            </button>

            <div>
              <label className="block text-sm font-medium mb-1">
                Import from file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileImport}
                className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-gray-700 file:text-gray-300 hover:file:bg-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Or paste JSON
              </label>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm focus:border-primary-500 focus:outline-none"
                placeholder="Paste exported JSON here..."
              />
              <button
                onClick={handleImport}
                disabled={!importText}
                className="btn-secondary text-sm mt-1"
              >
                Import
              </button>
            </div>

            {importResult && (
              <p className="text-sm text-primary-400">{importResult}</p>
            )}

            <div className="border-t border-gray-700 pt-3 mt-3">
              <p className="text-xs text-gray-500 mb-2">
                Clear all stealth keys (use if you have old keys from before the
                BN254 fix):
              </p>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "Are you sure? This will delete all stealth keys. Make sure you have exported them first if needed.",
                    )
                  ) {
                    clearKeys();
                    refresh();
                    setImportResult("All stealth keys cleared");
                  }
                }}
                className="btn-secondary w-full text-sm text-red-400 border-red-500/30 hover:bg-red-500/10"
              >
                Clear All Stealth Keys
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
