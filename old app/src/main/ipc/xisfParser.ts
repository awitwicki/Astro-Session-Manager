import { ipcMain } from 'electron'
import * as fs from 'fs'

const XISF_SIGNATURE = 'XISF0100'

export async function parseXisfHeader(
  filePath: string
): Promise<Record<string, string | number | boolean>> {
  const fd = await fs.promises.open(filePath, 'r')
  try {
    // Read 16-byte header: 8-byte signature + 4-byte headerLength (LE) + 4 reserved
    const sigBuf = Buffer.alloc(16)
    await fd.read(sigBuf, 0, 16, 0)

    const signature = sigBuf.subarray(0, 8).toString('ascii')
    if (signature !== XISF_SIGNATURE) {
      throw new Error(`Not a valid XISF file: expected ${XISF_SIGNATURE}, got ${signature}`)
    }

    const headerLength = sigBuf.readUInt32LE(8)

    // Read the XML header
    const xmlBuf = Buffer.alloc(headerLength)
    await fd.read(xmlBuf, 0, headerLength, 16)
    const xmlStr = xmlBuf.toString('utf-8')

    return parseXisfXml(xmlStr)
  } finally {
    await fd.close()
  }
}

function parseXisfXml(xml: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}

  // Extract FITSKeyword elements: <FITSKeyword name="..." value="..." comment="..." />
  const fitsKeywordRegex =
    /<FITSKeyword\s+name="([^"]+)"\s+value="([^"]*)"\s*(?:comment="([^"]*)")?\s*\/>/g
  let match: RegExpExecArray | null

  while ((match = fitsKeywordRegex.exec(xml)) !== null) {
    const name = match[1].trim()
    const rawValue = match[2].trim()

    if (rawValue === 'T') {
      result[name] = true
    } else if (rawValue === 'F') {
      result[name] = false
    } else if (rawValue.startsWith("'")) {
      result[name] = rawValue.replace(/^'|'$/g, '').trimEnd()
    } else {
      const num = Number(rawValue)
      if (!isNaN(num) && rawValue !== '') {
        result[name] = num
      } else {
        result[name] = rawValue
      }
    }
  }

  // Extract geometry from Image element: <Image geometry="width:height:channels" ...>
  const imageGeomRegex = /geometry="(\d+):(\d+):?(\d+)?"/
  const geomMatch = imageGeomRegex.exec(xml)
  if (geomMatch) {
    result['NAXIS1'] = Number(geomMatch[1])
    result['NAXIS2'] = Number(geomMatch[2])
    if (geomMatch[3]) {
      result['NAXIS3'] = Number(geomMatch[3])
    }
  }

  // Extract sampleFormat: <Image ... sampleFormat="Float32" ...>
  const sampleFormatRegex = /sampleFormat="([^"]+)"/
  const sfMatch = sampleFormatRegex.exec(xml)
  if (sfMatch) {
    const formatMap: Record<string, number> = {
      UInt8: 8,
      UInt16: 16,
      UInt32: 32,
      Float32: -32,
      Float64: -64
    }
    result['BITPIX'] = formatMap[sfMatch[1]] ?? -32
  }

  return result
}

export function registerXisfParser(): void {
  ipcMain.handle('xisf:readHeader', async (_event, filePath: string) => {
    try {
      return await parseXisfHeader(filePath)
    } catch (error) {
      throw new Error(`Failed to read XISF header: ${error}`)
    }
  })
}
