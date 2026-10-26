/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { createConfig, http } from 'wagmi'
import { mainnet, type Chain } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected, coinbaseWallet } from 'wagmi/connectors'
import { requireChain } from './onchain-facts'
import { registerChain } from './tracing'

const arcTestFacts = requireChain(arcTestnet.id)
const arcMainFacts = requireChain(5042) // Arc Mainnet (not yet in viem/chains)

// Build a wagmi-compatible chain object for Arc Mainnet from onchain-facts
export const arcMainnet: Chain = {
  id: 5042,
  name: arcMainFacts.name,
  nativeCurrency: {
    name: 'USD Coin',
    symbol: arcMainFacts.nativeCurrency.symbol,
    decimals: arcMainFacts.nativeCurrency.decimals,
  },
  rpcUrls: {
    default: { http: arcMainFacts.rpcUrls },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: arcMainFacts.explorerBase },
  },
}

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestFacts.rpcUrls[0])
registerChain(arcMainnet.id, arcMainFacts.rpcUrls[0])

export const config = createConfig({
  chains: [arcTestnet, arcMainnet, mainnet],
  connectors: [
    injected(),                                      // MetaMask and other injected wallets
    coinbaseWallet({ appName: 'Tidewatch Signal Escrow' }),
  ],
  transports: {
    // Explicit RPC URLs — never rely on the default chain fallback
    [arcTestnet.id]: http(arcTestFacts.rpcUrls[0]),
    [arcMainnet.id]: http(arcMainFacts.rpcUrls[0]),
    [mainnet.id]: http(),                            // ENS resolution
  },
})
