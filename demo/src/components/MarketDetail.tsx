import { useState } from 'react'
import type { Market, Resolution, Attestation, ResolutionResult } from '../types'

interface Props {
  market: Market
  onBack: () => void
  onResolve: (marketId: string) => Promise<Resolution | null>
  onAttest: (marketId: string) => Promise<Attestation | null>
}

const ORACLE_API = 'http://localhost:3001'

export default function MarketDetail({ market, onBack, onResolve, onAttest }: Props) {
  const [resolution, setResolution] = useState<ResolutionResult | null>(null)
  const [attestation, setAttestation] = useState<Attestation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResolve = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`${ORACLE_API}/markets/${market.id}/resolve`, {
        method: 'POST',
      })
      const data = await res.json()
      
      if (data.success) {
        setResolution(data.result)
      } else {
        setError(data.error || 'Resolution failed')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const handleAttest = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`${ORACLE_API}/markets/${market.id}/attest`, {
        method: 'POST',
      })
      const data = await res.json()
      
      if (data.success) {
        setAttestation(data.attestation)
      } else {
        setError(data.error || 'Attestation failed')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <button onClick={onBack} style={{ marginBottom: '1rem' }}>
        ← Back
      </button>
      
      <h2>{market.question}</h2>
      
      <div style={{ marginBottom: '1.5rem' }}>
        <label>Resolution Criteria</label>
        <p style={{ color: '#ccc', marginTop: '0.5rem' }}>{market.resolutionCriteria}</p>
      </div>
      
      <div style={{ marginBottom: '1.5rem' }}>
        <label>Resolution Time</label>
        <p style={{ color: '#ccc', marginTop: '0.5rem' }}>
          {new Date(market.resolutionTime).toLocaleString()}
        </p>
      </div>

      {error && <div className="error">{error}</div>}

      {!resolution && (
        <button onClick={handleResolve} disabled={loading}>
          {loading ? 'Resolving...' : 'Resolve with AI'}
        </button>
      )}

      {resolution && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', color: '#22c55e' }}>✓ AI Resolution Complete</h3>
          
          <div style={{ background: '#1a1a25', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ color: '#888' }}>Outcome:</span>
              <span style={{ fontWeight: 'bold', color: '#fff' }}>{resolution.outcome}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ color: '#888' }}>Confidence:</span>
              <span>{(resolution.confidence * 100).toFixed(1)}%</span>
            </div>
          </div>
          
          <div style={{ marginBottom: '1rem' }}>
            <label>Reasoning</label>
            <p style={{ color: '#ccc', marginTop: '0.5rem', fontSize: '0.875rem' }}>
              {resolution.reasoning}
            </p>
          </div>

          {!attestation && (
            <button onClick={handleAttest} disabled={loading}>
              {loading ? 'Creating...' : 'Create Attestation'}
            </button>
          )}
        </div>
      )}

      {attestation && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', color: '#667eea' }}>🔐 Cryptographic Attestation</h3>
          
          <div className="attestation-box">
            <div style={{ marginBottom: '1rem' }}>
              <span style={{ color: '#888' }}>Signer: </span>
              <span>{attestation.signer}</span>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <span style={{ color: '#888' }}>Signature: </span>
              <span>{attestation.signature.slice(0, 50)}...</span>
            </div>
            <pre>{JSON.stringify(attestation.resolution, null, 2)}</pre>
          </div>
          
          <p style={{ color: '#888', marginTop: '1rem', fontSize: '0.875rem' }}>
            This attestation can be verified on-chain using EIP-712 structured data signing.
          </p>
        </div>
      )}
    </div>
  )
}
