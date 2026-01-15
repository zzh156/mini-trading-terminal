Requirements:
- Currently trading is only supported on the Solana network using Jupiter Swap API with Solana as quote token.
- Use Helius RPC to directly retrieve the required data from the blockchain.
- Create a VersionedTransaction to invoke RaydiumCPMM::swap_base_input.
- Do not use Raydium SDK or other third party API
- Everything should be written in-house using Typescript with some basic Solana library (e.g. solana/web3.js)
- For submitting a transaction, feel free to use Helius RPC provided in the ENV below.
