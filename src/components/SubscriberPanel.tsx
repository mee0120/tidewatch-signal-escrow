/**
 * SubscriberPanel — deposit USDC escrow, set max price/interval, withdraw.
 * Two-step deposit: check live allowance → Approve if needed → Deposit.
 * Pre-flight simulation on all writes.
 */
import { useState } from 'react'
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useWatchBlockNumber, useSwitchChain, useConfig,
} from 'wagmi'
import { erc20Abi } from 'viem'
import { readContract } from '@wagmi/core'
import { toast } from 'sonner'
import { Wallet, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Clock, AlertTriangle, ExternalLink, CheckCircle2, Circle } from 'lucide-react'
import { getUsdc } from '@/onchain-facts'
import { parseAmount, usdcDecimalsFor, Amount } from '@/onchain-money'
import { SIGNAL_ESCROW_ADDRESS, SIGNAL_ESCROW_ABI, CHAIN_ID, EXPLORER_BASE } from '@/contract'
import { preSimulate } from '@/simulate'

const DEFAULT_INTERVAL = 3600
// gcTime:0 + staleTime:0 ensures no cross-chain stale data; wagmi also scopes by chainId
const NO_CACHE = { staleTime: 0, gcTime: 0, refetchOnMount: true } as const

function formatTimestamp(ts: bigint | undefined): string {
  if (ts === undefined || ts === 0n) return 'Never'
  return new Date(Number(ts) * 1000).toLocaleString()
}

