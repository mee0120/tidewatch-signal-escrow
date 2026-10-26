# Tidewatch Signal Escrow

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app.

---

## What This App Does

Pay-per-signal USDC escrow for AI agent trading signals. Subscribers deposit USDC, set a max-price cap, and the Tidewatch provider publishes signals (WAIT/BUY/AVOID) that debit each subscriber on-chain instantly.

## Contract Deployments

| Contract | Chain | Address | Explorer |
|---|---|---|---|
| SignalEscrow v1 | Arc Testnet | 0x64511e1f5c5955ed0db5034b586fc730a56aee52 | https://explorer.testnet.arc.io/address/0x64511e1f5c5955ed0db5034b586fc730a56aee52 |
| SignalEscrow v2 | Arc Testnet | 0x325a115658cbdaa9989a10e3b6825f7331a38611 | https://explorer.testnet.arc.io/address/0x325a115658cbdaa9989a10e3b6825f7331a38611 |
| SignalEscrow v3 | Arc Testnet | 0xec5e91df6ed80d8113f51d91159b257d2c784302 | https://explorer.testnet.arc.io/address/0xec5e91df6ed80d8113f51d91159b257d2c784302 |
| SignalEscrow v3 **MAINNET (current)** | Arc Mainnet | 0xf49ad1e3d8bcb9c7678226faeefb521ac55988dc | https://explorer.arc.io/address/0xf49ad1e3d8bcb9c7678226faeefb521ac55988dc |

## Constructor Args (deploy)
- usdcToken: 0x3600000000000000000000000000000000000000 (Arc Testnet USDC)
- initialProvider: 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42 (platform deployer wallet)
- owner: 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42 (platform deployer wallet)

## Security Notes
- `usdc` is immutable; deposit measures actual received amount (fee-on-transfer safe)
- Provider rotation doesn't lock earnings: any address withdraws its own `providerEarnings[msg.sender]`
- 60/60 Foundry tests pass (Unit, Fuzz, Guards suites) — includes replay/interval/future/invalid-signal revert paths
- v2 adds: lastAsOf[subscriber], minInterval[subscriber], DEFAULT_MIN_INTERVAL=3600, setMinInterval(), InvalidSignal error, signal domain guard (>2 reverts)

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
