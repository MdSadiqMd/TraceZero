import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useClaim } from "@/hooks/useClaim";

export const Route = createFileRoute("/claim")({
  component: ClaimPage,
});

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

  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (publicKey && destination === "") {
      setDestination(publicKey.toBase58());
    }
  }, [publicKey]);

  const handleClaim = async (stealthAddress: string) => {
    if (!destination) {
      setClaimError("DESTINATION_ADDRESS_REQUIRED");
      return;
    }

    const confirmed = confirm(`SWEEP_FUNDS_TO:\n${destination}\n\nCONFIRM?`);
    if (!confirmed) return;

    setClaimError(null);
    try {
      const sig = await claim(stealthAddress, destination);
      setClaimTx((prev) => ({ ...prev, [stealthAddress]: sig }));
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "CLAIM_FAILED");
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
      setImportResult(`IMPORTED_${count}_KEYS`);
      setImportText("");
      refresh();
    } catch {
      setImportResult("INVALID_BACKUP_FILE");
    }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const count = importKeys(reader.result as string);
        setImportResult(`IMPORTED_${count}_KEYS`);
        refresh();
      } catch {
        setImportResult("INVALID_BACKUP_FILE");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-black text-white py-12 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="inline-block border-2 border-lime px-4 py-2 mb-6">
            <span className="font-mono text-lime text-sm font-bold">
              [FINAL_STEP]
            </span>
          </div>
          <h1 className="font-mono font-black text-5xl lg:text-6xl mb-4">
            <span className="text-lime">[</span>
            <span className="text-white">CLAIM_FUNDS</span>
            <span className="text-lime">]</span>
          </h1>
          <p className="font-mono text-white/60">
            Sweep funds from stealth addresses to any wallet
          </p>
        </div>

        {/* Warning */}
        <div className="border-2 border-yellow-500 bg-yellow-500/10 p-6 mb-8">
          <div className="flex items-start gap-3">
            <span className="text-yellow-500 text-2xl">⚠</span>
            <div className="font-mono text-sm">
              <div className="text-yellow-500 font-bold mb-2">WARNING:</div>
              <div className="text-yellow-400/80">
                {">"} STEALTH_KEYS_STORED_IN_BROWSER_LOCALSTORAGE
              </div>
              <div className="text-yellow-400/80">
                {">"} DO_NOT_CLEAR_LOCALSTORAGE_BEFORE_CLAIMING
              </div>
              <div className="text-yellow-400/80">
                {">"} USE_BACKUP_BUTTON_TO_EXPORT_KEYS
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left - Destination & Balances */}
          <div className="space-y-6">
            {/* Destination */}
            <div className="terminal-box">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                <div className="w-3 h-3 bg-lime"></div>
                <div className="w-3 h-3 bg-lime/50"></div>
                <div className="w-3 h-3 bg-lime/20"></div>
                <span className="ml-4 text-lime font-mono">
                  DESTINATION_WALLET
                </span>
              </div>
              <div>
                <label className="block font-mono text-xs text-lime/60 mb-2">
                  ADDRESS:
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="ENTER_SOLANA_ADDRESS"
                  className="w-full bg-black border-2 border-lime/30 px-4 py-3 font-mono text-sm text-white focus:border-lime focus:outline-none mb-2"
                />
                <div className="text-xs font-mono text-white/40">
                  {publicKey
                    ? "{'>'} DEFAULTS_TO_CONNECTED_WALLET"
                    : "{'>'} CONNECT_WALLET_OR_PASTE_ADDRESS"}
                </div>
                {destination && (
                  <div className="mt-3 border-2 border-lime/30 p-3">
                    <div className="text-xs font-mono text-lime/60 mb-1">
                      FUNDS_WILL_BE_SENT_TO:
                    </div>
                    <code className="text-xs break-all text-lime">
                      {destination}
                    </code>
                  </div>
                )}
              </div>
            </div>

            {/* Stealth Balances */}
            <div className="terminal-box">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                <div className="w-3 h-3 bg-lime"></div>
                <div className="w-3 h-3 bg-lime/50"></div>
                <div className="w-3 h-3 bg-lime/20"></div>
                <span className="ml-4 text-lime font-mono">
                  STEALTH_BALANCES
                </span>
                <button
                  onClick={refresh}
                  disabled={loading}
                  className="ml-auto text-xs font-mono text-lime/60 hover:text-lime"
                >
                  [{loading ? "LOADING..." : "REFRESH"}]
                </button>
              </div>

              {entries.length === 0 && !loading && (
                <div className="text-center py-12">
                  <div className="text-4xl text-white/10 mb-4">[ ]</div>
                  <div className="font-mono text-sm text-white/40">
                    {">"} NO_STEALTH_ADDRESSES_FOUND
                  </div>
                  <div className="font-mono text-xs text-white/30 mt-2">
                    {">"} MAKE_WITHDRAWAL_FIRST
                  </div>
                </div>
              )}

              {error && (
                <div className="border-2 border-red-500 bg-red-500/10 p-3 mb-4">
                  <div className="font-mono text-sm text-red-400">
                    {">"} {error}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {entries.map((entry, idx) => {
                  const txSig = claimTx[entry.stealthAddress];
                  return (
                    <div
                      key={entry.stealthAddress}
                      className="border-2 border-lime/20 p-4"
                    >
                      <div className="flex justify-between items-center mb-2 font-mono text-sm">
                        <span className="text-white font-bold tabular-nums">
                          {entry.amount / 1e9} SOL
                        </span>
                        <span
                          className={`text-xs ${entry.balance > 0 ? "text-lime" : "text-white/40"}`}
                        >
                          {entry.balance > 0
                            ? `[${(entry.balance / 1e9).toFixed(4)}_SOL]`
                            : "[EMPTY]"}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-white/40 mb-2 break-all">
                        STEALTH_0x
                        {idx.toString(16).toUpperCase().padStart(4, "0")}:{" "}
                        {entry.stealthAddress}
                      </div>
                      <div className="text-xs font-mono text-white/30 mb-3">
                        EXPECTED: ~{((entry.amount * 0.995) / 1e9).toFixed(4)}{" "}
                        SOL
                      </div>

                      {txSig ? (
                        <div className="border-2 border-lime bg-lime/10 p-3">
                          <div className="font-mono text-xs text-lime mb-1">
                            {">"} SWEPT_TO: {destination.slice(0, 8)}...
                            {destination.slice(-8)}
                          </div>
                          <code className="text-xs break-all text-lime/80">
                            {txSig}
                          </code>
                        </div>
                      ) : entry.balance > 0 ? (
                        <button
                          onClick={() => handleClaim(entry.stealthAddress)}
                          disabled={
                            claiming === entry.stealthAddress || !destination
                          }
                          className="btn-terminal w-full text-sm"
                        >
                          {claiming === entry.stealthAddress
                            ? "[SWEEPING...]"
                            : "[CLAIM_TO_DESTINATION]"}
                        </button>
                      ) : (
                        <div className="text-center py-3 border-2 border-white/10">
                          <div className="text-xs font-mono text-white/40 mb-1">
                            {">"} WAITING_FOR_EXECUTE_WITHDRAWAL...
                          </div>
                          <div className="text-xs font-mono text-white/30">
                            AUTO_REFRESH_EVERY_10S
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {claimError && (
                <div className="mt-4 border-2 border-red-500 bg-red-500/10 p-3">
                  <div className="font-mono text-sm text-red-400">
                    {">"} {claimError}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right - Key Backup */}
          <div>
            <div className="terminal-box">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                <div className="w-3 h-3 bg-lime"></div>
                <div className="w-3 h-3 bg-lime/50"></div>
                <div className="w-3 h-3 bg-lime/20"></div>
                <span className="ml-4 text-lime font-mono">KEY_BACKUP</span>
                <button
                  onClick={() => setShowBackup(!showBackup)}
                  className="ml-auto text-xs font-mono text-lime/60 hover:text-lime"
                >
                  [{showBackup ? "HIDE" : "SHOW"}]
                </button>
              </div>

              {showBackup && (
                <div className="space-y-4">
                  {/* Export */}
                  <div>
                    <div className="text-xs font-mono text-lime/60 mb-2">
                      EXPORT_KEYS:
                    </div>
                    <button
                      onClick={handleExport}
                      className="border-2 border-lime text-lime px-4 py-2 font-mono font-bold text-sm hover:bg-lime hover:text-black transition-colors w-full"
                    >
                      [EXPORT_TO_JSON]
                    </button>
                  </div>

                  {/* Import from file */}
                  <div>
                    <div className="text-xs font-mono text-lime/60 mb-2">
                      IMPORT_FROM_FILE:
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleFileImport}
                      className="block w-full text-xs font-mono text-white/60 file:mr-4 file:py-2 file:px-4 file:border-2 file:border-lime/30 file:text-xs file:bg-black file:text-lime file:font-mono file:font-bold hover:file:bg-lime hover:file:text-black file:transition-colors"
                    />
                  </div>

                  {/* Import from text */}
                  <div>
                    <div className="text-xs font-mono text-lime/60 mb-2">
                      OR_PASTE_JSON:
                    </div>
                    <textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      rows={4}
                      className="w-full bg-black border-2 border-lime/30 px-3 py-2 font-mono text-xs text-white focus:border-lime focus:outline-none mb-2"
                      placeholder="PASTE_EXPORTED_JSON_HERE..."
                    />
                    <button
                      onClick={handleImport}
                      disabled={!importText}
                      className="border-2 border-lime text-lime px-4 py-2 font-mono font-bold text-sm hover:bg-lime hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      [IMPORT]
                    </button>
                  </div>

                  {importResult && (
                    <div
                      className={`border-2 p-3 ${importResult.includes("INVALID") ? "border-red-500 bg-red-500/10" : "border-lime bg-lime/10"}`}
                    >
                      <div
                        className={`font-mono text-sm ${importResult.includes("INVALID") ? "text-red-400" : "text-lime"}`}
                      >
                        {">"} {importResult}
                      </div>
                    </div>
                  )}

                  {/* Clear keys */}
                  <div className="pt-4 border-t-2 border-lime/10">
                    <div className="text-xs font-mono text-white/40 mb-3">
                      {">"} CLEAR_ALL_STEALTH_KEYS:
                    </div>
                    <div className="text-xs font-mono text-white/30 mb-2">
                      USE_IF_YOU_HAVE_OLD_KEYS_FROM_BEFORE_BN254_FIX
                    </div>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            "CONFIRM_DELETE_ALL_STEALTH_KEYS?\n\nMAKE_SURE_YOU_EXPORTED_THEM_FIRST",
                          )
                        ) {
                          clearKeys();
                          refresh();
                          setImportResult("ALL_STEALTH_KEYS_CLEARED");
                        }
                      }}
                      className="border-2 border-red-500 text-red-500 px-4 py-2 font-mono font-bold text-sm hover:bg-red-500 hover:text-black transition-colors w-full"
                    >
                      [CLEAR_ALL_KEYS]
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="border-2 border-lime/20 p-6 mt-6">
              <div className="text-xs text-lime/60 font-mono mb-3">
                CLAIM_INFO:
              </div>
              <div className="space-y-2 text-sm text-white/60 font-mono">
                <div className="flex gap-2">
                  <span className="text-lime">{">"}</span>
                  <span>Plain SOL transfer, no ZK proof needed</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-lime">{">"}</span>
                  <span>No relayer or Tor required</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-lime">{">"}</span>
                  <span>Direct sweep from stealth to destination</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
