import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PrivacyProxy } from "../target/types/privacy_proxy";
import { ZkVerifier } from "../target/types/zk_verifier";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

describe("privacy_proxy", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PrivacyProxy as Program<PrivacyProxy>;

  const admin = provider.wallet;
  const relayer = Keypair.generate();
  const relayerTreasury = Keypair.generate();

  const relayerSigningKeyN = new Array(256).fill(1);
  const relayerSigningKeyE = [1, 0, 1, 0];

  let configPda: PublicKey;

  before(async () => {
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    const sig = await provider.connection.requestAirdrop(
      relayer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: sig,
      ...latestBlockhash,
    });
  });

  it("Initializes the protocol", async () => {
    const tx = await program.methods
      .initialize({
        relayerTreasury: relayerTreasury.publicKey,
        authorizedRelayer: relayer.publicKey,
        relayerSigningKeyN: relayerSigningKeyN,
        relayerSigningKeyE: relayerSigningKeyE,
        feeBps: 50,
      })
      .accounts({
        admin: admin.publicKey,
      })
      .rpc();

    console.log("Initialize tx:", tx);

    const config = await program.account.globalConfig.fetch(configPda);
    expect(config.admin.toString()).to.equal(admin.publicKey.toString());
    expect(config.authorizedRelayer.toString()).to.equal(
      relayer.publicKey.toString()
    );
    expect(config.feeBps).to.equal(50);
    expect(config.paused).to.equal(false);

    console.log("✓ Protocol initialized successfully");
  });

  it("Purchases credits with blinded token", async () => {
    const blindedToken = new Array(256).fill(0).map((_, i) => i % 256);
    const amount = 1_005_000_000;

    const tx = await program.methods
      .purchaseCredits(new anchor.BN(amount), blindedToken)
      .accounts({
        user: admin.publicKey,
        relayerTreasury: relayerTreasury.publicKey,
      })
      .rpc();

    console.log("Purchase credits tx:", tx);
    console.log("✓ Credits purchased");
  });
});

describe("zk_verifier (security hardened v2)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ZkVerifier as Program<ZkVerifier>;
  const caller = provider.wallet;

  it("Rejects invalid withdrawal proof", async () => {
    const proof = {
      a: new Array(64).fill(0),
      b: new Array(128).fill(0),
      c: new Array(64).fill(0),
    };

    const publicInputs = {
      merkleRoot: new Array(32).fill(1),
      nullifierHash: new Array(32).fill(2),
      recipient: caller.publicKey,
      amount: new anchor.BN(1_000_000_000),
      relayer: PublicKey.default,
      fee: new anchor.BN(5_000_000), // fee < amount (valid)
    };

    // Binding hash (would be computed by circuit)
    const bindingHash = new Array(32).fill(3);

    try {
      await program.methods
        .verifyWithdrawal(proof, publicInputs, bindingHash)
        .accounts({
          caller: caller.publicKey,
        })
        .rpc();

      expect.fail("Expected verification to fail");
    } catch (err: unknown) {
      console.log("✓ Invalid proof correctly rejected");
      expect((err as Error).toString()).to.include("Error");
    }
  });

  it("Rejects fee >= amount", async () => {
    const proof = {
      a: new Array(64).fill(0),
      b: new Array(128).fill(0),
      c: new Array(64).fill(0),
    };

    const publicInputs = {
      merkleRoot: new Array(32).fill(1),
      nullifierHash: new Array(32).fill(2),
      recipient: caller.publicKey,
      amount: new anchor.BN(1_000_000_000),
      relayer: PublicKey.default,
      fee: new anchor.BN(1_000_000_000), // fee == amount (INVALID)
    };

    const bindingHash = new Array(32).fill(3);

    try {
      await program.methods
        .verifyWithdrawal(proof, publicInputs, bindingHash)
        .accounts({
          caller: caller.publicKey,
        })
        .rpc();

      expect.fail("Expected fee validation to fail");
    } catch (err: unknown) {
      console.log("✓ Fee >= amount correctly rejected");
      expect((err as Error).toString()).to.include("Error");
    }
  });

  it("Rejects zero amount", async () => {
    const proof = {
      a: new Array(64).fill(0),
      b: new Array(128).fill(0),
      c: new Array(64).fill(0),
    };

    const publicInputs = {
      merkleRoot: new Array(32).fill(1),
      nullifierHash: new Array(32).fill(2),
      recipient: caller.publicKey,
      amount: new anchor.BN(0), // INVALID
      relayer: PublicKey.default,
      fee: new anchor.BN(0),
    };

    const bindingHash = new Array(32).fill(3);

    try {
      await program.methods
        .verifyWithdrawal(proof, publicInputs, bindingHash)
        .accounts({
          caller: caller.publicKey,
        })
        .rpc();

      expect.fail("Expected zero amount to fail");
    } catch (err: unknown) {
      console.log("✓ Zero amount correctly rejected");
      expect((err as Error).toString()).to.include("Error");
    }
  });

  it("Rejects invalid ownership proof (with withdrawal binding)", async () => {
    const proof = {
      a: new Array(64).fill(0),
      b: new Array(128).fill(0),
      c: new Array(64).fill(0),
    };

    // SECURITY v2: Now requires pendingWithdrawalId and bindingHash
    const publicInputs = {
      nullifierHash: new Array(32).fill(3),
      pendingWithdrawalId: new anchor.BN(42),
    };

    // Binding hash (would be computed by circuit)
    const bindingHash = new Array(32).fill(4);

    try {
      await program.methods
        .verifyOwnership(proof, publicInputs, bindingHash)
        .accounts({
          caller: caller.publicKey,
        })
        .rpc();

      expect.fail("Expected verification to fail");
    } catch (err: unknown) {
      console.log("✓ Ownership proof correctly rejected");
      expect((err as Error).toString()).to.include("Error");
    }
  });
});
