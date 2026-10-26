/**
 * SignalFeed
 * - Scans SignalDelivered events from the deploy block, public viem client (no wallet needed).
 * - Sequential 1,000-block chunks, exponential backoff on rate-limit errors (max 5 retries).
 * - Caches events + last scanned block in localStorage; reloads only scan new blocks.
 * - "Total in Escrow" from USDC balanceOf(contract) — never depends on the log scan.
 * - No raw RPC errors shown to users; friendly Retrying… / retry button states.
 * Built with Arc Studio — https://studio.arc.io
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createPublicClient, http, parseAbiItem, erc20Abi,
  decodeEventLog, type AbiEvent,
} from 'viem'
import { Activity, ExternalLink, TrendingUp, DollarSign, Zap, RefreshCw } from 'lucide-react'
import { Amount, usdcDecimalsFor } from '@/onchain-money'
import { requireChain, getUsdc } from '@/onchain-facts'
import { SIGNAL_ESCROW_ADDRESS, CHAIN_ID, EXPLORER_BASE } from '@/contract'

// ── constants ─────────────────────────────────────────────────────────────────
const MAX_EVENTS   = 50
const DEPLOY_BLOCK = 27952418n
const CHUNK        = 1_000n
const POLL_MS      = 30_000
const CACHE_KEY    = `sigfeed-${CHAIN_ID}-${SIGNAL_ESCROW_ADDRESS.toLowerCase()}`

const SIGNAL_LABELS: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: 'WAIT',  color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  1: { label: 'BUY',   color: '#8dd89f', bg: 'rgba(141,216,159,0.15)' },
  2: { label: 'AVOID', color: '#e86d7a', bg: 'rgba(232,109,122,0.15)' },
}

// ── ABIs ──────────────────────────────────────────────────────────────────────
const SIG_ABI = parseAbiItem(
  'event SignalDelivered(address indexed subscriber, uint8 signal, bytes32 evidenceHash, uint64 asOf, uint256 price)'
)
// Keccak256 of the canonical event signature — used as topic0 filter in raw eth_getLogs
const SIG_TOPIC = '0x00baca6c2fd7380e4516b61c92e65619101faa3b609c20d1b57a549ca062b0d6' as const

// Raw RPC log shape returned by eth_getLogs
interface RawRpcLog {
  data:             `0x${string}`
  topics:           [`0x${string}`, ...`0x${string}`[]]
  transactionHash:  `0x${string}` | null
  blockNumber:      `0x${string}` | null
}

// ── types ─────────────────────────────────────────────────────────────────────
interface SignalEvent {
  subscriber:   string
  signal:       number
  evidenceHash: string
  asOf:         bigint
  price:        bigint
  blockNumber:  bigint
  txHash:       string
}
interface SerializedEvent {
  subscriber: string; signal: number; evidenceHash: string
  asOf: string; price: string; blockNumber: string; txHash: string
}
interface CacheEntry { lastBlock: string; events: SerializedEvent[] }

// ── static helpers ────────────────────────────────────────────────────────────
const decimals    = usdcDecimalsFor(CHAIN_ID)
const chainFacts  = requireChain(CHAIN_ID)
const usdcFact    = getUsdc(CHAIN_ID)
const IS_DEPLOYED = SIGNAL_ESCROW_ADDRESS !== '0x0000000000000000000000000000000000000000'

const arcChain = {
  id: CHAIN_ID,
  name: chainFacts.name,
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: chainFacts.rpcUrls as [string, ...string[]] } },
} as const

type PublicClient = ReturnType<typeof createPublicClient>

function formatAddr(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}` }
function explorerTx(h: string)  { return `${EXPLORER_BASE}/tx/${h}` }
function explorerAddr(a: string){ return `${EXPLORER_BASE}/address/${a}` }

function toSer(e: SignalEvent): SerializedEvent {
  return { ...e, asOf: e.asOf.toString(), price: e.price.toString(), blockNumber: e.blockNumber.toString() }
}
function fromSer(e: SerializedEvent): SignalEvent {
  return { ...e, asOf: BigInt(e.asOf), price: BigInt(e.price), blockNumber: BigInt(e.blockNumber) }
}

function readCache(): { lastBlock: bigint; events: SignalEvent[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CacheEntry
    return { lastBlock: BigInt(c.lastBlock), events: c.events.map(fromSer) }
  } catch { return null }
}
function writeCache(lastBlock: bigint, events: SignalEvent[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(
      { lastBlock: lastBlock.toString(), events: events.map(toSer) } satisfies CacheEntry
    ))
  } catch { /* storage full — ignore */ }
}

function isRateLimit(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return m.includes('rate limit') || m.includes('429') || m.includes('limit exceeded') ||
         m.includes('too many') || m.includes('exceeded') || m.includes('defined limit')
}

/**
 * Fetch getLogs for a single chunk with exponential backoff on rate-limit.
 * Uses eth_getLogs via a raw RPC call to sidestep viem's deep generic inference
 * while keeping full type safety on the decoded result.
 */
