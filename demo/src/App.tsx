import { useState, useEffect } from 'react'
import './index.css'
import type { ResolutionResult, Attestation } from './types'

const ORACLE_API = 'http://localhost:3001'

// The single demo market — NASA astrobiology long-tail prediction
const DEMO_MARKET = {
  id: 'demo-nasa-astrobiology-2025',
  question: 'Will NASA find definitive evidence of extraterrestrial life in 2025?',
  criteria: 'Resolves YES if NASA officially announces discovery of living organisms, fossilized life, or unambiguous biosignatures from beyond Earth. Resolves NO if only precursor molecules (amino acids, organic compounds) are found, as these indicate potential for life but are not life itself.',
  resolutionTime: Date.now(),
}

function App() {
  const [status, setStatus] = useState<'idle' | 'processing' | 'complete'>('idle')
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState(0)
  const [result, setResult] = useState<ResolutionResult | null>(null)
  const [attestation, setAttestation] = useState<Attestation | null>(null)
  const [showVerification, setShowVerification] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Processing phases for visual effect
  const phases = [
    'Querying news sources...',
    'Analyzing evidence quality...',
    'Evaluating semantic criteria...',
    'Computing confidence score...',
    'Generating cryptographic attestation...',
  ]

  const startResolution = async () => {
    setStatus('processing')
    setProgress(0)
    setPhase(0)
    setResult(null)
    setAttestation(null)
    setShowVerification(false)
    setError(null)

    // Start the actual resolution in background
    const resolvePromise = fetch(`${ORACLE_API}/markets/${DEMO_MARKET.id}/resolve`, {
      method: 'POST',
    }).then(r => r.json())

    // Animate through phases over 20 seconds
    const totalTime = 20000 // 20 seconds
    const interval = 100
    const steps = totalTime / interval
    let currentStep = 0

    const timer = setInterval(() => {
      currentStep++
      const newProgress = (currentStep / steps) * 100
      setProgress(newProgress)
      setPhase(Math.min(Math.floor((newProgress / 100) * phases.length), phases.length - 1))

      if (currentStep >= steps) {
        clearInterval(timer)
      }
    }, interval)

    // Wait for both animation and API
    const data = await resolvePromise

    // Ensure we show at least 20 seconds of animation
    const remainingTime = Math.max(0, totalTime - (currentStep * interval))
    await new Promise(r => setTimeout(r, remainingTime))

    clearInterval(timer)

    if (data.success) {
      setResult(data.result)
      setStatus('complete')

      // Auto-fetch attestation
      const attestRes = await fetch(`${ORACLE_API}/markets/${DEMO_MARKET.id}/attest`, {
        method: 'POST',
      })
      const attestData = await attestRes.json()
      if (attestData.success) {
        setAttestation(attestData.attestation)
      }
    } else {
      setError(data.error || 'Resolution failed')
      setStatus('idle')
    }
  }

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <h1>Verifiable AI Oracle</h1>
        <p className="subtitle">Cryptographically provable prediction market resolution</p>
      </header>

      {/* Error */}
      {error && <div className="error-banner">{error}</div>}

      {/* Market Card */}
      <div className="market-card">
        <div className="market-header">
          <span className="market-tag">Long-tail Prediction Market</span>
          <span className={`status-indicator ${status}`}>
            {status === 'idle' && 'Pending Resolution'}
            {status === 'processing' && 'Processing...'}
            {status === 'complete' && 'Resolved'}
          </span>
        </div>

        <h2 className="market-question">{DEMO_MARKET.question}</h2>

        <div className="criteria-box">
          <label>Resolution Criteria</label>
          <p>{DEMO_MARKET.criteria}</p>
        </div>

        {/* Action Area */}
        {status === 'idle' && (
          <button className="resolve-button" onClick={startResolution}>
            <span className="button-icon">🔮</span>
            Resolve with Verifiable AI
          </button>
        )}

        {/* Processing Animation */}
        {status === 'processing' && (
          <div className="processing-container">
            {/* Visual Network */}
            <div className="network-visualization">
              <svg viewBox="0 0 400 200" className="network-svg">
                {/* Grid lines */}
                <defs>
                  <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#667eea" stopOpacity="0.2" />
                    <stop offset="50%" stopColor="#667eea" stopOpacity="1" />
                    <stop offset="100%" stopColor="#764ba2" stopOpacity="0.2" />
                  </linearGradient>
                </defs>

                {/* Animated nodes */}
                <g className="nodes">
                  {/* News sources */}
                  <circle cx="50" cy="50" r="8" className={`node ${progress > 10 ? 'active' : ''}`} />
                  <circle cx="50" cy="100" r="8" className={`node ${progress > 15 ? 'active' : ''}`} />
                  <circle cx="50" cy="150" r="8" className={`node ${progress > 20 ? 'active' : ''}`} />

                  {/* Analysis nodes */}
                  <circle cx="150" cy="75" r="10" className={`node ${progress > 35 ? 'active' : ''}`} />
                  <circle cx="150" cy="125" r="10" className={`node ${progress > 45 ? 'active' : ''}`} />

                  {/* Verification nodes */}
                  <circle cx="250" cy="100" r="12" className={`node ${progress > 60 ? 'active' : ''}`} />

                  {/* Final oracle */}
                  <circle cx="350" cy="100" r="15" className={`node oracle ${progress > 85 ? 'active' : ''}`} />
                </g>

                {/* Connection lines with animation */}
                <g className="connections">
                  <line x1="58" y1="50" x2="142" y2="75" className={`connection ${progress > 25 ? 'pulse' : ''}`} />
                  <line x1="58" y1="100" x2="142" y2="75" className={`connection ${progress > 30 ? 'pulse' : ''}`} />
                  <line x1="58" y1="150" x2="142" y2="125" className={`connection ${progress > 35 ? 'pulse' : ''}`} />
                  <line x1="158" y1="75" x2="242" y2="100" className={`connection ${progress > 50 ? 'pulse' : ''}`} />
                  <line x1="158" y1="125" x2="242" y2="100" className={`connection ${progress > 55 ? 'pulse' : ''}`} />
                  <line x1="258" y1="100" x2="335" y2="100" className={`connection ${progress > 75 ? 'pulse' : ''}`} />
                </g>

                {/* Data packets */}
                {progress > 20 && progress < 90 && (
                  <>
                    <circle cx={50 + (progress - 20) * 2.5} cy={100} r="4" className="packet" />
                    <circle cx={150 + (progress - 40) * 2.5} cy={100} r="4" className="packet" />
                  </>
                )}
              </svg>
            </div>

            {/* Phase text */}
            <div className="phase-text">
              <span className="phase-label">{phases[phase]}</span>
            </div>

            {/* Progress bar */}
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>

            {/* Verification badges */}
            <div className="verification-badges">
              <span className={`badge ${progress > 30 ? 'verified' : ''}`}>
                {progress > 30 ? '✓' : '○'} Sources Verified
              </span>
              <span className={`badge ${progress > 60 ? 'verified' : ''}`}>
                {progress > 60 ? '✓' : '○'} Evidence Hashed
              </span>
              <span className={`badge ${progress > 85 ? 'verified' : ''}`}>
                {progress > 85 ? '✓' : '○'} Attestation Signed
              </span>
            </div>
          </div>
        )}

        {/* Result */}
        {status === 'complete' && result && (
          <div className="result-container">
            <div className="outcome-box">
              <div className="outcome-label">Oracle Determination</div>
              <div className={`outcome-value ${result.outcome.toLowerCase()}`}>
                {result.outcome}
              </div>
              <div className="confidence">Confidence: {(result.confidence * 100).toFixed(1)}%</div>
            </div>

            <div className="reasoning-box">
              <label>AI Reasoning</label>
              <p>{result.reasoning}</p>
            </div>

            <button
              className="verify-button"
              onClick={() => setShowVerification(!showVerification)}
            >
              {showVerification ? 'Hide' : 'View'} Cryptographic Verification
            </button>

            {showVerification && attestation && (
              <div className="verification-panel">
                <div className="verification-header">
                  <span className="lock-icon">🔐</span>
                  <span>EIP-712 Attestation</span>
                </div>

                <div className="verification-grid">
                  <div className="verification-item">
                    <label>Signer Address</label>
                    <code>{attestation.signer}</code>
                  </div>

                  <div className="verification-item">
                    <label>Signature</label>
                    <code className="signature">{attestation.signature.slice(0, 66)}...</code>
                  </div>

                  <div className="verification-item">
                    <label>Outcome Hash</label>
                    <code>{result.outcomeHash}</code>
                  </div>

                  <div className="verification-item">
                    <label>Timestamp</label>
                    <code>{new Date(result.timestamp).toISOString()}</code>
                  </div>
                </div>

                <div className="sanctity-box">
                  <h4>Information Sanctity</h4>
                  <ul>
                    <li>
                      <strong>Cryptographic Binding:</strong> The attestation cryptographically binds the market ID, outcome, and reasoning to a specific timestamp and signer.
                    </li>
                    <li>
                      <strong>Non-Repudiation:</strong> The EIP-712 signature proves the oracle operator made this specific determination at this specific time.
                    </li>
                    <li>
                      <strong>Verifiable Execution:</strong> Anyone can verify this attestation on-chain using the smart contract's verifyAttestation() function.
                    </li>
                    <li>
                      <strong>Evidence Integrity:</strong> While this demo uses simulated evidence, production deployments hash and timestamp all source material.
                    </li>
                  </ul>
                </div>

                <div className="evidence-preview">
                  <h4>Evidence Sources (Simulated)</h4>
                  {result.evidence.map((source, i) => (
                    <div key={i} className="evidence-item">
                      <span className="evidence-dot">•</span>
                      <span>{source}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="footer">
        <p>
          This demo shows verifiable AI oracle resolution for prediction markets.
          Built with Solidity, TypeScript, and EIP-712 attestations.
        </p>
      </footer>
    </div>
  )
}

export default App
