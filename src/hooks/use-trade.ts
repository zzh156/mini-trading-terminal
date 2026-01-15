import { useCallback } from "react";
import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import Decimal from "decimal.js";
import Jupiter from "@/lib/jupiter";
import { bn } from "@/lib/utils";
import { checkRaydiumCPMMPool, buildRaydiumSwapTransaction } from "@/lib/raydium-cpmm";

export const useTrade = (
  tokenAddress: string,
  tokenAtomicBalance: Decimal,
  raydiumPoolAddress?: string
) => {
  const createTransaction = useCallback(
    async (params: { direction: "buy" | "sell", value: number, signer: PublicKey }) => {
      const { direction, value, signer } = params;

      // Calculate atomic amount
      let atomicAmount;
      if (direction === "buy") {
        atomicAmount = new Decimal(value).mul(LAMPORTS_PER_SOL);
      } else {
        atomicAmount = tokenAtomicBalance.mul(value).div(100);
      }

      // This check can be removed to improve performance if you trust the frontend filter
      const useRaydiumCPMM = await checkRaydiumCPMMPool(raydiumPoolAddress);

      // Route to Raydium CPMM if available
      if (useRaydiumCPMM && raydiumPoolAddress) {
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
          throw err; // STRICTLY NO FALLBACK if confirmed CPMM
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
    },
    [tokenAddress, tokenAtomicBalance, raydiumPoolAddress],
  );

  return {
    createTransaction,
  };
};