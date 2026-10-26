/**
 * DeployPage — deploys SignalEscrow from the connected MetaMask wallet.
 *
 * Flow:
 *  1. Wallet must be on Arc mainnet (chain 5042). Shows a Switch button otherwise.
 *  2. Estimates gas via eth_estimateGas and displays cost in USDC.
 *  3. On confirm, calls deployContract (wagmi) with compiled bytecode + ABI.
 *  4. Shows tx hash + deployed address with link to explorer.arc.io.
 *
 * Built with Arc Studio — https://studio.arc.io
 */

import { useState, useEffect } from 'react'
import { useAccount, useSwitchChain, usePublicClient, useWalletClient } from 'wagmi'
import { waitForTransactionReceipt } from '@wagmi/core'
import { type Abi, formatUnits, encodeDeployData } from 'viem'
import { toast } from 'sonner'
import { Rocket, AlertTriangle, CheckCircle, ExternalLink, Loader } from 'lucide-react'
import { config } from '@/config'
import { requireChain } from '@/onchain-facts'

// ---------------------------------------------------------------------------
// Compiled bytecode from contracts/out/SignalEscrow.sol/SignalEscrow.json
// Regenerate with: forge build
// ---------------------------------------------------------------------------
import ARTIFACT from '../../contracts/out/SignalEscrow.sol/SignalEscrow.json'

const ARC_MAINNET_ID = 5042
const ARC_MAINNET_USDC = '0x3600000000000000000000000000000000000000' as const
const arcFacts = requireChain(ARC_MAINNET_ID)

type DeployState =
  | { status: 'idle' }
  | { status: 'estimating' }
  | { status: 'ready'; gasEst: bigint; gasPrice: bigint }
  | { status: 'deploying' }
  | { status: 'confirming'; txHash: `0x${string}` }
  | { status: 'done'; txHash: `0x${string}`; contractAddress: `0x${string}` }
  | { status: 'error'; message: string }

