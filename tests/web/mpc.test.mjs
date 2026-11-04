import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCometLines, parseAsteroidLines, unpackEpoch, COMETS_URL, asteroidsUrl,
} from '../../src/lib/mpc.ts'

const A3 = '    CK23A030  2024 09 27.8396  0.391298  1.000182  308.5876   21.6807  139.0983  20261103   6.5  3.2  C/2023 A3 (Tsuchinshan-ATLAS)                            MPEC 2026-O98'
const HALLEY = '0001P         2061 07 31.8911  0.570855  0.968035  112.1488   59.2481  162.1934  20261103   5.5  3.2  1P/Halley                                                MPC191592'
const CERES = '00001    3.35  0.15 K25BL 231.53975   73.29974   80.24963   10.58789  0.0795763  0.21429712   2.7656157  0 MPO950947  7369 126 1801-2025 0.69 M-v 30k MPC        0000              (1) Ceres'
const VESTA = '00004    3.25  0.15 K25BL  26.80968  151.53712  103.70232    7.14406  0.0901676  0.27158812   2.3615413  0 MPO925791  7543 112 1821-2025 0.69 M-p 18k MPC        0000              (4) Vesta'

test('unpackEpoch', () => {
  assert.equal(unpackEpoch('K25BL'), 2461000.5)
  assert.equal(unpackEpoch('J9612'), 2450084.5)
})

test('URLs', () => {
  assert.equal(COMETS_URL, 'https://www.minorplanetcenter.net/iau/Ephemerides/Comets/Soft00Cmt.txt')
  assert.equal(asteroidsUrl(2026), 'https://www.minorplanetcenter.net/iau/Ephemerides/Bright/2026/Soft00Bright.txt')
})

test('parseCometLines', () => {
  const r = parseCometLines([A3, '', A3.slice(0, 40), 'abcdefghij klmnop', HALLEY].join('\n'))
  assert.equal(r.length, 2)
  const [a, h] = r
  assert.equal(a.kind, 'comet')
  assert.equal(a.designation, 'C/2023 A3')
  assert.equal(a.name, 'Tsuchinshan-ATLAS')
  assert.equal(a.elements.q, 0.391298)
  assert.equal(a.elements.e, 1.000182)
  assert.ok(Math.abs(a.elements.epochJd - 2460581.3396) < 1e-4)
  assert.equal(a.elements.peri, 308.5876)
  assert.equal(a.elements.node, 21.6807)
  assert.equal(a.elements.i, 139.0983)
  assert.equal(a.elements.H, 6.5)
  assert.equal(a.elements.G, 3.2)
  assert.equal(a.elements.meanAnomalyDeg, undefined)
  assert.equal(h.designation, '1P')
  assert.equal(h.name, 'Halley')
})

test('parseAsteroidLines', () => {
  const r = parseAsteroidLines([CERES, '', CERES.slice(0, 40), 'abcdefghij klmnop', VESTA].join('\n'))
  assert.equal(r.length, 2)
  const c = r[0]
  assert.equal(c.kind, 'asteroid')
  assert.equal(c.designation, '(1) Ceres')
  assert.equal(c.name, 'Ceres')
  assert.equal(c.elements.epochJd, 2461000.5)
  assert.equal(c.elements.meanAnomalyDeg, 231.53975)
  assert.ok(Math.abs(c.elements.q - 2.7656157 * (1 - 0.0795763)) < 1e-9)
  assert.equal(c.elements.e, 0.0795763)
  assert.equal(c.elements.H, 3.35)
  assert.equal(c.elements.G, 0.15)
  assert.equal(c.elements.peri, 73.29974)
  assert.equal(c.elements.node, 80.24963)
  assert.equal(c.elements.i, 10.58789)
  assert.equal(r[1].designation, '(4) Vesta')
})
