import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction, Connection } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import Decimal from "decimal.js";
import Jupiter from "@/lib/jupiter";
import { bn } from "@/lib/utils";
import { buildRaydiumSwapTransaction } from "@/lib/raydium-cpmm";

interface TradeParams {
  direction: "buy" | "sell";
  value: number; // SOL amount or Percentage
  signer: PublicKey;
  tokenAddress: string;
  tokenAtomicBalance: string;
  raydiumPoolAddress?: string;
  connection: Connection; // Connection might be needed for CPMM checks
}

export async function createSwapTransaction({
  direction,
  value,
  signer,
  tokenAddress,
  tokenAtomicBalance,
  raydiumPoolAddress
}: TradeParams): Promise<VersionedTransaction> {
  // Calculate atomic amount
  let atomicAmount;
  if (direction === "buy") {
    atomicAmount = new Decimal(value).mul(LAMPORTS_PER_SOL);
  } else {
    // Value is percentage (0-100)
    // tokenAtomicBalance is string, convert to Decimal
    const balance = new Decimal(tokenAtomicBalance);
    atomicAmount = balance.mul(value).div(100).floor();
  }

  // Route to Raydium CPMM if available
  if (raydiumPoolAddress) {
    // Note: In the original hook there was `await checkRaydiumCPMMPool(raydiumPoolAddress)`.
    // We can include it here if we want to be safe, but typically if we have the address we assume it's valid or we check it.
    // For performance, we might skip re-checking if the caller ensures it's a CPMM pool.
    // Let's assume valid if provided, as per previous logic "This check can be removed..."

    try {
      return await buildRaydiumSwapTransaction({
        poolAddress: raydiumPoolAddress,
        tokenAddress,
        direction,
        atomicAmount,
        signer
      });
    } catch (err) {
      console.error("Raydium CPMM Transaction Construction failed:", err);
      throw err;
    }
  }

  // Fallback/Default to Jupiter
  const data = await Jupiter.getOrder({
    inputMint:
      direction === "buy" ? NATIVE_MINT : new PublicKey(tokenAddress),
    outputMint:
      direction === "buy" ? new PublicKey(tokenAddress) : NATIVE_MINT,
    amount: bn(atomicAmount),
    signer,
  });

  if (data.error) {
    throw new Error(data.error);
  }

  if (data.transaction === null) {
    throw new Error("Invalid data from Jupiter.getOrder");
  }

  // Parse the transaction from base64
  const transactionBuffer = Buffer.from(data.transaction, "base64");
  const transaction = VersionedTransaction.deserialize(transactionBuffer);

  return transaction;
}