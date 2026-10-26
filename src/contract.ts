/**
 * SignalEscrow contract config.
 * Address is populated after deploy — see AGENTS.md.
 * Built with Arc Studio — https://studio.arc.io
 */

// Arc Mainnet deployment — owner + provider: 0x1355139697C0E7f449965De9264F718755A5E539
// Deploy tx: 0x3cb6fedc00a11ddd254547a086d6def000854a4906d6a7a1ccd2143e9354a191
export const SIGNAL_ESCROW_ADDRESS = '0xf49ad1e3d8bcb9c7678226faeefb521ac55988dc' as `0x${string}`
export const SIGNAL_ESCROW_DEPLOY_TX = '0x3cb6fedc00a11ddd254547a086d6def000854a4906d6a7a1ccd2143e9354a191'
export const CHAIN_ID = 5042 // Arc Mainnet
export const EXPLORER_BASE = 'https://explorer.arc.io'

// ABI is imported from the Foundry artifact after build
// For pre-deploy UI scaffolding, we inline the relevant fragments here.
export const SIGNAL_ESCROW_ABI = [
  // Events
  {
    type: 'event',
    name: 'SignalDelivered',
    inputs: [
      { name: 'subscriber', type: 'address', indexed: true },
      { name: 'signal', type: 'uint8', indexed: false },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
      { name: 'asOf', type: 'uint64', indexed: false },
      { name: 'price', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'subscriber', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'subscriber', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PriceSet',
    inputs: [
      { name: 'by', type: 'address', indexed: true },
      { name: 'newPrice', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EarningsWithdrawn',
    inputs: [
      { name: 'provider', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ProviderChanged',
    inputs: [
      { name: 'oldProvider', type: 'address', indexed: true },
      { name: 'newProvider', type: 'address', indexed: true },
    ],
  },
  // Reads
  {
    type: 'function',
    name: 'pricePerSignal',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'escrowBalance',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxPricePerSignal',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'providerEarnings',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'provider',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'MinIntervalSet',
    inputs: [
      { name: 'subscriber', type: 'address', indexed: true },
      { name: 'interval', type: 'uint64', indexed: false },
    ],
  },
  // New reads
  {
    type: 'function',
    name: 'lastAsOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'minInterval',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'DEFAULT_MIN_INTERVAL',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
  // Writes
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setMaxPricePerSignal',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'maxPrice', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setPricePerSignal',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'price', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'publishSignal',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'subscriber', type: 'address' },
      { name: 'signal', type: 'uint8' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'asOf', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawEarnings',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setMinInterval',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'interval', type: 'uint64' }],
    outputs: [],
  },
] as const
