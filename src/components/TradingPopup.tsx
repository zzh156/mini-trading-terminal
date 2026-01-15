
import React from 'react';
import { Rnd } from 'react-rnd';
import { X, GripHorizontal, Wallet } from 'lucide-react';
import { EnhancedToken } from "@codex-data/sdk/dist/sdk/generated/graphql";
import { toast } from "sonner";
import { useTradingStore } from "@/stores/use-trading-store";

interface TradingPopupProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    token?: EnhancedToken;
    raydiumPoolAddress?: string;
}

export const TradingPopup: React.FC<TradingPopupProps> = ({ isOpen, onClose, title = "Instant Trade", token }) => {
    if (!isOpen || !token) return null;

    const {
        executeTrade,
        buyPresets,
        sellPresets,
        solanaBalance,
        tokenBalance,
        walletAddress,
        isTrading
    } = useTradingStore();

    return (
        <Rnd
            default={{
                x: window.innerWidth / 2 - 200, // Slightly narrower default
                y: 100,
                width: 400,
                height: 'auto',
            }}
            minWidth={320}
            minHeight={200}
            bounds="window"
            dragHandleClassName="handle"
            className="z-50"
        >
            <div className="bg-[#0f0f11]/95 backdrop-blur-xl border border-[#27272a] rounded-xl shadow-2xl flex flex-col h-full overflow-hidden text-zinc-100 font-sans">
                {/* Header - Draggable */}
                <div className="handle flex items-center justify-between px-4 py-3 border-b border-[#27272a] cursor-move bg-[#18181b]/50 select-none">
                    <div className="flex items-center gap-2">
                        <GripHorizontal className="w-4 h-4 text-zinc-500" />
                        <span className="text-sm font-semibold tracking-tight text-zinc-300">{title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(walletAddress);
                                toast.success("Address copied");
                            }}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#27272a] border border-zinc-700/50 text-[10px] text-zinc-400 font-mono hover:bg-[#3f3f46] hover:text-zinc-200 transition-colors cursor-pointer"
                        >
                            <Wallet className="w-3 h-3" />
                            {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-[#3f3f46]/50 rounded-md transition-colors text-zinc-400 hover:text-white cursor-pointer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Body - Content Area */}
                <div className="flex-1 p-5 overflow-y-auto space-y-6">

                    {/* Buy Section */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-baseline">
                            <span className="text-sm font-medium text-zinc-300">Buy</span>
                            <span className="text-xs text-zinc-500 font-mono">
                                {solanaBalance.toFixed(4)} SOL
                            </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            {buyPresets.map(amount => (
                                <button
                                    key={amount}
                                    onClick={() => !isTrading && executeTrade("buy", amount)}
                                    disabled={isTrading}
                                    className={`relative group overflow-hidden py-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 active:scale-95 transition-all cursor-pointer ${isTrading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <span className="text-sm font-bold text-emerald-400">{amount}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sell Section */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-baseline">
                            <span className="text-sm font-medium text-zinc-300">Sell</span>
                            <span className="text-xs text-zinc-500 font-mono">
                                {tokenBalance.toLocaleString()} {token.symbol}
                            </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            {sellPresets.map(percent => (
                                <button
                                    key={percent}
                                    onClick={() => !isTrading && executeTrade("sell", percent)}
                                    disabled={isTrading}
                                    className={`relative group overflow-hidden py-2 rounded-full border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 active:scale-95 transition-all cursor-pointer ${isTrading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <span className="text-sm font-bold text-rose-400">{percent}%</span>
                                </button>
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        </Rnd>
    );
};
