import { useState } from 'react'
import { Calculator } from 'lucide-react'
import { BortleCalculator } from '../components/calculators/BortleCalculator'
import { FilterCalculator } from '../components/calculators/FilterCalculator'
import '../styles/calculators.css'

type CalcTab = 'bortle' | 'filter'

export function Calculators() {
  const [tab, setTab] = useState<CalcTab>('bortle')

  return (
    <div className="calc-page">
      <div className="page-header">
        <h1 className="page-title">
          <Calculator size={22} /> Calculators
        </h1>
      </div>

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
