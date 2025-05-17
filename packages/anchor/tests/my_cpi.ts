import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Anchor } from "../target/types/anchor";

it("SOL Transfer Anchor", async () => {
    const transactionSignature = await program.methods
      .solTransfer(new BN(transferAmount))
      .accounts({
        sender: sender.publicKey,
        recipient: recipient.publicKey,
      })
      .rpc();
   
    console.log(
      `\nTransaction Signature:` +
        `https://solana.fm/tx/${transactionSignature}?cluster=devnet-solana`,
    );
  });