import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  server: {
    port: 3000,
  },
  publicDir: "public",
  plugins: [
    nodePolyfills({
      include: ["buffer", "process"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
    cloudflare({
      viteEnvironment: {
        name: "ssr",
      },
    }),
  ],

  optimizeDeps: {
    include: ["buffer", "@solana/web3.js", "circomlibjs", "snarkjs"],
    esbuildOptions: {
      target: "esnext",
    },
  },
});
