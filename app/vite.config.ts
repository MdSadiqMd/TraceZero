import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  server: {
    port: 3000,
  },
  publicDir: "public",
  plugins: [
    nodePolyfills({
      include: ["buffer", "process", "stream"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
  ],
  optimizeDeps: {
    include: ["buffer", "@solana/web3.js", "circomlibjs", "snarkjs"],
    esbuildOptions: {
      target: "esnext",
    },
  },
});
