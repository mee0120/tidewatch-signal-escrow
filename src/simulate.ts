/**
 * Pre-flight simulation helpers for SignalEscrow contract writes.
 *
 * simulateAndWrite: calls simulateContract first. If the call would revert,
 * decodes the custom error and returns a human-readable message WITHOUT asking
 * the wallet to sign anything — zero gas wasted. Only calls writeContract on
 * a successful simulation.
 *
 * Built with Arc Studio — https://studio.arc.io
 */

import { type Config, simulateContract, type SimulateContractParameters } from '@wagmi/core'
import { type Abi, decodeErrorResult } from 'viem'

// ---------------------------------------------------------------------------
// Custom error decoders
// ---------------------------------------------------------------------------

/** Human-readable messages for all SignalEscrow custom errors. */
export function decodeContractError(abi: Abi, err: unknown): string {
  const raw = err as {
    message?: string
    cause?: { data?: `0x${string}`; message?: string }
    data?: `0x${string}`
  }

  // Try to decode from revert data first (most precise)
  const revertData: `0x${string}` | undefined =
    raw?.cause?.data ?? raw?.data ?? extractRevertData(raw?.message ?? '')

  if (revertData && revertData.length >= 10) {
    try {
      const decoded = decodeErrorResult({ abi, data: revertData })
      return humanizeError(decoded.errorName, decoded.args)
    } catch {
      // fall through to string matching
    }
  }

  // Fallback: match error name in the message string
  return matchErrorString(raw?.cause?.message ?? raw?.message ?? '')
}

function extractRevertData(msg: string): `0x${string}` | undefined {
  // viem wraps revert data like: "... data: 0xf2c5850e..."
  const m = msg.match(/data:\s*(0x[0-9a-fA-F]+)/)
  return m ? (m[1] as `0x${string}`) : undefined
}

function humanizeError(name: string, args: readonly unknown[] | undefined): string {
  switch (name) {
    case 'TooSoon': {
      const earliest = args?.[0] as bigint | undefined
      const ts = earliest ? new Date(Number(earliest) * 1000).toLocaleTimeString() : 'later'
      return `Too soon — next publish allowed after ${ts}.`
    }
    case 'SignalAlreadyDelivered': {
      const last = args?.[0] as bigint | undefined
      const ts = last ? new Date(Number(last) * 1000).toLocaleString() : 'the last signal'
      return `Signal already delivered at ${ts}. Use a later timestamp.`
    }
    case 'FutureAsOf':
      return 'Signal timestamp is in the future — use the current time or earlier.'
    case 'InvalidSignal':
      return 'Invalid signal value — must be WAIT (0), BUY (1), or AVOID (2).'
    case 'PriceExceedsMax': {
      const price = args?.[0] as bigint | undefined
      const max = args?.[1] as bigint | undefined
      return `Price ${price ?? '?'} exceeds subscriber max ${max ?? '?'}.`
    }
    case 'InsufficientBalance':
      return 'Subscriber escrow balance is too low.'
    case 'OnlyProvider':
      return 'Only the provider address can call this.'
    case 'ZeroAmount':
      return 'Amount must be greater than zero.'
    case 'ZeroAddress':
      return 'Address must not be zero.'
    default:
      return `Transaction would fail: ${name}.`
  }
}

function matchErrorString(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('user rejected') || m.includes('denied')) return 'Transaction cancelled.'
  if (m.includes('toosoon')) return 'Too soon — minimum interval not reached.'
  if (m.includes('signalalreadydelivered')) return 'Signal already delivered for this timestamp.'
  if (m.includes('futureasof')) return 'Signal timestamp is in the future.'
  if (m.includes('invalidsignal')) return 'Invalid signal value (must be 0, 1, or 2).'
  if (m.includes('priceexceedsmax')) return 'Price exceeds subscriber max.'
  if (m.includes('insufficientbalance')) return 'Subscriber escrow balance is too low.'
  if (m.includes('onlyprovider')) return 'Only the provider can call this.'
  if (m.includes('zeroamount')) return 'Amount must be greater than zero.'
  if (m.includes('reverted')) {
    const match = msg.match(/reason="([^"]+)"/)
    return match ? `Transaction failed: ${match[1]}` : 'Transaction failed.'
  }
  return 'Something went wrong. Please try again.'
}

// ---------------------------------------------------------------------------
// preSimulate
// ---------------------------------------------------------------------------

/**
 * Simulate a contract write on-chain before sending it to the wallet.
 * Returns null on success (call writeContract next).
 * Returns an error string if simulation reverts — show it to the user
 * and do NOT call writeContract.
 *
 * Uses SimulateContractParameters so no wallet account/chain is required —
 * simulation runs as a pure eth_call.
 */
export async function preSimulate(
  wagmiConfig: Config,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: SimulateContractParameters<any, any, any, any>,
): Promise<string | null> {
  try {
    await simulateContract(wagmiConfig, args)
    return null // simulation passed
  } catch (err) {
    return decodeContractError(args.abi as Abi, err)
  }
}
