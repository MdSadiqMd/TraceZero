import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PrivacyProxy } from "../target/types/privacy_proxy";
import {
  PublicKey,
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
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

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

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
  const idl = JSON.parse(
    fs.readFileSync(
      "./programs/privacy_proxy/target/idl/privacy_proxy.json",
      "utf-8"
    )
  );
  const program = new Program(idl, provider) as Program<PrivacyProxy>;

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  console.log("Config PDA:", configPda.toString());

  // Check if already initialized
  try {
    const config = await program.account.globalConfig.fetch(configPda);
    console.log("Protocol already initialized!");
    console.log("Admin:", config.admin.toString());
    console.log("Relayer:", config.authorizedRelayer.toString());
    return;
  } catch (e) {
    console.log("Protocol not initialized, initializing...");
  }

  // Generate relayer treasury PDA
  const [relayerTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    programId
  );

  // RSA public key placeholders (will be replaced by actual relayer key)
  const relayerSigningKeyN = new Array(256).fill(1);
  const relayerSigningKeyE = [1, 0, 1, 0];

  // Initialize protocol
  console.log("Initializing protocol...");
  const tx = await program.methods
    .initialize({
      relayerTreasury: relayerTreasuryPda,
      authorizedRelayer: wallet.publicKey, // Use same wallet as relayer for testing
      relayerSigningKeyN: relayerSigningKeyN,
      relayerSigningKeyE: relayerSigningKeyE,
      feeBps: 50,
    })
    .accounts({
      admin: wallet.publicKey,
    })
    .rpc();

  console.log("Initialize tx:", tx);

  // Initialize pools for each bucket
  const bucketAmounts = [
    100_000_000, // 0.1 SOL
    500_000_000, // 0.5 SOL
    1_000_000_000, // 1 SOL
    5_000_000_000, // 5 SOL
    10_000_000_000, // 10 SOL
    50_000_000_000, // 50 SOL
    100_000_000_000, // 100 SOL
  ];

  for (let bucketId = 0; bucketId < bucketAmounts.length; bucketId++) {
    console.log(
      `Initializing pool ${bucketId} (${
        bucketAmounts[bucketId] / LAMPORTS_PER_SOL
      } SOL)...`
    );

    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), Buffer.from([bucketId])],
      programId
    );

    const [historicalRootsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("historical_roots"), poolPda.toBuffer(), Buffer.from([0])],
      programId
    );

    try {
      const poolTx = await program.methods
        .initPool(bucketId)
        .accounts({
          admin: wallet.publicKey,
          pool: poolPda,
          historicalRoots: historicalRootsPda,
        })
        .rpc();

      console.log(`Pool ${bucketId} initialized: ${poolTx}`);

      // Fund the pool with the bucket amount
      console.log(
        `Funding pool ${bucketId} with ${
          bucketAmounts[bucketId] / LAMPORTS_PER_SOL
        } SOL...`
      );
      const fundTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: poolPda,
          lamports: bucketAmounts[bucketId],
        })
      );
      await sendAndConfirmTransaction(connection, fundTx, [wallet]);
      console.log(`Pool ${bucketId} funded`);
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        console.log(`Pool ${bucketId} already initialized`);
        // Still try to fund it
        try {
          console.log(
            `Funding pool ${bucketId} with ${
              bucketAmounts[bucketId] / LAMPORTS_PER_SOL
            } SOL...`
          );
          const fundTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: poolPda,
              lamports: bucketAmounts[bucketId],
            })
          );
          await sendAndConfirmTransaction(connection, fundTx, [wallet]);
          console.log(`Pool ${bucketId} funded`);
        } catch (fundError: any) {
          console.log(
            `Pool ${bucketId} already funded or error: ${fundError.message}`
          );
        }
      } else {
        console.error(`Failed to initialize pool ${bucketId}:`, e.message);
      }
    }
  }

  console.log("\n✓ Protocol initialization complete!");
  console.log("Admin:", wallet.publicKey.toString());
  console.log("Relayer:", wallet.publicKey.toString());
}

main().catch(console.error);