export function DeployPage() {
  const { address, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_ID })
  const { data: walletClient } = useWalletClient({ chainId: ARC_MAINNET_ID })

  const [state, setState] = useState<DeployState>({ status: 'idle' })
  const [gasPriceGwei, setGasPriceGwei] = useState<bigint | null>(null)

  const isConnected = !!address
  const isRightChain = chainId === ARC_MAINNET_ID

  // Fetch gas price on mount / chain change for display
  useEffect(() => {
    if (!isRightChain || !publicClient) return
    publicClient.getGasPrice().then(p => setGasPriceGwei(p)).catch(() => null)
  }, [isRightChain, publicClient])

  const handleEstimate = async () => {
    if (!address || !publicClient) return
    setState({ status: 'estimating' })
    try {
      const deployData = encodeDeployData({
        abi: ARTIFACT.abi as Abi,
        bytecode: ARTIFACT.bytecode.object as `0x${string}`,
        args: [ARC_MAINNET_USDC, address, address],
      })
      const [gasEst, gasPrice] = await Promise.all([
        publicClient.estimateGas({ account: address, data: deployData }),
        publicClient.getGasPrice(),
      ])
      setState({ status: 'ready', gasEst, gasPrice })
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? 'Gas estimation failed.'
      setState({ status: 'error', message: msg })
    }
  }

  const handleDeploy = async () => {
    if (!address || !walletClient) {
      toast.error('Wallet not available.')
      return
    }
    setState({ status: 'deploying' })
    try {
      // Encode deploy data manually so we avoid overload-inference issues
      // with the JSON artifact ABI type, then send via walletClient.
      const deployData = encodeDeployData({
        abi: ARTIFACT.abi as Abi,
        bytecode: ARTIFACT.bytecode.object as `0x${string}`,
        args: [ARC_MAINNET_USDC, address, address],
      })
      const txHash = await walletClient.sendTransaction({
        data: deployData,
        chain: null, // walletClient is already locked to ARC_MAINNET_ID via useWalletClient
        account: address,
      })
      setState({ status: 'confirming', txHash })

      const receipt = await waitForTransactionReceipt(config, {
        hash: txHash,
        chainId: ARC_MAINNET_ID,
      })

      if (!receipt.contractAddress) {
        setState({ status: 'error', message: 'Contract address missing from receipt.' })
        return
      }
      setState({ status: 'done', txHash, contractAddress: receipt.contractAddress })
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? 'Deployment failed.'
      if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('denied')) {
        setState({ status: 'idle' })
        toast.info('Transaction cancelled.')
      } else {
        setState({ status: 'error', message: msg })
      }
    }
  }

  const txUrl = (hash: string) => `${arcFacts.explorerBase}/tx/${hash}`
  const addrUrl = (addr: string) => `${arcFacts.explorerBase}/address/${addr}`

  // ── Gas cost display ────────────────────────────────────────────────────
  // Arc native USDC has 18 decimals (gas view), same pool as ERC-20 6-decimal.
  // formatUnits(gasEst * gasPrice, 18) gives the cost in USDC.
  function fmtGasCost(gasEst: bigint, gasPrice: bigint): string {
    const weiCost = gasEst * gasPrice
    const usdc = parseFloat(formatUnits(weiCost, 18))
    if (usdc < 0.0001) return '< 0.0001 USDC'
    return `${usdc.toFixed(6)} USDC`
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      <main style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem' }}>
        <div
          className="rounded-2xl p-6 flex flex-col gap-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '100%', maxWidth: '520px' }}
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <Rocket size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div>
              <h2 className="display font-semibold text-lg" style={{ color: 'var(--ink)' }}>
                Deploy SignalEscrow
              </h2>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                Arc Mainnet · Chain ID {ARC_MAINNET_ID}
              </p>
            </div>
          </div>

          {/* Not connected */}
          {!isConnected && (
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
              <p className="text-sm" style={{ color: 'var(--subtle)' }}>Connect your wallet to deploy.</p>
            </div>
          )}

          {/* Wrong chain */}
          {isConnected && !isRightChain && (
            <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid var(--danger)' }}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                <span className="text-sm font-medium" style={{ color: 'var(--danger)' }}>
                  Switch to Arc Mainnet (chain {ARC_MAINNET_ID})
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                Your wallet is on chain {chainId ?? '—'}. The deployment must be sent on Arc Mainnet where gas is paid in real USDC.
              </p>
              <button
                onClick={() => switchChain({ chainId: ARC_MAINNET_ID })}
                disabled={switching}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--danger)', color: '#fff', alignSelf: 'flex-start', minHeight: 40 }}
              >
                {switching ? 'Switching…' : 'Switch to Arc Mainnet'}
              </button>
            </div>
          )}

          {/* Constructor args — read-only display */}
          {isConnected && isRightChain && (
            <>
              <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
                  Constructor Arguments
                </p>
                {[
                  { label: 'usdcToken', value: ARC_MAINNET_USDC, note: 'Arc Mainnet USDC (fixed)' },
                  { label: 'initialProvider', value: address, note: 'Your connected wallet' },
                  { label: 'owner', value: address, note: 'Your connected wallet' },
                ].map(({ label, value, note }) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-xs" style={{ color: 'var(--subtle)' }}>{label}</span>
                    <span className="text-xs font-mono truncate" style={{ color: 'var(--ink)' }}>{value}</span>
                    <span className="text-xs" style={{ color: 'var(--subtle)', fontStyle: 'italic' }}>{note}</span>
                  </div>
                ))}
              </div>

              {/* Mainnet warning */}
              <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.3)' }}>
                <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  <strong style={{ color: 'var(--danger)' }}>Mainnet deployment.</strong> This sends a real transaction on Arc Mainnet using real USDC for gas. Contracts are immutable once deployed. Verify constructor args above before proceeding.
                </p>
              </div>

              {/* Gas estimate */}
              {state.status === 'idle' && (
                <button
                  onClick={() => { void handleEstimate() }}
                  className="rounded-xl py-3 text-sm font-semibold transition-colors"
                  style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border-strong)', minHeight: 44 }}
                >
                  Estimate Gas
                </button>
              )}

              {state.status === 'estimating' && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: 'var(--surface-muted)' }}>
                  <Loader size={15} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
                  <span className="text-sm" style={{ color: 'var(--subtle)' }}>Estimating gas…</span>
                </div>
              )}

              {state.status === 'ready' && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs" style={{ color: 'var(--subtle)' }}>Estimated gas cost</span>
                      <span className="display font-semibold text-xl tabular-nums" style={{ color: 'var(--success)' }}>
                        {fmtGasCost(state.gasEst, state.gasPrice)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 items-end">
                      <span className="text-xs" style={{ color: 'var(--subtle)' }}>Gas units</span>
                      <span className="text-sm tabular-nums" style={{ color: 'var(--ink)' }}>{state.gasEst.toLocaleString()}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                      onClick={() => setState({ status: 'idle' })}
                      className="rounded-xl py-3 text-sm font-semibold transition-colors"
                      style={{ flex: '0 0 auto', padding: '0.75rem 1.25rem', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', minHeight: 44 }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { void handleDeploy() }}
                      className="rounded-xl py-3 text-sm font-semibold transition-colors"
                      style={{ flex: 1, background: 'var(--accent)', color: '#0d1b2f', minHeight: 44 }}
                    >
                      Deploy on Arc Mainnet
                    </button>
                  </div>
                </div>
              )}

              {(state.status === 'deploying' || state.status === 'confirming') && (
                <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: 'var(--surface-muted)' }}>
                  <Loader size={16} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                      {state.status === 'deploying' ? 'Confirm in your wallet…' : 'Waiting for confirmation…'}
                    </span>
                    {state.status === 'confirming' && (
                      <a
                        href={txUrl(state.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs flex items-center gap-1"
                        style={{ color: 'var(--accent)' }}
                      >
                        View tx <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {state.status === 'error' && (
                <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid var(--danger)' }}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={15} style={{ color: 'var(--danger)' }} />
                    <span className="text-sm font-medium" style={{ color: 'var(--danger)' }}>Deployment failed</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>{state.message}</p>
                  <button
                    onClick={() => setState({ status: 'idle' })}
                    className="text-xs rounded-lg px-3 py-1.5 self-start"
                    style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    Try again
                  </button>
                </div>
              )}

              {state.status === 'done' && (
                <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(141,216,159,0.08)', border: '1px solid var(--success)' }}>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={16} style={{ color: 'var(--success)' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Deployed successfully</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs" style={{ color: 'var(--subtle)' }}>Contract address</span>
                      <a
                        href={addrUrl(state.contractAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono flex items-center gap-1 break-all"
                        style={{ color: 'var(--accent)' }}
                      >
                        {state.contractAddress} <ExternalLink size={11} style={{ flexShrink: 0 }} />
                      </a>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs" style={{ color: 'var(--subtle)' }}>Transaction</span>
                      <a
                        href={txUrl(state.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono flex items-center gap-1 break-all"
                        style={{ color: 'var(--subtle)' }}
                      >
                        {state.txHash} <ExternalLink size={11} style={{ flexShrink: 0 }} />
                      </a>
                    </div>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                    Copy the contract address above. Update <code style={{ color: 'var(--accent)' }}>src/contract.ts</code> with it and redeploy the app to point to your live contract.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Gas price info bar */}
          {isConnected && isRightChain && gasPriceGwei !== null && state.status !== 'done' && (
            <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
              Current gas price: {formatUnits(gasPriceGwei, 9)} gwei
            </p>
          )}
        </div>
      </main>

      {/* Spinner keyframe — injected once */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
