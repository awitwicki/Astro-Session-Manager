import { useState } from 'react'
import { BortleCalculator } from '../components/calculators/BortleCalculator'
import { FilterCalculator } from '../components/calculators/FilterCalculator'
import '../styles/calculators.css'

type CalcTab = 'bortle' | 'filter'

export function Calculators() {
  const [tab, setTab] = useState<CalcTab>('bortle')

  return (
    <div className="calc-page">
      <div className="tabs">
        <button className={`tab ${tab === 'bortle' ? 'active' : ''}`} onClick={() => setTab('bortle')}>
          Bortle
        </button>
        <button className={`tab ${tab === 'filter' ? 'active' : ''}`} onClick={() => setTab('filter')}>
          Filter
        </button>
      </div>

      {tab === 'bortle' ? <BortleCalculator /> : <FilterCalculator />}
    </div>
  )
}
