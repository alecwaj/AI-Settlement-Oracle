import { useState, useEffect } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import MarketList from './components/MarketList'
import MarketForm from './components/MarketForm'
import MarketDetail from './components/MarketDetail'
import type { Market, Resolution, Attestation } from './types'

const ORACLE_API = 'http://localhost:3001'

function App() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null)
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMarkets()
  }, [])

  const fetchMarkets = async () => {
    try {
      const res = await fetch(`${ORACLE_API}/markets`)
      const data = await res.json()
      setMarkets(data.markets || [])
    } catch (err) {
      setError('Failed to fetch markets')
    }
  }

  const createMarket = async (marketData: Omit<Market, 'id'>) => {
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`${ORACLE_API}/markets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(marketData),
      })
      
      const data = await res.json()
      
      if (data.success) {
        setMarkets([...markets, data.market])
        setActiveTab('list')
      } else {
        setError(data.error || 'Failed to create market')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const resolveMarket = async (marketId: string): Promise<Resolution | null> => {
    try {
      const res = await fetch(`${ORACLE_API}/markets/${marketId}/resolve`, {
        method: 'POST',
      })
      const data = await res.json()
      
      if (data.success) {
        return data.resolution
      }
      return null
    } catch (err) {
      setError('Failed to resolve market')
      return null
    }
  }

  const attestMarket = async (marketId: string): Promise<Attestation | null> => {
    try {
      const res = await fetch(`${ORACLE_API}/markets/${marketId}/attest`, {
        method: 'POST',
      })
      const data = await res.json()
      
      if (data.success) {
        return data.attestation
      }
      return null
    } catch (err) {
      setError('Failed to create attestation')
      return null
    }
  }

  return (
    <div>
      <div className="header">
        <div>
          <h1>AI Settlement Oracle</h1>
          <p style={{ color: '#888', marginTop: '0.5rem' }}>
            Verifiable AI predictions with cryptographic attestations
          </p>
        </div>
        <ConnectButton />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('list')
            setSelectedMarket(null)
          }}
        >
          Markets
        </button>
        <button
          className={`tab ${activeTab === 'create' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('create')
            setSelectedMarket(null)
          }}
        >
          Create Market
        </button>
      </div>

      {selectedMarket ? (
        <MarketDetail
          market={selectedMarket}
          onBack={() => setSelectedMarket(null)}
          onResolve={resolveMarket}
          onAttest={attestMarket}
        />
      ) : activeTab === 'list' ? (
        <MarketList
          markets={markets}
          onSelect={setSelectedMarket}
          onRefresh={fetchMarkets}
        />
      ) : (
        <MarketForm onSubmit={createMarket} loading={loading} />
      )}
    </div>
  )
}

export default App
