import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EnhancedToken } from "@codex-data/sdk/dist/sdk/generated/graphql";
import { useTradingStore } from "@/stores/use-trading-store";

interface TradingPanelProps {
  token: EnhancedToken;
  raydiumPoolAddress?: string;
}

export function TradingPanel({ token, raydiumPoolAddress }: TradingPanelProps) {
  const tokenSymbol = token.symbol;
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [buyAmount, setBuyAmount] = useState("");
  const [sellPercentage, setSellPercentage] = useState("");

  const {
    solanaBalance,
    tokenBalance,
    isBalanceLoading,
    executeTrade,
    isTrading,
    buyPresets: solBuyAmountPresets,
    sellPresets: percentagePresets,
    walletAddress
  } = useTradingStore();

  // Wrapper to bridge local input state to the hook's execution function
  const handleTrade = useCallback(async () => {
    const value = tradeMode === "buy" ? parseFloat(buyAmount) : parseFloat(sellPercentage);
    if (!value || value <= 0) return;

    await executeTrade(tradeMode, value);
  }, [tradeMode, buyAmount, sellPercentage, executeTrade]);

  if (!import.meta.env.VITE_SOLANA_PRIVATE_KEY || !import.meta.env.VITE_HELIUS_RPC_URL || !import.meta.env.VITE_JUPITER_REFERRAL_ACCOUNT) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trade {tokenSymbol || "Token"}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Trading requires VITE_SOLANA_PRIVATE_KEY, VITE_HELIUS_RPC_URL and VITE_JUPITER_REFERRAL_ACCOUNT to be configured in environment variables.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trade {tokenSymbol || "Token"}</CardTitle>
          <button
            onClick={() => {
              navigator.clipboard.writeText(walletAddress);
              toast.success("Wallet address copied!");
            }}
            className="text-xs text-muted-foreground font-mono hover:text-foreground transition-colors cursor-pointer"
          >
            {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
          <span className="text-sm text-muted-foreground">SOL Balance:</span>
          <span className="font-semibold">{solanaBalance.toFixed(4)} SOL</span>
        </div>

        {tokenSymbol && (
          <div className="flex justify-between p-3 bg-muted/30 rounded-lg">
            <span className="text-sm text-muted-foreground">{tokenSymbol} Balance:</span>
            <span className="font-semibold">{tokenBalance.toLocaleString()} {tokenSymbol}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => setTradeMode("buy")}
            className={cn(
              "flex-1 py-2 px-4 rounded-lg font-medium transition-all cursor-pointer", // Added cursor-pointer
              tradeMode === "buy"
                ? "bg-green-500/20 text-green-500 border border-green-500/50"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            )}
          >
            Buy
          </button>
          <button
            onClick={() => setTradeMode("sell")}
            className={cn(
              "flex-1 py-2 px-4 rounded-lg font-medium transition-all cursor-pointer", // Added cursor-pointer
              tradeMode === "sell"
                ? "bg-red-500/20 text-red-500 border border-red-500/50"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            )}
          >
            Sell
          </button>
        </div>

        {tradeMode === "buy" ? (
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Amount in SOL</label>
            <div className="flex gap-2">
              {solBuyAmountPresets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setBuyAmount(preset.toString())}
                  className={cn(
                    "flex-1 py-1.5 px-2 rounded-md text-sm font-medium transition-all cursor-pointer", // Added cursor-pointer
                    buyAmount === preset.toString()
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
            <Input
              type="number"
              placeholder="0.00"
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              min="0"
              step="0.01"
            />
            <div className="text-xs text-muted-foreground">
              Available: {solanaBalance.toFixed(4)} SOL
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-sm text-muted-foreground">Sell Percentage</label>
            <div className="flex gap-2">
              {percentagePresets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setSellPercentage(preset.toString())}
                  className={cn(
                    "flex-1 py-1.5 px-2 rounded-md text-sm font-medium transition-all cursor-pointer", // Added cursor-pointer
                    sellPercentage === preset.toString()
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {preset}%
                </button>
              ))}
            </div>
            <Input
              type="number"
              placeholder="0"
              value={sellPercentage}
              onChange={(e) => setSellPercentage(e.target.value)}
              min="0"
              max="100"
              step="1"
            />
            {sellPercentage && tokenBalance > 0 && (
              <div className="text-xs text-muted-foreground">
                Selling: {((tokenBalance * parseFloat(sellPercentage)) / 100).toLocaleString()} {tokenSymbol}
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleTrade}
          disabled={isBalanceLoading || isTrading || // Disable if trading
            (tradeMode === "buy" && (!buyAmount || parseFloat(buyAmount) <= 0)) ||
            (tradeMode === "sell" && (!sellPercentage || parseFloat(sellPercentage) <= 0))
          }
          className={cn(
            "w-full py-3 px-4 rounded-lg font-semibold transition-all mb-4 cursor-pointer", // Added cursor-pointer
            tradeMode === "buy"
              ? "bg-green-500 hover:bg-green-600 text-white disabled:bg-green-500/30 disabled:text-green-500/50"
              : "bg-red-500 hover:bg-red-600 text-white disabled:bg-red-500/30 disabled:text-red-500/50",
            "disabled:cursor-not-allowed" // Keep disabled cursor override
          )}
        >
          {tradeMode === "buy" ? "Buy" : "Sell"} {tokenSymbol || "Token"}
        </button>

        <div className="pt-4 border-t border-border">
          {raydiumPoolAddress ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <p className="text-xs font-medium text-foreground/80">Strategy: Raydium CPMM</p>
              </div>
              <div className="bg-muted/50 rounded p-2 overflow-hidden">
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight mb-1 opacity-70">Direct Pool Address</p>
                <a
                  href={`https://solscan.io/account/${raydiumPoolAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono break-all text-muted-foreground/90 leading-normal hover:text-primary transition-colors hover:underline inline-block"
                >
                  {raydiumPoolAddress}
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 opacity-80">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <p className="text-xs font-medium text-foreground/80">Strategy: Jupiter Routing</p>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug pl-3.5">
                No active Raydium CPMM SOL-pair detected. Falling back to Jupiter aggregator for optimal execution.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}