import { useState } from 'react'
import { BortleCalculator } from '../components/calculators/BortleCalculator'
import { FilterCalculator } from '../components/calculators/FilterCalculator'
import { SubExposureCalculator } from '../components/calculators/SubExposureCalculator'
import '../styles/calculators.css'

type CalcTab = 'bortle' | 'filter' | 'sub'

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
        <button className={`tab ${tab === 'sub' ? 'active' : ''}`} onClick={() => setTab('sub')}>
          Sub exposure
        </button>
      </div>

      {tab === 'bortle' ? <BortleCalculator /> : tab === 'filter' ? <FilterCalculator /> : <SubExposureCalculator />}
    </div>
  )
}
