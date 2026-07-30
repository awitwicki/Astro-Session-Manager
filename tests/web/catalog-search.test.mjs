import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchIndex, searchCatalog } from '../../src/lib/catalogSearch.ts'

const FIXTURE = [
  { id: 'NGC 224', m: 31, c: null, names: ['Andromeda Galaxy'], type: 'Galaxy', ra: 10.68, dec: 41.27, mag: 3.44, size: [177.8, 69.7], con: 'And' },
  { id: 'NGC 7000', m: null, c: 20, names: ['North America Nebula'], type: 'Emission Nebula', ra: 314.82, dec: 44.53, mag: 4, size: [120, 30], con: 'Cyg' },
  { id: 'NGC 869', m: null, c: 14, names: ['h Persei'], type: 'Open Cluster', ra: 34.74, dec: 57.13, mag: 5.3, size: [18, 18], con: 'Per' },
  { id: 'NGC 2244', m: null, c: 50, names: ['Rosette Nebula'], type: 'Open Cluster', ra: 97.98, dec: 4.94, mag: 4.8, size: [30, 30], con: 'Mon' },
  { id: 'NGC 2237', m: null, c: 49, names: ['Rosette Nebula'], type: 'Emission Nebula', ra: 97.75, dec: 5.05, mag: null, size: [80, 60], con: 'Mon' },
  { id: 'Mel 22', m: 45, c: null, names: ['Pleiades'], type: 'Open Cluster', ra: 56.87, dec: 24.11, mag: 1.2, size: [150, 150], con: 'Tau' },
]
const index = buildSearchIndex(FIXTURE)

test('designation formats all resolve', () => {
  for (const q of ['m31', 'M 31', 'M31']) assert.equal(searchCatalog(index, q)[0].id, 'NGC 224')
  for (const q of ['ngc7000', 'NGC 7000']) assert.equal(searchCatalog(index, q)[0].id, 'NGC 7000')
  assert.equal(searchCatalog(index, 'c14')[0].id, 'NGC 869')
  assert.equal(searchCatalog(index, 'm45')[0].id, 'Mel 22')
})

test('common-name search ranks prefix before substring, brighter first on ties', () => {
  assert.equal(searchCatalog(index, 'north america')[0].id, 'NGC 7000')
  const rosette = searchCatalog(index, 'rosette')
  assert.equal(rosette.length, 2)
  assert.equal(rosette[0].id, 'NGC 2244') // same score; non-null mag sorts first
})

test('empty and unknown queries return nothing', () => {
  assert.deepEqual(searchCatalog(index, ''), [])
  assert.deepEqual(searchCatalog(index, '   '), [])
  assert.deepEqual(searchCatalog(index, 'xyzzy'), [])
})

test('limit caps results', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: `NGC ${1000 + i}`, m: null, c: null, names: [], type: 'Galaxy',
    ra: i, dec: 0, mag: null, size: null, con: 'And',
  }))
  assert.equal(searchCatalog(buildSearchIndex(many), 'ngc 1').length, 20)
})
