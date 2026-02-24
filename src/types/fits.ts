export interface FitsHeader {
  simple: boolean
  bitpix: number
  naxis: number
  naxis1: number
  naxis2: number
  naxis3?: number

  bscale: number
  bzero: number

  object?: string
  dateObs?: string
  exptime?: number
  ccdTemp?: number
  filter?: string

  instrume?: string
  telescop?: string
  gain?: number
  offset?: number

  imagetyp?: string
  xbinning?: number
  ybinning?: number

  bayerpat?: string

  raw: Record<string, string | number | boolean>
}

export interface FitsPixelData {
  pixels: number[]
  width: number
  height: number
  bitpix: number
  channels: number
  bscale: number
  bzero: number
}