async function fetchSignalChunk(
  client: PublicClient,
  from: bigint,
  to: bigint,
  onRetry: (attempt: number) => void,
): Promise<SignalEvent[]> {
  const MAX_ATTEMPTS = 5
  let delay = 1_000
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Use request() so we control the exact payload and avoid TS overload hell.
      const raw = await client.request({
        method: 'eth_getLogs',
        params: [{
          address:   SIGNAL_ESCROW_ADDRESS,
          topics:    [SIG_TOPIC],
          fromBlock: `0x${from.toString(16)}`,
          toBlock:   `0x${to.toString(16)}`,
        }],
      }) as RawRpcLog[]

      return raw.map((l) => {
        const decoded = decodeEventLog({ abi: [SIG_ABI as AbiEvent], data: l.data, topics: l.topics })
        // decodeEventLog with a known ABI always returns a typed args object
        const a = decoded.args as {
          subscriber: `0x${string}`
          signal: number
          evidenceHash: `0x${string}`
          asOf: bigint
          price: bigint
        }
        return {
          subscriber:   a.subscriber,
          signal:       Number(a.signal),
          evidenceHash: a.evidenceHash,
          asOf:         BigInt(a.asOf),
          price:        BigInt(a.price),
          blockNumber:  l.blockNumber ? BigInt(l.blockNumber) : from,
          txHash:       l.transactionHash ?? '',
        }
      })
    } catch (e) {
      if (isRateLimit(e) && attempt < MAX_ATTEMPTS) {
        onRetry(attempt)
        await new Promise(r => setTimeout(r, delay))
        delay *= 2
        continue
      }
      throw e
    }
  }
  return []
}

// ── component ─────────────────────────────────────────────────────────────────
type FeedStatus = 'idle' | 'scanning' | 'retrying' | 'done' | 'error'

