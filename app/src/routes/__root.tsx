/// <reference types="vite/client" />
import type { ReactNode } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { SolanaProvider } from "@/components/SolanaProvider";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import "@/styles/globals.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Privacy Proxy - Anonymous Solana Transactions" },
      {
        name: "description",
        content:
          "ZK-powered private transactions on Solana with complete sender untraceability",
      },
    ],
    links: [{ rel: "icon", href: "/favicon.ico" }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <SolanaProvider>
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 container mx-auto px-4 py-8">
            <Outlet />
          </main>
          <Footer />
        </div>
      </SolanaProvider>
    </RootDocument>
  );
}

function Header() {
  return (
    <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold text-primary-400">
          Privacy Proxy
        </Link>
        <nav className="flex items-center gap-6">
          <Link
            to="/credits"
            className="text-gray-400 hover:text-white transition-colors [&.active]:text-primary-400"
          >
            Credits
          </Link>
          <Link
            to="/deposit"
            className="text-gray-400 hover:text-white transition-colors [&.active]:text-primary-400"
          >
            Deposit
          </Link>
          <Link
            to="/withdraw"
            className="text-gray-400 hover:text-white transition-colors [&.active]:text-primary-400"
          >
            Withdraw
          </Link>
          <Link
            to="/claim"
            className="text-gray-400 hover:text-white transition-colors [&.active]:text-primary-400"
          >
            Claim
          </Link>
          <WalletMultiButton />
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-800 py-6">
      <div className="container mx-auto px-4 text-center text-gray-500 text-sm">
        <p>Privacy Proxy - ZK-powered anonymous transactions on Solana</p>
        <p className="mt-2">
          All transactions routed through Tor for complete privacy
        </p>
      </div>
    </footer>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
