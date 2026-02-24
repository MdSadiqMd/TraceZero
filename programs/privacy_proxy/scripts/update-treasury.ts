import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PrivacyProxy } from "../target/types/privacy_proxy";
import {
  PublicKey,
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

async function main() {
  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  console.log("RPC:", rpcUrl);

  const keypairPath = path.join(os.homedir(), ".config/solana/id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log("Wallet:", wallet.publicKey.toString());

  // Create provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load program
  const programId = new PublicKey(
    "Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3"
  );

  // Try multiple possible paths for the IDL file
  let idlPath = "./target/idl/privacy_proxy.json";
  if (!fs.existsSync(idlPath)) {
    idlPath = "./programs/privacy_proxy/target/idl/privacy_proxy.json";
  }
  if (!fs.existsSync(idlPath)) {
    idlPath = "../target/idl/privacy_proxy.json";
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider) as Program<PrivacyProxy>;

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  console.log("Config PDA:", configPda.toString());

  // Derive new treasury PDA
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    programId
  );
  console.log("New Treasury PDA:", treasuryPda.toString());

  // Update config
  console.log("Updating config with new treasury PDA...");
  const tx = await program.methods
    .updateConfig({
      relayerTreasury: treasuryPda,
      authorizedRelayer: null,
      feeBps: null,
      paused: null,
    })
    .accounts({
      admin: wallet.publicKey,
    })
    .rpc();

  console.log("Config updated:", tx);
  console.log("\n✓ Treasury PDA updated successfully!");
  console.log("New treasury:", treasuryPda.toString());
}

main().catch(console.error);
