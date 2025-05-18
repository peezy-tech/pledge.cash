import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Cpi } from "../target/types/cpi";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("cpi", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Cpi as Program<Cpi>;

  const sender = provider.wallet as anchor.Wallet;
  const recipient = new Keypair();

  const transferAmount = 0.01 * LAMPORTS_PER_SOL;

  it("SOL Transfer Anchor", async () => {
    const transactionSignature = await program.methods
      .solTransferOne(new BN(transferAmount))
      .accounts({
        sender: sender.publicKey,
        recipient: recipient.publicKey,
      })
      .rpc();

    console.log("Transaction Signature:", transactionSignature);
  });

  it("SOL Transfer invoke", async () => {
    const transactionSignature = await program.methods
      .solTransferTwo(new BN(transferAmount))
      .accounts({
        sender: sender.publicKey,
        recipient: recipient.publicKey,
      })
      .rpc();

    console.log("Transaction Signature:", transactionSignature);
  });

  it("SOL Transfer invoke manually", async () => {
    const transactionSignature = await program.methods
      .solTransferThree(new BN(transferAmount))
      .accounts({
        sender: sender.publicKey,
        recipient: recipient.publicKey,
      })
      .rpc();

    console.log("Transaction Signature:", transactionSignature);
  });
});
