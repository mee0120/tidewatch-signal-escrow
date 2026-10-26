import { useState } from 'react'
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useWatchBlockNumber, useSwitchChain, useConfig,
} from 'wagmi'
import { isAddress, keccak256, toBytes } from 'viem'
import { toast } from 'sonner'
import { Radio, DollarSign, ArrowUpFromLine, Send, AlertTriangle, Clock, ExternalLink } from 'lucide-react'
import { parseAmount, usdcDecimalsFor, Amount } from '@/onchain-money'
import { SIGNAL_ESCROW_ADDRESS, SIGNAL_ESCROW_ABI, CHAIN_ID, EXPLORER_BASE } from '@/contract'
import { preSimulate } from '@/simulate'


const QUERY_OPTS = { staleTime: 0, refetchOnMount: true } as const
const DEFAULT_INTERVAL = 3600n

const SIGNAL_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'WAIT', color: '#94a3b8' },
  1: { label: 'BUY', color: '#8dd89f' },
  2: { label: 'AVOID', color: '#e86d7a' },
}

function formatTime(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleTimeString()
}

export function ProviderPanel() {
  const { address, chainId: walletChainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wagmiConfig = useConfig()

  const [priceInput, setPriceInput] = useState('')
  const [signalValue, setSignalValue] = useState<number>(0)
  const [subscriberInput, setSubscriberInput] = useState('')
  const [evidenceInput, setEvidenceInput] = useState('')
  const [simulating, setSimulating] = useState(false)

  const isWrongChain = !!address && walletChainId !== CHAIN_ID

  // Normalize subscriber address for reads (fallback to zero address when invalid)
  const subscriberAddr: `0x${string}` = isAddress(subscriberInput)
    ? subscriberInput
    : '0x0000000000000000000000000000000000000000'

  // --- Contract reads ---
  const { data: earnings, refetch: refetchEarnings } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS,
    abi: SIGNAL_ESCROW_ABI,
    functionName: 'providerEarnings',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: CHAIN_ID,
    query: { ...QUERY_OPTS, enabled: !!address },
  })

  const { data: currentPrice, refetch: refetchPrice } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS,
    abi: SIGNAL_ESCROW_ABI,
    functionName: 'pricePerSignal',
    chainId: CHAIN_ID,
    query: QUERY_OPTS,
  })

  const { data: providerAddr } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS,
    abi: SIGNAL_ESCROW_ABI,
    functionName: 'provider',
    chainId: CHAIN_ID,
    query: QUERY_OPTS,
  })

  // Subscriber's lastAsOf — for "next publish allowed" display
  const { data: subLastAsOf, refetch: refetchSubLastAsOf } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS,
    abi: SIGNAL_ESCROW_ABI,
    functionName: 'lastAsOf',
    args: [subscriberAddr],
    chainId: CHAIN_ID,
    query: { ...QUERY_OPTS, enabled: isAddress(subscriberInput) },
  })

  // Subscriber's minInterval — 0 means DEFAULT_INTERVAL
  const { data: subMinInterval } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS,
    abi: SIGNAL_ESCROW_ABI,
    functionName: 'minInterval',
    args: [subscriberAddr],
    chainId: CHAIN_ID,
    query: { ...QUERY_OPTS, enabled: isAddress(subscriberInput) },
  })

  // Subscriber's escrow balance — to catch InsufficientBalance before signing
  const { data: subEscrow } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS,
    abi: SIGNAL_ESCROW_ABI,
    functionName: 'escrowBalance',
    args: [subscriberAddr],
    chainId: CHAIN_ID,
    query: { ...QUERY_OPTS, enabled: isAddress(subscriberInput) },
  })

  // Subscriber's maxPrice — to catch PriceExceedsMax before signing
  const { data: subMaxPrice } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS,
    abi: SIGNAL_ESCROW_ABI,
    functionName: 'maxPricePerSignal',
    args: [subscriberAddr],
    chainId: CHAIN_ID,
    query: { ...QUERY_OPTS, enabled: isAddress(subscriberInput) },
  })

  const isProvider = address && providerAddr
    && address.toLowerCase() === (providerAddr as string).toLowerCase()

  // Compute next-allowed timestamp for selected subscriber.
  // nowSec is a stable constant for this render cycle (not called inside JSX).
  const effectiveInterval = (subMinInterval !== undefined && subMinInterval !== 0n)
    ? subMinInterval
    : DEFAULT_INTERVAL
  const nextAllowedAt: bigint | undefined = (subLastAsOf !== undefined && isAddress(subscriberInput))
    ? (subLastAsOf === 0n ? undefined : subLastAsOf + effectiveInterval)
    : undefined
  // eslint-disable-next-line react-compiler/react-compiler
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const tooSoon = nextAllowedAt !== undefined && nowSec < nextAllowedAt

  // Refresh all reads on every new block
  useWatchBlockNumber({
    chainId: CHAIN_ID,
    onBlockNumber: () => {
      void refetchEarnings()
      void refetchPrice()
      void refetchSubLastAsOf()
    },
  })

  // --- Write hooks ---
  const { writeContract: setPrice, data: setPriceHash, isPending: setPricePending } = useWriteContract()
  const { isLoading: setPriceConfirming } = useWaitForTransactionReceipt({ hash: setPriceHash, chainId: CHAIN_ID })

  const { writeContract: publish, data: publishHash, isPending: publishPending } = useWriteContract()
  const { isLoading: publishConfirming, isSuccess: publishSuccess } = useWaitForTransactionReceipt({ hash: publishHash, chainId: CHAIN_ID })

  const { writeContract: withdrawEarnings, data: withdrawHash, isPending: withdrawPending } = useWriteContract()
  const { isLoading: withdrawConfirming, isSuccess: withdrawSuccess } = useWaitForTransactionReceipt({ hash: withdrawHash, chainId: CHAIN_ID })

  const decimals = usdcDecimalsFor(CHAIN_ID)

  const requireChainSwitch = () => {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return false }
    return true
  }

  // --- Handlers with pre-flight simulation ---

  const handleSetPrice = async () => {
    if (!requireChainSwitch() || !priceInput) return
    let parsed
    try { parsed = parseAmount(CHAIN_ID, priceInput) } catch { toast.error('Invalid amount'); return }

    const args = {
      address: SIGNAL_ESCROW_ADDRESS,
      abi: SIGNAL_ESCROW_ABI,
      functionName: 'setPricePerSignal' as const,
      args: [parsed.raw] as const,
      chainId: CHAIN_ID,
    }
    setSimulating(true)
    const err = await preSimulate(wagmiConfig, args)
    setSimulating(false)
    if (err) { toast.error(err); return }

    setPrice(args, {
      onSuccess: () => { toast.success('Price updated'); setPriceInput(''); void refetchPrice() },
      onError: (e) => toast.error(String((e as Error).message ?? e)),
    })
  }

  const handlePublish = async () => {
    if (!requireChainSwitch()) return
    if (!isAddress(subscriberInput)) { toast.error('Invalid subscriber address'); return }
    if (tooSoon && nextAllowedAt) {
      toast.error(`Too soon — next publish allowed after ${formatTime(nextAllowedAt)}.`)
      return
    }

    // eslint-disable-next-line react-compiler/react-compiler
    const now = BigInt(Math.floor(Date.now() / 1000))
    // eslint-disable-next-line react-compiler/react-compiler
    const evidenceHash = keccak256(toBytes(evidenceInput || `tidewatch-${String(Date.now())}`))

    // Client-side pre-checks to give instant feedback before simulation
    if (currentPrice !== undefined && subMaxPrice !== undefined && currentPrice > subMaxPrice) {
      toast.error(`Price ${Amount.fromRaw(currentPrice, decimals).toFixed(6)} USDC exceeds subscriber max ${Amount.fromRaw(subMaxPrice, decimals).toFixed(6)} USDC.`)
      return
    }
    if (currentPrice !== undefined && subEscrow !== undefined && subEscrow < currentPrice) {
      toast.error(`Subscriber escrow (${Amount.fromRaw(subEscrow, decimals).toFixed(4)} USDC) is below the current price.`)
      return
    }

    const args = {
      address: SIGNAL_ESCROW_ADDRESS,
      abi: SIGNAL_ESCROW_ABI,
      functionName: 'publishSignal' as const,
      args: [subscriberInput, signalValue, evidenceHash, now] as const,
      chainId: CHAIN_ID,
    }

    setSimulating(true)
    const err = await preSimulate(wagmiConfig, args)
    setSimulating(false)
    if (err) { toast.error(err); return }

    publish(args, {
      onSuccess: () => {
        toast.success(`Signal published: ${SIGNAL_LABELS[signalValue].label}`)
        setSubscriberInput('')
        setEvidenceInput('')
        void refetchEarnings()
        void refetchSubLastAsOf()
      },
      onError: (e) => toast.error(String((e as Error).message ?? e)),
    })
  }

  const handleWithdraw = async () => {
    if (!requireChainSwitch()) return
    const args = {
      address: SIGNAL_ESCROW_ADDRESS,
      abi: SIGNAL_ESCROW_ABI,
      functionName: 'withdrawEarnings' as const,
      args: [] as const,
      chainId: CHAIN_ID,
    }
    setSimulating(true)
    const err = await preSimulate(wagmiConfig, args)
    setSimulating(false)
    if (err) { toast.error(err); return }

    withdrawEarnings(args, {
      onSuccess: () => { toast.success('Earnings withdrawn'); void refetchEarnings() },
      onError: (e) => toast.error(String((e as Error).message ?? e)),
    })
  }

  const formattedEarnings = earnings !== undefined
    ? Amount.fromRaw(earnings, decimals).toFixed(4) : '—'
  const formattedCurrentPrice = currentPrice !== undefined
    ? Amount.fromRaw(currentPrice, decimals).toFixed(6) : '—'

  const publishDisabled = publishPending || publishConfirming || simulating
    || !isAddress(subscriberInput) || tooSoon
  const anyBusy = simulating || setPricePending || setPriceConfirming
    || publishPending || publishConfirming || withdrawPending || withdrawConfirming

  if (!address) {
    return (
      <div className="rounded-2xl p-6 flex flex-col gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Radio size={18} style={{ color: 'var(--accent)' }} />
          <span className="display font-semibold text-sm tracking-wide uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>Provider</span>
        </div>
        <p className="text-sm" style={{ color: 'var(--subtle)' }}>Connect your wallet to access provider controls.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={18} style={{ color: 'var(--accent)' }} />
          <span className="display font-semibold text-sm tracking-wide uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>Provider</span>
        </div>
        <div className="flex items-center gap-2">
          {isWrongChain && (
            <button
              onClick={() => switchChain({ chainId: CHAIN_ID })}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(232,109,122,0.15)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
            >
              <AlertTriangle size={11} /> Switch to Arc
            </button>
          )}
          {!isProvider && !isWrongChain && (
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'rgba(232,109,122,0.15)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
              Not the provider
            </span>
          )}
        </div>
      </div>

      {/* Earnings */}
      <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'var(--surface-muted)' }}>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Accumulated Earnings</span>
          <span className="display font-semibold text-2xl tabular-nums" style={{ color: 'var(--success)' }}>{formattedEarnings}</span>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Current Price</span>
          <span className="display font-semibold text-lg tabular-nums" style={{ color: 'var(--ink)' }}>{formattedCurrentPrice}</span>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC / signal</span>
        </div>
      </div>

      {/* Set price */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <DollarSign size={13} style={{ color: 'var(--accent)' }} />
          <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Set Price per Signal (USDC)</label>
        </div>
        <div className="flex gap-2">
          <input
            type="number" min="0" step="0.000001" placeholder="0.000100"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm tabular-nums outline-none"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          />
          <button
            onClick={() => { void handleSetPrice() }}
            disabled={anyBusy || !priceInput}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border-strong)', minHeight: 44 }}
          >
            {simulating || setPricePending || setPriceConfirming ? 'Checking…' : 'Set'}
          </button>
        </div>
      </div>

      {/* Publish signal */}
      <div className="flex flex-col gap-3 rounded-xl p-4" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Publish Signal</span>

        {/* Signal selector */}
        <div className="flex gap-2">
          {[0, 1, 2].map((s) => (
            <button
              key={s}
              onClick={() => setSignalValue(s)}
              className="flex-1 rounded-lg py-2 text-xs font-bold transition-all"
              style={{
                background: signalValue === s ? SIGNAL_LABELS[s].color + '30' : 'var(--surface)',
                color: SIGNAL_LABELS[s].color,
                border: `1px solid ${signalValue === s ? SIGNAL_LABELS[s].color : 'var(--border)'}`,
                minHeight: 36,
              }}
            >
              {SIGNAL_LABELS[s].label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Subscriber address (0x…)"
          value={subscriberInput}
          onChange={(e) => setSubscriberInput(e.target.value)}
          className="rounded-xl px-4 py-2.5 text-sm font-mono outline-none"
          style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}
        />

        {/* Next-allowed-at banner */}
        {isAddress(subscriberInput) && tooSoon && nextAllowedAt !== undefined ? (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(232,109,122,0.12)', border: '1px solid var(--danger)' }}>
            <Clock size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
            <span className="text-xs" style={{ color: 'var(--danger)' }}>
              Next publish allowed after <strong>{formatTime(nextAllowedAt)}</strong>
            </span>
          </div>
        ) : null}
        {isAddress(subscriberInput) && !tooSoon && subLastAsOf !== undefined && subLastAsOf > BigInt(0) ? (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(141,216,159,0.08)', border: '1px solid var(--success)' }}>
            <Clock size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
            <span className="text-xs" style={{ color: 'var(--success)' }}>
              Interval elapsed — publish ready
            </span>
          </div>
        ) : null}

        <input
          type="text"
          placeholder="Evidence (text, hashed automatically)"
          value={evidenceInput}
          onChange={(e) => setEvidenceInput(e.target.value)}
          className="rounded-xl px-4 py-2.5 text-sm outline-none"
          style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}
        />

        <button
          onClick={() => { void handlePublish() }}
          disabled={publishDisabled}
          className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: '#0d1b2f', minHeight: 44 }}
        >
          <Send size={15} />
          {simulating ? 'Checking…' : publishPending ? 'Confirm in wallet…' : publishConfirming ? 'Publishing…' : 'Publish Signal'}
        </button>
        {publishSuccess && publishHash && (
          <a href={`${EXPLORER_BASE}/tx/${publishHash}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--success)', textDecoration: 'none' }}>
            Signal published <ExternalLink size={11} />
          </a>
        )}
      </div>

      {/* Withdraw earnings */}
      <button
        onClick={() => { void handleWithdraw() }}
        disabled={anyBusy || !earnings || earnings === 0n}
        className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'transparent', color: 'var(--success)', border: '1px solid var(--success)', minHeight: 44 }}
      >
        <ArrowUpFromLine size={15} />
        {simulating || withdrawPending ? 'Checking…' : withdrawConfirming ? 'Withdrawing…' : 'Withdraw Earnings'}
      </button>
      {withdrawSuccess && withdrawHash && (
        <a href={`${EXPLORER_BASE}/tx/${withdrawHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--success)', textDecoration: 'none' }}>
          Earnings withdrawn <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}
