# Tidewatch Signal Escrow

Pay-per-signal USDC escrow connecting [Tidewatch](https://github.com/mee0120/tidewatch) (a trading-signal AI agent) to subscriber bots and wallets. Each hour Tidewatch publishes a signal (WAIT / BUY / AVOID) plus a `bytes32` evidence hash that commits to the data behind the decision. Subscribers deposit USDC into their own on-chain escrow slot and set a maximum price cap. When Tidewatch publishes, it charges exactly `pricePerSignal` from each subscriber's escrow with no subscriptions, no servers, and no trust.

Built with [Arc Studio](https://studio.arc.io) — contracts, tests, security review, and app.

## Deployed on Arc Mainnet

| | |
|---|---|
| **Contract** | [`0xf49ad1e3d8bcb9c7678226faeefb521ac55988dc`](https://explorer.arc.io/address/0xf49ad1e3d8bcb9c7678226faeefb521ac55988dc) |
| **Deploy tx** | [`0x3cb6fedc00a11ddd254547a086d6def000854a4906d6a7a1ccd2143e9354a191`](https://explorer.arc.io/tx/0x3cb6fedc00a11ddd254547a086d6def000854a4906d6a7a1ccd2143e9354a191) |
| **Deposit tx** (1 USDC into escrow) | [`0x0459601db51c7495ba16dc91716b2d4e7f5b49738e26c951e8c5906c62589468`](https://explorer.arc.io/tx/0x0459601db51c7495ba16dc91716b2d4e7f5b49738e26c951e8c5906c62589468) |
| **Publish tx** (0.01 USDC paid per signal) | [`0x2b7b6ebe1ed59a56593f250f48ce64ea041aa4c281efe672f7476ee48b32f36f`](https://explorer.arc.io/tx/0x2b7b6ebe1ed59a56593f250f48ce64ea041aa4c281efe672f7476ee48b32f36f) |
| **Chain** | Arc Mainnet (Chain ID: 5042) |
| **Payment token** | USDC — `0x3600000000000000000000000000000000000000` |

## How it works

**Subscribers** deposit USDC into their personal escrow slot and set two guards:
- `maxPricePerSignal` — the provider can never charge above this cap
- `minInterval` — the minimum gap between chargeable signals (default 1 hour)

Subscribers watch the live `SignalDelivered` event feed in the app and withdraw their remaining balance at any time.

**Tidewatch** (the provider) sets the current price per signal and calls `publishSignal(subscriber, signal, evidenceHash, asOf)`. The contract atomically deducts from the subscriber's escrow and adds to provider earnings. Three replay guards in `publishSignal` prevent over-charging:
1. `asOf <= block.timestamp` — no future-dated signals
2. `asOf > lastAsOf[subscriber]` — exact replay protection; same timestamp always reverts
3. `asOf >= lastAsOf[subscriber] + effectiveInterval` — rate-limiting: subscriber controls the minimum gap

**Pre-flight simulation** in the app runs `eth_call` before every wallet prompt. If the call would revert, the decoded error message is shown instead of wasting gas.

## Contract

`contracts/SignalEscrow.sol` — Solidity 0.8.24, OpenZeppelin 5.x (Ownable, ReentrancyGuard, SafeERC20).

Security properties:
- `usdc` is `immutable`; deposit measures actual received tokens (fee-on-transfer safe)
- Provider rotation doesn't lock old earnings — any address withdraws `providerEarnings[msg.sender]`
- `signal > SIGNAL_AVOID` reverts with `InvalidSignal` (only WAIT=0, BUY=1, AVOID=2 accepted)
- 60 Foundry unit + fuzz tests covering all revert paths, replay guards, accounting invariants, and multi-subscriber isolation

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS
- **Onchain:** Solidity 0.8.24, Foundry, wagmi v2, viem v2, ConnectKit
- **Chain:** Arc Mainnet / Arc Testnet (USDC as native gas token)
- **Payment token:** USDC (6 decimals ERC-20 view)

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.x
- [Foundry](https://getfoundry.sh)

### Install

```bash
bun install
```

### Environment Variables

None required for local development. The following are provisioned automatically inside Arc Studio:

| Variable | Purpose |
|---|---|
| `RPC_PROXY_BASE_URL` | Arc Studio RPC proxy (optional outside Arc Studio) |
| `RPC_PROXY_TOKEN` | Arc Studio RPC proxy token (optional outside Arc Studio) |
| `RPC_PROXY_CHAINS` | Comma-separated proxy chain keys (optional outside Arc Studio) |

Never commit `.env` — it is in `.gitignore`.

### Run

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Test contracts

```bash
bun run contracts:test
```

### Lint + typecheck

```bash
bun run check
```

## Tidewatch integration

This contract is the payment layer for [Tidewatch](https://github.com/mee0120/tidewatch). Tidewatch publishes a signal each hour. Its agent wallet is set as the `provider` on the contract at deployment. Each publication calls `publishSignal` on-chain, providing the subscriber address, the signal value, a `bytes32` keccak256 commitment to the supporting evidence, and the `asOf` timestamp. The evidence hash lets subscribers verify the underlying data off-chain against the on-chain commitment.
