import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function WalletConnect() {
  const { connected, publicKey, disconnect } = useWallet();

  return (
    <div className="flex items-center gap-4">
      <WalletMultiButton />

      {connected && publicKey && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-mono">
            {publicKey.toBase58().slice(0, 4)}...
            {publicKey.toBase58().slice(-4)}
          </span>
          <button
            onClick={disconnect}
            className="text-red-500 hover:text-red-700"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
