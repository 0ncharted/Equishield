# EquiShield — FHE-Encrypted Cap Table dApp

## Overview

Confidential cap table management dApp built for the **Zama Developer Program Season 2 Hackathon** (Builder Track, deadline May 10, 2026). All share counts, prices, and vesting data are encrypted on-chain using Zama's Fully Homomorphic Encryption (FHEVM) on Sepolia testnet.

## Architecture

pnpm workspace monorepo with two main components:

1. **`artifacts/equishield/`** — React + Vite frontend (served at `/`)
2. **`packages/hardhat/`** — Solidity smart contract + Hardhat tooling

## Stack

- **Frontend**: React 19, Vite, Tailwind CSS v4, TypeScript
- **Web3**: wagmi v2, viem v2, RainbowKit v2 (wallet connect + UI)
- **FHE client**: fhevmjs v0.6.2 (using `fhevmjs/bundle` self-contained build)
- **Smart contract**: Solidity 0.8.24 + `@fhevm/solidity` v0.11.x (Zama FHEVM)
- **Contract tooling**: Hardhat, TypeChain, ethers v6
- **Target network**: Ethereum Sepolia testnet

## Smart Contract

Located at `packages/hardhat/contracts/EquiShield.sol`.

### Functions

| Function | Access | Description |
|---|---|---|
| `issueShares(holder, encShares, proof, encPrice, priceProof)` | Owner only | Grants encrypted shares at an encrypted price |
| `vestShares(holder, encAmount, proof)` | Owner only | Adds to vested share balance |
| `transferShares(to, encAmount, proof)` | Active shareholders | FHE-encrypted peer-to-peer transfer |
| `getMyShares()` | Caller (ACL-gated) | Returns caller's encrypted share handle |
| `getMyVestedShares()` | Caller (ACL-gated) | Returns caller's vested share handle |
| `vote(proposalId, encWeight, proof)` | Active shareholders | Encrypted governance voting |
| `regulatorView(holder)` | Owner only | Returns all 3 encrypted handles; grants regulator ACL access |
| `grantRegulator(addr)` | Owner only | Sets the designated regulator address |

### Deployment

1. Set secrets: `MNEMONIC` (12-word seed phrase) and `INFURA_API_KEY` in Replit Secrets
2. Run: `cd packages/hardhat && npx hardhat run deploy/01_deploy_equishield.ts --network sepolia`
3. The deploy script automatically writes the contract address to `artifacts/equishield/src/lib/contract.ts`

### Compilation

```bash
cd packages/hardhat && echo "n" | npx hardhat compile
```

Compiled artifacts output to `packages/hardhat/artifacts/` and TypeChain types to `packages/hardhat/typechain-types/`.

## Frontend Pages

| Route | Page | Description |
|---|---|---|
| `/` | Home | Landing page with feature overview |
| `/admin` | Admin Dashboard | Issue shares, trigger vesting, view cap table |
| `/shareholder` | Shareholder View | Decrypt balance, transfer shares, vote |
| `/investor` | Investor View | Vesting progress with FHE decrypt |
| `/audit` | Audit & Compliance | Regulator lookup of encrypted ciphertexts |

## Key Files

- `artifacts/equishield/src/lib/fhevm.ts` — fhevmjs singleton + encrypt/decrypt helpers
- `artifacts/equishield/src/lib/contract.ts` — contract address (update post-deploy)
- `artifacts/equishield/src/lib/web3.ts` — wagmi/RainbowKit config with public Sepolia RPC
- `artifacts/equishield/src/abi/EquiShield.json` — contract ABI for wagmi hooks
- `packages/hardhat/deploy/01_deploy_equishield.ts` — Hardhat deploy script

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `MNEMONIC` | Replit Secret | Deployer wallet seed phrase |
| `INFURA_API_KEY` | Replit Secret | Infura RPC key for Sepolia |
| `VITE_INFURA_API_KEY` | Optional Replit Secret | If set, frontend uses Infura RPC; otherwise uses public node |
| `PORT` | Auto-set by workflow | Vite dev server port |
| `BASE_PATH` | Auto-set by workflow | Vite base path for proxy routing |

## Key Commands

- `pnpm --filter @workspace/equishield run dev` — run frontend dev server (via workflow)
- `cd packages/hardhat && echo "n" | npx hardhat compile` — compile contract
- `cd packages/hardhat && npx hardhat run deploy/01_deploy_equishield.ts --network sepolia` — deploy
- `cd packages/hardhat && npx hardhat test` — run contract test suite