export function SignalFeed() {
  const [events,        setEvents]        = useState<SignalEvent[]>([])
  const [escrowBal,     setEscrowBal]     = useState<bigint | null>(null)
  const [totalSignals,  setTotalSignals]  = useState<number | null>(null)
  const [totalPaid,     setTotalPaid]     = useState<bigint | null>(null)
  const [status,        setStatus]        = useState<FeedStatus>(IS_DEPLOYED ? 'idle' : 'done')
  const [retryAttempt,  setRetryAttempt]  = useState(0)
  const abortRef = useRef(false)

  const scan = useCallback(async (force = false) => {
    if (!IS_DEPLOYED) return
    abortRef.current = false
    setStatus('scanning')
    setRetryAttempt(0)

    const client = createPublicClient({
      chain:     arcChain,
      transport: http(chainFacts.rpcUrls[0], { timeout: 20_000 }),
    })

    try {
      // 1. USDC balanceOf(contract) — independent, instant, never rate-limited by range
      if (usdcFact?.address) {
        const bal = await client.readContract({
          address:      usdcFact.address as `0x${string}`,
          abi:          erc20Abi,
          functionName: 'balanceOf',
          args:         [SIGNAL_ESCROW_ADDRESS],
        })
        setEscrowBal(bal)
      }

      // 2. Sequential chunked log scan from deploy block (cache-aware)
      const head      = await client.getBlockNumber()
      const cache     = force ? null : readCache()
      const scanFrom  = cache ? cache.lastBlock + 1n : DEPLOY_BLOCK
      let accumulated = cache ? cache.events : []

      if (scanFrom <= head) {
        let cursor = scanFrom
        while (cursor <= head) {
          if (abortRef.current) return
          const chunkTo = cursor + CHUNK - 1n < head ? cursor + CHUNK - 1n : head

          const chunk = await fetchSignalChunk(
            client, cursor, chunkTo,
            (attempt) => { setStatus('retrying'); setRetryAttempt(attempt) },
          )

          accumulated = [...accumulated, ...chunk]
          // Surface partial results immediately so the feed isn't blank while scanning
          if (chunk.length > 0) {
            const sorted = [...accumulated].reverse().slice(0, MAX_EVENTS)
            setEvents(sorted)
            setTotalSignals(accumulated.length)
            setTotalPaid(accumulated.reduce((s, e) => s + e.price, 0n))
          }

          cursor = chunkTo + 1n
        }

        writeCache(head, accumulated)
      }

      // 3. Final totals
      const paid = accumulated.reduce((s, e) => s + e.price, 0n)
      setTotalPaid(paid)
      setTotalSignals(accumulated.length)
      setEvents([...accumulated].reverse().slice(0, MAX_EVENTS))
      setStatus('done')

    } catch (e) {
      console.error('[SignalFeed] scan error:', e)
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!IS_DEPLOYED) return
    // Defer the first scan out of the synchronous effect body to avoid setState-in-effect.
    const first = setTimeout(() => { void scan() }, 0)
    const id    = setInterval(() => { void scan() }, POLL_MS)
    return () => { abortRef.current = true; clearTimeout(first); clearInterval(id) }
  }, [scan])

  const isLoading = status === 'scanning' || status === 'retrying' || status === 'idle'
  const isError   = status === 'error'

  return (
    <div className="flex flex-col gap-4">

      {/* Stats row — visible without wallet */}
      {IS_DEPLOYED && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <StatCard icon={<DollarSign size={14} />} label="Total in Escrow"
            value={escrowBal !== null ? `${Amount.fromRaw(escrowBal, decimals).toFixed(4)} USDC` : '—'}
            loading={escrowBal === null} />
          <StatCard icon={<Zap size={14} />} label="Signals Delivered"
            value={totalSignals !== null ? String(totalSignals) : '—'}
            loading={totalSignals === null && isLoading} />
          <StatCard icon={<TrendingUp size={14} />} label="Total Paid to Provider"
            value={totalPaid !== null ? `${Amount.fromRaw(totalPaid, decimals).toFixed(4)} USDC` : '—'}
            loading={totalPaid === null && isLoading} />
        </div>
      )}

      {/* Feed card */}
      <div className="rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} style={{ color: 'var(--accent)' }} />
            <span className="display font-semibold text-sm tracking-wide uppercase"
              style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>Signal Feed</span>
          </div>
          <div className="flex items-center gap-2">
            {status === 'retrying' && (
              <span className="text-xs animate-pulse" style={{ color: '#f59e0b' }}>
                Retrying… ({retryAttempt}/5)
              </span>
            )}
            {status === 'scanning' && (
              <span className="text-xs animate-pulse" style={{ color: 'var(--subtle)' }}>Scanning…</span>
            )}
            <span className="w-2 h-2 rounded-full" style={{
              background: IS_DEPLOYED ? 'var(--success)' : 'var(--subtle)',
              boxShadow:  IS_DEPLOYED ? '0 0 6px var(--success)' : 'none',
            }} />
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>
              {IS_DEPLOYED ? 'Live' : 'Not deployed'}
            </span>
          </div>
        </div>

        {!IS_DEPLOYED && (
          <p className="text-sm text-center py-4" style={{ color: 'var(--subtle)' }}>
            Deploy the contract to see live signals here.
          </p>
        )}

        {IS_DEPLOYED && isLoading && events.length === 0 && (
          <p className="text-sm text-center py-4 animate-pulse" style={{ color: 'var(--subtle)' }}>
            Loading signal history…
          </p>
        )}

        {IS_DEPLOYED && isError && (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-sm" style={{ color: 'var(--subtle)' }}>
              Couldn't load signal history.
            </p>
            <button
              onClick={() => { void scan(true) }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border-strong)' }}
            >
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}

        {IS_DEPLOYED && !isError && events.length === 0 && !isLoading && (
          <p className="text-sm text-center py-4" style={{ color: 'var(--subtle)' }}>
            No signals yet.
          </p>
        )}

        {IS_DEPLOYED && events.length > 0 && (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
            {events.map((ev, i) => {
              const badge    = SIGNAL_LABELS[ev.signal] ?? { label: String(ev.signal), color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' }
              const priceStr = Amount.fromRaw(ev.price, decimals).toFixed(6)
              const timeStr  = new Date(Number(ev.asOf) * 1000).toLocaleString()
              return (
                <div key={`${ev.txHash}-${i}`}
                  className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="rounded-md px-2 py-0.5 text-xs font-bold shrink-0"
                      style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.color}40` }}>
                      {badge.label}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <a href={explorerAddr(ev.subscriber)} target="_blank" rel="noopener noreferrer"
                        className="mono text-xs truncate" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        {formatAddr(ev.subscriber)}
                      </a>
                      <span className="mono text-xs truncate" style={{ color: 'var(--subtle)' }} title={ev.evidenceHash}>
                        {ev.evidenceHash.slice(0, 14)}…
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0 gap-0.5">
                    <span className="text-xs tabular-nums" style={{ color: 'var(--ink)' }}>{priceStr} USDC</span>
                    <span className="text-xs" style={{ color: 'var(--subtle)' }}>{timeStr}</span>
                    {ev.txHash && (
                      <a href={explorerTx(ev.txHash)} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs"
                        style={{ color: 'var(--subtle)', textDecoration: 'none' }}>
                        tx <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, loading }: {
  icon: React.ReactNode; label: string; value: string; loading: boolean
}) {
  return (
    <div className="rounded-2xl px-4 py-3 flex flex-col gap-1"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', flex: '1 1 140px', minWidth: '140px' }}>
      <div className="flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
        {icon}
        <span className="text-xs" style={{ color: 'var(--subtle)' }}>{label}</span>
      </div>
      <span className="display font-semibold text-base tabular-nums"
        style={{ color: loading ? 'var(--subtle)' : 'var(--ink)' }}>
        {loading ? '—' : value}
      </span>
    </div>
  )
}
