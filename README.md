# EquiShield — FHE-Encrypted Cap Table Management

## What is EquiShield?

EquiShield is the on-chain equivalent of Carta or Pulley — a cap table management platform built for startups and private companies that need the compliance guarantees of blockchain without sacrificing confidentiality. Every company's most sensitive data lives in its cap table: who owns what percentage, at what valuation, when their shares vest, and how voting power is distributed. Publishing this information on a public blockchain in plaintext is not just impractical — it is commercially and legally untenable. EquiShield solves this by using Zama's Fully Homomorphic Encryption (FHEVM) to keep all share counts, prices, and vesting schedules encrypted on-chain at all times, while still allowing the company to execute share issuances, vesting triggers, governance votes, and compliance audits directly on the encrypted data.

The platform provides four purpose-built dashboards: an Admin dashboard for the company to issue shares, trigger vesting, and manage the cap table; a Shareholder dashboard for holders to view their own decrypted position and transfer shares; an Investor read-only view for portfolio monitoring and vesting timelines; and a Regulator/Audit view for authorized compliance officers to inspect encrypted handles and review the full event log without exposing raw amounts on-chain.

## Why FHE — Not Just "Privacy is Good"

Standard blockchain privacy techniques (zero-knowledge proofs, commit-reveal schemes, off-chain storage) solve narrow problems but fail for cap table management specifically. ZK proofs can prove a fact without revealing data, but they cannot compute *on* private data — you cannot add two shareholders' encrypted balances, check vesting conditions, or tally governance votes without decrypting first. Commit-reveal forces data to be revealed at some point, creating a window of exposure. Off-chain storage (Arweave, IPFS) removes trustlessness entirely.

FHE is the only cryptographic primitive that allows arbitrary computation on ciphertext without ever decrypting it. In EquiShield, when Alice transfers shares to Bob, the contract executes `FHE.sub()` on Alice's encrypted balance and `FHE.add()` on Bob's — the share amounts are never visible on-chain to any observer, including validators. When a shareholder votes on a governance proposal, their encrypted voting weight is stored and can be aggregated without revealing individual positions. The admin can trigger vesting calculations on encrypted data. The regulator can request access to specific encrypted handles for audit purposes, which are then re-encrypted for their key — not decrypted publicly. This is not privacy as a feature; it is the prerequisite for cap table data to exist on a public blockchain at all.

## Tech Stack

- **Smart Contracts**: Solidity 0.8.24 + Zama FHEVM (`@fhevm/solidity`)
- **FHE Operations**: `FHE.fromExternal()`, `FHE.add()`, `FHE.sub()`, `FHE.allowThis()`, `FHE.allow()`
- **Network Config**: `ZamaEthereumConfig` (extends contract for Sepolia Zama gateway)
- **Frontend**: React + Vite + Tailwind CSS
- **Wallet**: wagmi v2 + viem + RainbowKit
- **Client-side FHE**: fhevmjs (encrypts inputs before sending to contract)
- **Development**: Hardhat + hardhat-deploy + TypeChain
- **Network**: Sepolia testnet (chainId 11155111)

## Deployed Contract

- **Network**: Sepolia Testnet
- **Contract Address**: `TBD — will be updated after deployment`
- **Deploy Transaction**: `TBD`
- **Zama Gateway**: `https://gateway.zama.ai`

## How to Run Locally

### Prerequisites

- Node.js 20+
- pnpm 9+
- A wallet with Sepolia ETH (get from [Sepolia faucet](https://sepoliafaucet.com))
- Infura API key for Sepolia RPC

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set environment variables

Create `packages/hardhat/.env` (copy from `.env.example`):

```env
MNEMONIC=your twelve word mnemonic phrase here
INFURA_API_KEY=your_infura_api_key_here
```

### 3. Compile contracts

```bash
cd packages/hardhat
npx hardhat compile
```

### 4. Run tests

```bash
cd packages/hardhat
npx hardhat test
```

### 5. Deploy to Sepolia

```bash
cd packages/hardhat
npx hardhat deploy --network sepolia
```

The deploy script automatically writes the contract address to `artifacts/equishield/src/lib/contract.ts`.

### 6. Run the frontend

```bash
pnpm --filter @workspace/equishield run dev
```

Open [http://localhost:PORT](http://localhost:PORT) in your browser. Connect your wallet (MetaMask or any RainbowKit-supported wallet) on Sepolia testnet.

## Key Contract Functions

| Function | Access | Description |
|---|---|---|
| `issueShares(holder, encShares, proof, encPrice, priceProof)` | Admin only | Creates encrypted shareholder entry |
| `vestShares(holder, encVested, proof)` | Admin only | FHE.add() on encrypted vested amount |
| `transferShares(to, encAmount, proof)` | Active shareholder | FHE sub/add — no amounts on chain |
| `getMyShares()` | Caller (if granted access) | Returns encrypted handle |
| `getMyVestedShares()` | Caller (if granted access) | Returns encrypted vested handle |
| `vote(proposalId, encWeight, proof)` | Active shareholder | Encrypted governance vote |
| `regulatorView(holder)` | Admin only | Returns handles + grants regulator access |
| `grantRegulator(addr)` | Admin only | Designates regulator for audit |

## FHE Rules Followed

- All inputs use `FHE.fromExternal(handle, proof)` — never stored as `externalEuint64` directly
- All stored encrypted values call `FHE.allowThis()` so the contract can re-use them
- Every party that needs decryption access gets an explicit `FHE.allow(value, address)` call
- No `euint` values appear in `if`/`require` — conditional logic uses `FHE.select()`
- Contract extends `ZamaEthereumConfig` for Sepolia gateway configuration

---

*Built for Zama Developer Program Season 2 Hackathon — Builder Track*
*Deadline: May 10, 2026*
