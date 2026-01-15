import { create } from 'zustand';
import { EnhancedToken } from "@codex-data/sdk/dist/sdk/generated/graphql";
import { toast } from "sonner";
import { PublicKey } from "@solana/web3.js";
import { confirmTransaction, createConnection, createKeypair, sendTransaction, signTransaction } from "@/lib/solana";
import { createSwapTransaction } from "@/lib/trade";

interface TradingState {
    // State
    token: EnhancedToken | null;
    raydiumPoolAddress?: string;
    solanaBalance: number;
    tokenBalance: number;
    tokenAtomicBalance: string;
    isBalanceLoading: boolean;
    isTrading: boolean;
    walletAddress: string;

    // Presets
    buyPresets: number[];
    sellPresets: number[];

    // Actions
    initialize: (token: EnhancedToken, raydiumPoolAddress?: string) => void;
    refreshBalance: () => Promise<void>;
    executeTrade: (direction: "buy" | "sell", amountOrPercent: number) => Promise<void>;
}

// Helper to get connection and keypair (recreated or cached outside store?)
// Since keypair is from env, it's static. Connection is cheap to create or can be single instance.
const keypair = createKeypair(import.meta.env.VITE_SOLANA_PRIVATE_KEY);
const connection = createConnection();
const walletAddress = keypair.publicKey.toBase58();

export const useTradingStore = create<TradingState>((set, get) => ({
    token: null,
    raydiumPoolAddress: undefined,
    solanaBalance: 0,
    tokenBalance: 0,
    tokenAtomicBalance: "0",
    isBalanceLoading: false,
    isTrading: false,
    walletAddress: walletAddress,

    buyPresets: [0.0001, 0.001, 0.01, 0.1],
    sellPresets: [25, 50, 75, 100],

    initialize: (token, raydiumPoolAddress) => {
        set({ token, raydiumPoolAddress });
        get().refreshBalance();
    },

    refreshBalance: async () => {
        const { token } = get();
        if (!token) return;

        set({ isBalanceLoading: true });
        try {
            // 1. Get SOL Balance
            const solBalance = await connection.getBalance(keypair.publicKey);

            // 2. Get Token Balance
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
                mint: new PublicKey(token.address),
            });

            let tAtomic = "0";
            let tUi = 0;

            if (tokenAccounts.value.length > 0) {
                const accountInfo = tokenAccounts.value[0].account.data.parsed.info;
                tAtomic = accountInfo.tokenAmount.amount;
                tUi = accountInfo.tokenAmount.uiAmount || 0;
            }

            set({
                solanaBalance: solBalance / 1e9,
                tokenAtomicBalance: tAtomic,
                tokenBalance: tUi,
                isBalanceLoading: false
            });
        } catch (e) {
            console.error("Failed to fetch balance", e);
            set({ isBalanceLoading: false });
        }
    },

    executeTrade: async (direction, amountOrPercent) => {
        const { token, tokenAtomicBalance, raydiumPoolAddress, isTrading } = get();
        if (!token || isTrading) return;

        set({ isTrading: true });
        const toastId = toast.loading(`Initiating ${direction.toUpperCase()}...`);
        try {
            const transaction = await createSwapTransaction({
                direction,
                value: amountOrPercent,
                signer: keypair.publicKey,
                tokenAddress: token.address,
                tokenAtomicBalance,
                raydiumPoolAddress,
                connection
            });

            toast.loading("Signing transaction...", { id: toastId });
            const signedTransaction = signTransaction(keypair, transaction);

            toast.loading("Sending transaction...", { id: toastId });
            const signature = await sendTransaction(signedTransaction, connection);

            toast.loading("Confirming transaction...", { id: toastId });
            const confirmation = await confirmTransaction(signature, connection);

            if (confirmation.value.err) {
                throw new Error("Trade failed");
            }
            toast.success(`Trade successful! TX: ${signature.slice(0, 8)}...`, { id: toastId });

            // Refresh balance after 1 second
            setTimeout(() => get().refreshBalance(), 1000);
        } catch (error) {
            toast.error((error as Error).message, { id: toastId });
        } finally {
            set({ isTrading: false });
        }
    }
}));