function formatInterval(secs: bigint | undefined): string {
  if (secs === undefined || secs === 0n) return `${DEFAULT_INTERVAL}s (default)`
  const n = Number(secs)
  if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`
  if (n >= 60 && n % 60 === 0) return `${n / 60}m`
  return `${n}s`
}

// Step indicator for the two-step deposit flow
type DepositStep = 'idle' | 'approving' | 'approved' | 'depositing' | 'done'

function StepRow({ step, current }: { step: 1 | 2; current: DepositStep }) {
  const label = step === 1 ? '1. Approve USDC' : '2. Deposit'
  const done1 = current === 'approved' || current === 'depositing' || current === 'done'
  const done2 = current === 'done'
  const active = step === 1
    ? (current === 'approving')
    : (current === 'depositing' || current === 'approved')
  const done = step === 1 ? done1 : done2
  const color = done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--subtle)'
  return (
    <div className="flex items-center gap-1.5">
      {done
        ? <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
        : <Circle size={13} style={{ color, flexShrink: 0 }} />}
      <span className="text-xs font-medium" style={{ color }}>{label}</span>
    </div>
  )
}

export function SubscriberPanel() {
  const { address, chainId: walletChainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wagmiConfig = useConfig()
  const [depositInput, setDepositInput] = useState('')
  const [maxPriceInput, setMaxPriceInput] = useState('')
  const [intervalInput, setIntervalInput] = useState('')
  const [simulating, setSimulating] = useState(false)
  const [depositStep, setDepositStep] = useState<DepositStep>('idle')

  const isWrongChain = !!address && walletChainId !== CHAIN_ID
  const zero = '0x0000000000000000000000000000000000000000' as `0x${string}`

  const usdcFact = getUsdc(CHAIN_ID)
  const usdcAddress = usdcFact?.address as `0x${string}` | undefined
  const decimals = usdcDecimalsFor(CHAIN_ID)

  const { data: escrowBal, refetch: refetchEscrow } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
    functionName: 'escrowBalance', args: [address ?? zero],
    chainId: CHAIN_ID, query: { ...NO_CACHE, enabled: !!address },
  })
  const { data: maxPrice, refetch: refetchMax } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
    functionName: 'maxPricePerSignal', args: [address ?? zero],
    chainId: CHAIN_ID, query: { ...NO_CACHE, enabled: !!address },
  })
  const { data: contractPrice, refetch: refetchPrice } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
    functionName: 'pricePerSignal',
    chainId: CHAIN_ID, query: NO_CACHE,
  })
  const { data: lastAsOf, refetch: refetchLastAsOf } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
    functionName: 'lastAsOf', args: [address ?? zero],
    chainId: CHAIN_ID, query: { ...NO_CACHE, enabled: !!address },
  })
  const { data: storedInterval, refetch: refetchInterval } = useReadContract({
    address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
    functionName: 'minInterval', args: [address ?? zero],
    chainId: CHAIN_ID, query: { ...NO_CACHE, enabled: !!address },
  })

  useWatchBlockNumber({
    chainId: CHAIN_ID,
    onBlockNumber: () => {
      void refetchEscrow(); void refetchMax(); void refetchPrice()
      void refetchLastAsOf(); void refetchInterval()
    },
  })

  // --- Write hooks ---
  const { writeContract: approve, data: approveHash, isPending: approvePending } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash, chainId: CHAIN_ID })
  const { writeContract: deposit, data: depositHash, isPending: depositPending } = useWriteContract()
  const { isLoading: depositConfirming, isSuccess: depositSuccess } = useWaitForTransactionReceipt({ hash: depositHash, chainId: CHAIN_ID })
  const { writeContract: setMax, data: setMaxHash, isPending: setMaxPending } = useWriteContract()
  const { isLoading: setMaxConfirming } = useWaitForTransactionReceipt({ hash: setMaxHash, chainId: CHAIN_ID })
  const { writeContract: setIntervalTx, data: setIntervalHash, isPending: setIntervalPending } = useWriteContract()
  const { isLoading: setIntervalConfirming } = useWaitForTransactionReceipt({ hash: setIntervalHash, chainId: CHAIN_ID })
  const { writeContract: withdraw, data: withdrawHash, isPending: withdrawPending } = useWriteContract()
  const { isLoading: withdrawConfirming, isSuccess: withdrawSuccess } = useWaitForTransactionReceipt({ hash: withdrawHash, chainId: CHAIN_ID })

  // Silence unused variable lint (approveConfirmed drives depositStep via onSuccess)
  void approveConfirmed

  const requireChainSwitch = () => {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return false }
    return true
  }

  // -----------------------------------------------------------------------
  // Two-step deposit: read live allowance → approve if needed → deposit
  // -----------------------------------------------------------------------
  const handleDeposit = async () => {
    if (!requireChainSwitch() || !usdcAddress || !address || !depositInput) return
    let parsed: ReturnType<typeof parseAmount>
    try { parsed = parseAmount(CHAIN_ID, depositInput) } catch { toast.error('Invalid amount'); return }

    setDepositStep('idle')

    // 1. Read allowance fresh from chain — include chainId + spender in cache key
    setSimulating(true)
    let allowance: bigint
    try {
      allowance = await readContract(wagmiConfig, {
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, SIGNAL_ESCROW_ADDRESS],
        chainId: CHAIN_ID,
      })
    } catch {
      setSimulating(false)
      toast.error('Could not read USDC allowance — check your connection.')
      return
    }
    setSimulating(false)

    const depositArgs = {
      address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
      functionName: 'deposit' as const, args: [parsed.raw] as const, chainId: CHAIN_ID,
    }

    if (allowance >= parsed.raw) {
      // Allowance already sufficient — simulate then deposit directly
      setSimulating(true)
      const err = await preSimulate(wagmiConfig, depositArgs)
      setSimulating(false)
      if (err) { toast.error(err); return }

      setDepositStep('depositing')
      deposit(depositArgs, {
        onSuccess: () => {
          setDepositStep('done')
          toast.success('Deposited')
          setDepositInput('')
          void refetchEscrow()
        },
        onError: (e) => { setDepositStep('idle'); toast.error(String((e as Error).message ?? e)) },
      })
    } else {
      // Step 1: approve exactly the deposit amount
      setDepositStep('approving')
      approve(
        {
          address: usdcAddress, abi: erc20Abi,
          functionName: 'approve', args: [SIGNAL_ESCROW_ADDRESS, parsed.raw],
          chainId: CHAIN_ID,
        },
        {
          onSuccess: async () => {
            setDepositStep('approved')
            toast.info('Approval confirmed — simulating deposit…')

            // Step 2: simulate then deposit
            setSimulating(true)
            const err = await preSimulate(wagmiConfig, depositArgs)
            setSimulating(false)
            if (err) { setDepositStep('idle'); toast.error(err); return }

            setDepositStep('depositing')
            deposit(depositArgs, {
              onSuccess: () => {
                setDepositStep('done')
                toast.success('Deposited')
                setDepositInput('')
                void refetchEscrow()
              },
              onError: (e) => { setDepositStep('idle'); toast.error(String((e as Error).message ?? e)) },
            })
          },
          onError: (e) => { setDepositStep('idle'); toast.error(String((e as Error).message ?? e)) },
        }
      )
    }
  }

  const handleSetMax = async () => {
    if (!requireChainSwitch() || !maxPriceInput) return
    let parsed: ReturnType<typeof parseAmount>
    try { parsed = parseAmount(CHAIN_ID, maxPriceInput) } catch { toast.error('Invalid amount'); return }
    const args = {
      address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
      functionName: 'setMaxPricePerSignal' as const, args: [parsed.raw] as const, chainId: CHAIN_ID,
    }
    setSimulating(true)
    const err = await preSimulate(wagmiConfig, args)
    setSimulating(false)
    if (err) { toast.error(err); return }
    setMax(args, {
      onSuccess: () => { toast.success('Max price updated'); setMaxPriceInput(''); void refetchMax() },
      onError: (e) => toast.error(String((e as Error).message ?? e)),
    })
  }

  const handleSetInterval = async () => {
    if (!requireChainSwitch()) return
    const secs = parseInt(intervalInput, 10)
    if (!intervalInput || isNaN(secs) || secs < 0) {
      toast.error('Enter a valid number of seconds (0 = reset to default 3600)')
      return
    }
    const args = {
      address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
      functionName: 'setMinInterval' as const, args: [BigInt(secs)] as const, chainId: CHAIN_ID,
    }
    setSimulating(true)
    const err = await preSimulate(wagmiConfig, args)
    setSimulating(false)
    if (err) { toast.error(err); return }
    setIntervalTx(args, {
      onSuccess: () => { toast.success('Min interval updated'); setIntervalInput(''); void refetchInterval() },
      onError: (e) => toast.error(String((e as Error).message ?? e)),
    })
  }

  const handleWithdraw = async () => {
    if (!requireChainSwitch()) return
    const args = {
      address: SIGNAL_ESCROW_ADDRESS, abi: SIGNAL_ESCROW_ABI,
      functionName: 'withdraw' as const, args: [] as const, chainId: CHAIN_ID,
    }
    setSimulating(true)
    const err = await preSimulate(wagmiConfig, args)
    setSimulating(false)
    if (err) { toast.error(err); return }
    withdraw(args, {
      onSuccess: () => { toast.success('Withdrawal successful'); void refetchEscrow() },
      onError: (e) => toast.error(String((e as Error).message ?? e)),
    })
  }

  const formattedEscrow = escrowBal !== undefined ? Amount.fromRaw(escrowBal, decimals).toFixed(4) : '—'
  const formattedMax = maxPrice !== undefined ? Amount.fromRaw(maxPrice, decimals).toFixed(4) : '—'
  const formattedPrice = contractPrice !== undefined ? Amount.fromRaw(contractPrice, decimals).toFixed(4) : '—'

  const isDepositing = depositStep !== 'idle' && depositStep !== 'done'
  const needsApprove = depositStep === 'approving'
  const depositButtonLabel = simulating ? 'Checking…'
    : needsApprove ? 'Confirm approval…'
    : approvePending ? 'Confirm approval…'
    : approveConfirming ? 'Waiting for approval…'
    : depositPending ? 'Confirm deposit…'
    : depositConfirming ? 'Depositing…'
    : 'Deposit'

  const isBusy = simulating || isDepositing || approvePending || approveConfirming || depositPending || depositConfirming

  if (!address) {
    return (
      <div className="rounded-2xl p-6 flex flex-col gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Wallet size={18} style={{ color: 'var(--accent)' }} />
          <span className="display font-semibold text-sm tracking-wide uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>Subscriber</span>
        </div>
        <p className="text-sm" style={{ color: 'var(--subtle)' }}>Connect your wallet to manage your escrow.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet size={18} style={{ color: 'var(--accent)' }} />
          <span className="display font-semibold text-sm tracking-wide uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>Subscriber</span>
        </div>
        {isWrongChain && (
          <button
            onClick={() => switchChain({ chainId: CHAIN_ID })}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(232,109,122,0.15)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
          >
            <AlertTriangle size={11} /> Switch to Arc
          </button>
        )}
      </div>

      {/* Balances row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div className="rounded-xl p-3 flex flex-col gap-1" style={{ background: 'var(--surface-muted)', flex: '1 1 70px', minWidth: 0 }}>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Escrow</span>
          <span className="display font-semibold text-base tabular-nums truncate" style={{ color: 'var(--ink)' }}>{formattedEscrow}</span>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
        </div>
        <div className="rounded-xl p-3 flex flex-col gap-1" style={{ background: 'var(--surface-muted)', flex: '1 1 70px', minWidth: 0 }}>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Your Max</span>
          <span className="display font-semibold text-base tabular-nums truncate" style={{ color: 'var(--ink)' }}>{formattedMax}</span>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>per signal</span>
        </div>
        <div className="rounded-xl p-3 flex flex-col gap-1" style={{ background: 'var(--surface-muted)', flex: '1 1 70px', minWidth: 0 }}>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Price</span>
          <span className="display font-semibold text-base tabular-nums truncate" style={{ color: 'var(--accent)' }}>{formattedPrice}</span>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>per signal</span>
        </div>
      </div>

      {/* Rate-limit info */}
      <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-4" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Clock size={14} style={{ color: 'var(--accent)' }} />
          <div className="flex flex-col">
            <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Min Interval</span>
            <span className="text-sm tabular-nums" style={{ color: 'var(--ink)' }}>{formatInterval(storedInterval)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Last Signal</span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>{formatTimestamp(lastAsOf)}</span>
        </div>
      </div>

      {/* Deposit */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Deposit USDC</label>
        <div className="flex gap-2">
          <input
            type="number" min="0" step="0.01" placeholder="0.00"
            value={depositInput} onChange={(e) => { setDepositInput(e.target.value); setDepositStep('idle') }}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm tabular-nums outline-none"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          />
          <button
            onClick={() => { void handleDeposit() }}
            disabled={isBusy || !depositInput}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: '#0d1b2f', minHeight: 44 }}
          >
            <ArrowDownToLine size={15} />
            {depositButtonLabel}
          </button>
        </div>

        {/* Two-step stepper — visible once user clicks Deposit */}
        {depositStep !== 'idle' && (
          <div className="flex items-center gap-4 px-1">
            <StepRow step={1} current={depositStep} />
            <div style={{ width: 16, height: 1, background: 'var(--border)' }} />
            <StepRow step={2} current={depositStep} />
          </div>
        )}

        {depositSuccess && depositHash && (
          <a href={`${EXPLORER_BASE}/tx/${depositHash}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)', textDecoration: 'none' }}>
            Deposit confirmed <ExternalLink size={11} />
          </a>
        )}
      </div>

      {/* Set max price */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <ShieldCheck size={13} style={{ color: 'var(--accent)' }} />
          <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Max Price per Signal (USDC)</label>
        </div>
        <div className="flex gap-2">
          <input
            type="number" min="0" step="0.000001" placeholder="0.000100"
            value={maxPriceInput} onChange={(e) => setMaxPriceInput(e.target.value)}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm tabular-nums outline-none"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          />
          <button
            onClick={() => { void handleSetMax() }}
            disabled={simulating || setMaxPending || setMaxConfirming || !maxPriceInput}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border-strong)', minHeight: 44 }}
          >
            {simulating || setMaxPending || setMaxConfirming ? 'Checking…' : 'Set'}
          </button>
        </div>
      </div>

      {/* Set min interval */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Clock size={13} style={{ color: 'var(--accent)' }} />
          <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Min Interval (seconds, 0 = default 3600)</label>
        </div>
        <div className="flex gap-2">
          <input
            type="number" min="0" step="1" placeholder="3600"
            value={intervalInput} onChange={(e) => setIntervalInput(e.target.value)}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm tabular-nums outline-none"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          />
          <button
            onClick={() => { void handleSetInterval() }}
            disabled={simulating || setIntervalPending || setIntervalConfirming || !intervalInput}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border-strong)', minHeight: 44 }}
          >
            {simulating || setIntervalPending || setIntervalConfirming ? 'Checking…' : 'Set'}
          </button>
        </div>
      </div>

      {/* Withdraw */}
      <button
        onClick={() => { void handleWithdraw() }}
        disabled={simulating || withdrawPending || withdrawConfirming || !escrowBal || escrowBal === 0n}
        className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', minHeight: 44 }}
      >
        <ArrowUpFromLine size={15} />
        {simulating ? 'Checking…' : withdrawPending ? 'Confirm in wallet…' : withdrawConfirming ? 'Withdrawing…' : 'Withdraw All'}
      </button>
      {withdrawSuccess && withdrawHash && (
        <a href={`${EXPLORER_BASE}/tx/${withdrawHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--success)', textDecoration: 'none' }}>
          Withdrawal confirmed <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}
