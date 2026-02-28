/* eslint-disable @typescript-eslint/no-explicit-any */

interface CelestialStyle {
  fill?: string
  stroke?: string
  width?: number
  opacity?: number
  dash?: number[]
}

interface CelestialTextStyle {
  fill?: string
  font?: string
  align?: string
  baseline?: string
}

interface CelestialStarConfig {
  show?: boolean
  limit?: number
  colors?: boolean
  size?: number
  exponent?: number
  names?: boolean
  proper?: boolean
  desig?: boolean
  namelimit?: number
  namestyle?: CelestialTextStyle
  propernamestyle?: CelestialTextStyle
  propernamelimit?: number
  style?: CelestialStyle
}

interface CelestialDsoConfig {
  show?: boolean
  limit?: number
  colors?: boolean
  size?: number
  exponent?: number
  names?: boolean
  desig?: boolean
  namelimit?: number
  namestyle?: CelestialTextStyle
  style?: CelestialStyle
  symbols?: Record<string, CelestialStyle & { symbol?: string }>
}

interface CelestialConstellationConfig {
  names?: boolean
  lines?: boolean
  bounds?: boolean
  desig?: boolean
  namestyle?: CelestialTextStyle
  linestyle?: CelestialStyle
  boundstyle?: CelestialStyle
}

interface CelestialMwConfig {
  show?: boolean
  style?: CelestialStyle
}

interface CelestialLineConfig {
  show?: boolean
  style?: CelestialStyle
}

interface CelestialConfig {
  width?: number
  projection?: string
  projectionRatio?: number | null
  transform?: string
  center?: [number, number, number]
  orientationfixed?: boolean
  geopos?: [number, number] | null
  follow?: string
  container?: string
  interactive?: boolean
  form?: boolean
  controls?: boolean
  zoomlevel?: number | null
  zoomextend?: number
  adaptable?: boolean
  datapath?: string
  stars?: CelestialStarConfig
  dsos?: CelestialDsoConfig
  constellations?: CelestialConstellationConfig
  mw?: CelestialMwConfig
  lines?: {
    graticule?: CelestialLineConfig & {
      lon?: { pos: string[]; fill: string; font: string }
      lat?: { pos: string[]; fill: string; font: string }
    }
    equatorial?: CelestialLineConfig
    ecliptic?: CelestialLineConfig
    galactic?: CelestialLineConfig
    supergalactic?: CelestialLineConfig
  }
  background?: {
    fill?: string
    stroke?: string
    opacity?: number
    width?: number
  }
  horizon?: CelestialStyle & { show?: boolean }
  daylight?: { show?: boolean }
  planets?: {
    show?: boolean
    which?: string[]
    names?: boolean
    namesType?: string
    nameStyle?: CelestialTextStyle
    symbolType?: string
    symbolStyle?: CelestialTextStyle
    symbols?: Record<string, any>
  }
  culture?: string
  lang?: string
  location?: boolean
  formFields?: Record<string, boolean>
}

interface CelestialAddData {
  type: 'json' | 'dso' | 'line' | 'raw'
  file?: string
  callback: (error?: any, json?: any) => void
  redraw: () => void
  save?: () => void
}

interface CelestialMetrics {
  width: number
  height: number
  margin: [number, number]
  scale: number
}

interface CelestialProjection {
  (coords: [number, number]): [number, number] | null
  rotate(): [number, number, number]
  rotate(angles: [number, number, number]): CelestialProjection
  center(): [number, number]
  center(center: [number, number]): CelestialProjection
  translate(): [number, number]
  translate(t: [number, number]): CelestialProjection
  scale(): number
  scale(s: number): CelestialProjection
  invert(point: [number, number]): [number, number] | null
  clipAngle(): number
  clipAngle(angle: number): CelestialProjection
}

interface CelestialObject {
  version: string
  container: any
  data: any[]

  display(config: CelestialConfig): void
  add(data: CelestialAddData): void
  remove(index: number): void
  clear(): void
  addCallback(callback: (() => void) | null): void
  projection(name: string): CelestialProjection
  redraw(): void
  apply(config: Partial<CelestialConfig>): void
  reproject(config: Partial<CelestialConfig>): number | void
  reload(config?: Partial<CelestialConfig>): void
  resize(config?: { width?: number; projectionRatio?: number }): void
  rotate(config: { center?: [number, number, number]; duration?: number }): void
  zoomBy(factor: number): void
  date(dt?: Date, tz?: string): Date
  settings(): any
  metrics(): CelestialMetrics

  // Exported after display() is called
  mapProjection: CelestialProjection
  context: CanvasRenderingContext2D
  clip(coords: [number, number]): boolean
  map: { projection(): CelestialProjection; projection(p: CelestialProjection): any }
  setStyle(style: CelestialStyle): void
  setTextStyle(style: CelestialTextStyle): void
  symbol(): any
}

declare global {
  // eslint-disable-next-line no-var
  var Celestial: CelestialObject
}

export {}
