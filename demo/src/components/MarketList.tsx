import { useState } from 'react'
import type { Market } from '../types'

interface Props {
  markets: Market[]
  onSelect: (market: Market) => void
  onRefresh: () => void
}

export default function MarketList({ markets, onSelect, onRefresh }: Props) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Active Markets</h2>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      
      {markets.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', padding: '2rem' }}>
          No markets yet. Create one!
        </p>
      ) : (
        <div className="market-list">
          {markets.map((market) => (
            <div
              key={market.id}
              className={`market-item ${market.resolved ? 'resolved' : ''}`}
              onClick={() => onSelect(market)}
            >
              <div className="market-question">{market.question}</div>
              <div className="market-meta">
                <span>Resolves: {new Date(market.resolutionTime).toLocaleDateString()}</span>
                <span style={{ marginLeft: '1rem' }}>
                  <span className={`status-badge ${market.resolved ? 'resolved' : 'pending'}`}>
                    {market.resolved ? 'Resolved' : 'Pending'}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
