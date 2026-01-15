import { Connection, PublicKey, TransactionInstruction, SystemProgram, AccountMeta, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { Buffer } from "buffer";
import {
    NATIVE_MINT,
    AccountLayout,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    createCloseAccountInstruction,
} from "@solana/spl-token";
import Decimal from "decimal.js";
import { bn } from "@/lib/utils";
import { createConnection } from "@/lib/solana";

// Raydium CPMM Mainnet Program ID
export const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
export const CPMM_PROGRAM_ID = new PublicKey(RAYDIUM_CPMM_PROGRAM_ID);

// Seed for Authority PDA
const AUTH_SEED = Buffer.from("vault_and_lp_mint_auth_seed", "utf8");

export interface CpmmPoolState {
    ammConfig: PublicKey;
    poolCreator: PublicKey;
    token0Vault: PublicKey;
    token1Vault: PublicKey;
    lpMint: PublicKey;
    token0Mint: PublicKey;
    token1Mint: PublicKey;
    token0Program: PublicKey;
    token1Program: PublicKey;
    observationKey: PublicKey;
}

export async function getPoolState(connection: Connection, poolId: PublicKey): Promise<CpmmPoolState> {
    const accountInfo = await connection.getAccountInfo(poolId);
    if (!accountInfo) {
        throw new Error(`Pool account ${poolId.toBase58()} not found`);
    }

    if (!accountInfo.owner.equals(CPMM_PROGRAM_ID)) {
        throw new Error(`Pool ${poolId.toBase58()} is not a CPMM pool. Owner: ${accountInfo.owner.toBase58()}`);
    }

    const data = accountInfo.data;
    // Skip 8 bytes discriminator
    let offset = 8;

    const ammConfig = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const poolCreator = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const token0Vault = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const token1Vault = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;

    const lpMint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const token0Mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const token1Mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;

    const token0Program = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const token1Program = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const observationKey = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;

    // console.log("Raydium CPMM Pool Details:", {
    //     poolId: poolId.toBase58(),
    //     ammConfig: ammConfig.toBase58(),
    //     poolCreator: poolCreator.toBase58(),
    //     token0Vault: token0Vault.toBase58(),
    //     token1Vault: token1Vault.toBase58(),
    //     lpMint: lpMint.toBase58(),
    //     token0Mint: token0Mint.toBase58(),
    //     token1Mint: token1Mint.toBase58(),
    // });

    return {
        ammConfig,
        poolCreator,
        token0Vault,
        token1Vault,
        lpMint,
        token0Mint,
        token1Mint,
        token0Program,
        token1Program,
        observationKey
    };
}

export function getAuthAddress(programId: PublicKey): PublicKey {
    const [authWithSeed] = PublicKey.findProgramAddressSync(
        [AUTH_SEED],
        programId
    );
    return authWithSeed;
}


interface PoolReserves {
    token0Amount: BN;
    token1Amount: BN;
}

export async function getPoolReserves(connection: Connection, poolState: CpmmPoolState): Promise<PoolReserves> {
    const accountInfo0 = await connection.getAccountInfo(poolState.token0Vault);
    if (!accountInfo0) {
        throw new Error(`Token0 Vault ${poolState.token0Vault.toBase58()} not found. PoolState parsing might be incorrect.`);
    }

    const accountInfo1 = await connection.getAccountInfo(poolState.token1Vault);
    if (!accountInfo1) {
        throw new Error(`Token1 Vault ${poolState.token1Vault.toBase58()} not found. PoolState parsing might be incorrect.`);
    }

    const data0 = AccountLayout.decode(accountInfo0.data);
    const data1 = AccountLayout.decode(accountInfo1.data);

    return {
        token0Amount: new BN(data0.amount.toString()),
        token1Amount: new BN(data1.amount.toString())
    };
}

export function calculateSwapResult(
    amountIn: BN,
    reserveIn: BN,
    reserveOut: BN
): BN {
    // Constant Product: x * y = k
    // (x + dx) * (y - dy) = k
    // y - dy = k / (x + dx)
    // dy = y - (x * y) / (x + dx)
    // dy = (y * dx) / (x + dx)

    // Raydium usually has fees. Assuming 0.25% fee (standard CPMM).
    // amountInWithFee = amountIn * 9975 / 10000
    // dy = (y * amountInWithFee) / (x + amountInWithFee)

    const amountInWithFee = amountIn.mul(new BN(9975));
    const denominator = reserveIn.mul(new BN(10000)).add(amountInWithFee);
    const numerator = reserveOut.mul(amountInWithFee);

    return numerator.div(denominator);
}

export async function createSwapInstruction(
    connection: Connection,
    poolId: PublicKey,
    userPublicKey: PublicKey,
    inputTokenAccount: PublicKey,
    outputTokenAccount: PublicKey,
    tokenInMint: PublicKey,
    amountIn: BN,
    minAmountOut?: BN
): Promise<TransactionInstruction> {
    // 1. Fetch Pool State
    const poolState = await getPoolState(connection, poolId);

    // 2. Derive Authority
    const authority = getAuthAddress(CPMM_PROGRAM_ID);

    // 3. Determine vaults and mints based on input token
    // If user inputs Token0 -> InputVault = Token0Vault, OutputVault = Token1Vault
    // If user inputs Token1 -> InputVault = Token1Vault, OutputVault = Token0Vault

    // Note: We need to compare mints.
    const isInputToken0 = poolState.token0Mint.equals(tokenInMint);
    const inputVault = isInputToken0 ? poolState.token0Vault : poolState.token1Vault;
    const outputVault = isInputToken0 ? poolState.token1Vault : poolState.token0Vault;

    // Reserves
    const reserves = await getPoolReserves(connection, poolState);
    const reserveIn = isInputToken0 ? reserves.token0Amount : reserves.token1Amount;
    const reserveOut = isInputToken0 ? reserves.token1Amount : reserves.token0Amount;

    // Calculate Min Out if not provided (default 1% slippage)
    let finalMinAmountOut = minAmountOut;
    if (!finalMinAmountOut) {
        const estimatedOut = calculateSwapResult(amountIn, reserveIn, reserveOut);
        finalMinAmountOut = estimatedOut.mul(new BN(99)).div(new BN(100)); // 1% slippage
    }

    // Token Programs
    const inputTokenProgram = isInputToken0 ? poolState.token0Program : poolState.token1Program;
    const outputTokenProgram = isInputToken0 ? poolState.token1Program : poolState.token0Program;

    // 4. Construct Instruction Data
    // Discriminator for swap_base_input: 8fbe5adac41e33de
    const discriminator = Buffer.from("8fbe5adac41e33de", "hex");
    const amountInBuf = Buffer.alloc(8);
    const minAmountOutBuf = Buffer.alloc(8);

    // BN toBuffer 'le' (little endian) with length 8
    amountInBuf.writeBigUInt64LE(BigInt(amountIn.toString()));
    minAmountOutBuf.writeBigUInt64LE(BigInt(finalMinAmountOut.toString()));

    const data = Buffer.concat([discriminator, amountInBuf, minAmountOutBuf]);

    // Derive output mint based on which token is input
    const outputMint = isInputToken0 ? poolState.token1Mint : poolState.token0Mint;

    // 5. Construct Keys (Order verified from Solscan real transactions)
    const keys: AccountMeta[] = [
        { pubkey: userPublicKey, isSigner: true, isWritable: true }, // #1 payer
        { pubkey: authority, isSigner: false, isWritable: false }, // #2 authority
        { pubkey: poolState.ammConfig, isSigner: false, isWritable: false }, // #3 amm_config
        { pubkey: poolId, isSigner: false, isWritable: true }, // #4 pool_state
        { pubkey: inputTokenAccount, isSigner: false, isWritable: true }, // #5 input_token_account
        { pubkey: outputTokenAccount, isSigner: false, isWritable: true }, // #6 output_token_account
        { pubkey: inputVault, isSigner: false, isWritable: true }, // #7 input_vault
        { pubkey: outputVault, isSigner: false, isWritable: true }, // #8 output_vault
        { pubkey: inputTokenProgram, isSigner: false, isWritable: false }, // #9 input_token_program
        { pubkey: outputTokenProgram, isSigner: false, isWritable: false }, // #10 output_token_program
        { pubkey: tokenInMint, isSigner: false, isWritable: false }, // #11 input_token_mint (dynamic)
        { pubkey: outputMint, isSigner: false, isWritable: false }, // #12 output_token_mint (dynamic)
        { pubkey: poolState.observationKey, isSigner: false, isWritable: true }, // #13 observation_state
    ];

    console.log("DEBUG: Raydium CPMM Swap Keys:", keys.map((k, i) => `${i}: ${k.pubkey.toBase58()} (S:${k.isSigner}, W:${k.isWritable})`));

    return new TransactionInstruction({
        keys,
        programId: CPMM_PROGRAM_ID,
        data
    });
}

// ============================================================================
// Strategy Check
// ============================================================================

/**
 * Check if a pool address is a valid Raydium CPMM pool
 * by verifying the on-chain account owner matches CPMM_PROGRAM_ID.
 */
export async function checkRaydiumCPMMPool(poolAddress?: string): Promise<boolean> {
    if (!poolAddress) {
        return false;
    }
    try {
        const connection = createConnection();
        const poolId = new PublicKey(poolAddress);
        const poolAccount = await connection.getAccountInfo(poolId);

        if (poolAccount && poolAccount.owner.equals(CPMM_PROGRAM_ID)) {
            console.log("Confirmed Raydium CPMM Pool. Using direct swap.");
            return true;
        } else {
            console.log(
                `Pool ${poolAddress} is not CPMM (Owner: ${poolAccount?.owner.toBase58()}). Using Jupiter.`
            );
            return false;
        }
    } catch (err) {
        console.warn("Failed to check pool owner:", err);
        return false;
    }
}

// ============================================================================
// Swap Transaction Builder
// ============================================================================

export interface RaydiumSwapParams {
    poolAddress: string;
    tokenAddress: string;
    direction: "buy" | "sell";
    atomicAmount: Decimal;
    signer: PublicKey;
}

/**
 * Build a Raydium CPMM swap transaction.
 *
 * This function handles:
 * - Fetching pool state to determine correct token programs
 * - Creating/checking ATAs for input and output tokens
 * - Wrapping SOL to wSOL when buying
 * - Unwrapping wSOL to SOL when selling
 * - Constructing and returning a VersionedTransaction
 */
export async function buildRaydiumSwapTransaction(
    params: RaydiumSwapParams
): Promise<VersionedTransaction> {
    const { poolAddress, tokenAddress, direction, atomicAmount, signer } = params;

    const connection = createConnection();
    const poolId = new PublicKey(poolAddress);
    const tokenMint = new PublicKey(tokenAddress);

    // Fetch pool state early to get correct Token Programs
    const poolState = await getPoolState(connection, poolId);

    const isBuy = direction === "buy";
    const tokenInMint = isBuy ? NATIVE_MINT : tokenMint;
    const tokenOutMint = isBuy ? tokenMint : NATIVE_MINT;

    // Identify Token Programs from Pool State
    const isInputToken0 = poolState.token0Mint.equals(tokenInMint);
    const inputTokenProgram = isInputToken0 ? poolState.token0Program : poolState.token1Program;
    const outputTokenProgram = isInputToken0 ? poolState.token1Program : poolState.token0Program;

    // Use correct Program ID for ATAs
    const inputTokenAccount = await getAssociatedTokenAddress(
        tokenInMint,
        signer,
        false,
        inputTokenProgram
    );

    const outputTokenAccount = await getAssociatedTokenAddress(
        tokenOutMint,
        signer,
        false,
        outputTokenProgram
    );

    const instructions = [];

    // 1. Handle Input wSOL
    if (tokenInMint.equals(NATIVE_MINT)) {
        const accountInfo = await connection.getAccountInfo(inputTokenAccount);
        if (!accountInfo) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    signer, inputTokenAccount, signer, NATIVE_MINT, inputTokenProgram
                )
            );
        }

        instructions.push(
            SystemProgram.transfer({
                fromPubkey: signer,
                toPubkey: inputTokenAccount,
                lamports: BigInt(atomicAmount.toString())
            })
        );
        instructions.push(createSyncNativeInstruction(inputTokenAccount));
    }

    // 2. Handle Output ATA
    const outputAccountInfo = await connection.getAccountInfo(outputTokenAccount);
    if (!outputAccountInfo) {
        instructions.push(
            createAssociatedTokenAccountInstruction(
                signer, outputTokenAccount, signer, tokenOutMint, outputTokenProgram
            )
        );
    }

    // 3. Swap
    const amountInBN = bn(atomicAmount);
    const swapIx = await createSwapInstruction(
        connection,
        poolId,
        signer,
        inputTokenAccount,
        outputTokenAccount,
        tokenInMint,
        amountInBN
    );
    instructions.push(swapIx);

    // 4. Close wSOL accounts to reclaim rent
    if (tokenOutMint.equals(NATIVE_MINT)) {
        instructions.push(
            createCloseAccountInstruction(outputTokenAccount, signer, signer)
        );
    }
    if (tokenInMint.equals(NATIVE_MINT)) {
        instructions.push(
            createCloseAccountInstruction(inputTokenAccount, signer, signer)
        );
    }

    // Build Transaction
    const latestBlockhash = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
        payerKey: signer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions
    }).compileToV0Message();

    return new VersionedTransaction(message);
}
