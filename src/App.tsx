/**
 * App — main layout with routing.
 * Routes:
 *   /        — subscriber + provider panels + signal feed
 *   /deploy  — mainnet deployment page
 *
 * Built with Arc Studio — https://studio.arc.io
 */

import { Routes, Route, Link } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { Waves, ExternalLink } from 'lucide-react'
import { SubscriberPanel } from './components/SubscriberPanel'
import { ProviderPanel } from './components/ProviderPanel'
import { SignalFeed } from './components/SignalFeed'
import { DeployPage } from './components/DeployPage'
import { SIGNAL_ESCROW_ADDRESS, SIGNAL_ESCROW_DEPLOY_TX, EXPLORER_BASE } from './contract'

function Header() {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between px-6 py-4"
      style={{ background: 'rgba(13,27,47,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2.5" style={{ textDecoration: 'none' }}>
          <Waves size={20} style={{ color: 'var(--accent)' }} />
          <span className="display font-semibold text-base" style={{ color: 'var(--ink)' }}>
            Tidewatch
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)', border: '1px solid rgba(172,198,233,0.2)' }}
          >
            Signal Escrow
          </span>
        </Link>
        {/* Mainnet live badge */}
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(141,216,159,0.12)', color: 'var(--success)', border: '1px solid rgba(141,216,159,0.3)' }}
        >
          Arc Mainnet
        </span>
      </div>
      <ConnectKitButton />
    </header>
  )
}

function HomePage() {
  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-6 py-6 flex flex-col gap-5">
      {/* Hero */}
      <div className="text-center py-2">
        <h1 className="display font-bold text-2xl sm:text-3xl mb-2" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
          Pay-per-signal USDC escrow
        </h1>
        <p className="text-sm max-w-lg mx-auto px-2" style={{ color: 'var(--subtle)' }}>
          Subscribers deposit USDC and set a max price cap. The Tidewatch agent publishes a signal (WAIT / BUY / AVOID) and charges each subscriber instantly, on-chain.
        </p>
      </div>

      {/* Two-panel layout
          flex-wrap: panels sit side-by-side above ~640px, stack below.
          minWidth:280px on each wrapper prevents collapse-to-zero (layout
          regression fix): flexbox wraps based on min-width, not flex-basis,
          so without it panels collapse even when ample space is available. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px', minWidth: '280px', width: '100%' }}>
          <SubscriberPanel />
        </div>
        <div style={{ flex: '1 1 300px', minWidth: '280px', width: '100%' }}>
          <ProviderPanel />
        </div>
      </div>

      {/* Signal feed */}
      <SignalFeed />

      {/* Contract info card */}
      <div
        className="rounded-2xl px-5 py-4 flex flex-col gap-2"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'rgba(141,216,159,0.12)', color: 'var(--success)', border: '1px solid rgba(141,216,159,0.3)' }}
          >
            Deployed on Arc Mainnet
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>Contract</span>
            <a
              href={`${EXPLORER_BASE}/address/${SIGNAL_ESCROW_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-xs flex items-center gap-1"
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
            >
              {SIGNAL_ESCROW_ADDRESS} <ExternalLink size={10} />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>Deploy tx</span>
            <a
              href={`${EXPLORER_BASE}/tx/${SIGNAL_ESCROW_DEPLOY_TX}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-xs flex items-center gap-1"
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
            >
              {SIGNAL_ESCROW_DEPLOY_TX.slice(0, 18)}… <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      <Header />

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/deploy" element={<DeployPage />} />
      </Routes>

      {/* Footer */}
      <footer className="text-center py-4 text-xs flex items-center justify-center gap-2" style={{ color: 'var(--subtle)' }}>
        <a href={`${EXPLORER_BASE}/address/${SIGNAL_ESCROW_ADDRESS}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1" style={{ color: 'var(--subtle)', textDecoration: 'none' }}>
          Arc Mainnet <ExternalLink size={10} />
        </a>
        · USDC escrow · No subscriptions
      </footer>
    </div>
  )
}
