import { useState } from 'react'
import type { Market } from '../types'

interface Props {
  onSubmit: (market: Omit<Market, 'id'>) => void
  loading: boolean
}

export default function MarketForm({ onSubmit, loading }: Props) {
  const [question, setQuestion] = useState('')
  const [criteria, setCriteria] = useState('')
  const [resolutionDate, setResolutionDate] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    const resolutionTime = new Date(resolutionDate).getTime()
    
    onSubmit({
      question,
      resolutionCriteria: criteria,
      resolutionTime,
    })
    
    // Reset form
    setQuestion('')
    setCriteria('')
    setResolutionDate('')
  }

  return (
    <div className="card">
      <h2>Create New Market</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Market Question</label>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., Will ETH exceed $5000 by end of 2024?"
            required
          />
        </div>
        
        <div className="form-group">
          <label>Resolution Criteria</label>
          <textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder="e.g., Resolve YES if ETH price > $5000 on Coinbase at 23:59 UTC Dec 31 2024"
            required
          />
        </div>
        
        <div className="form-group">
          <label>Resolution Date</label>
          <input
            type="datetime-local"
            value={resolutionDate}
            onChange={(e) => setResolutionDate(e.target.value)}
            required
          />
        </div>
        
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Market'}
        </button>
      </form>
    </div>
  )
}
