import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLocation, saveLocation } from '../../docs/astroweather/js/location.js'

function memStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  }
}

test('round-trips a location', () => {
  const s = memStorage()
  saveLocation({ lat: 49.8397, lon: 24.0297 }, s)
  assert.deepEqual(loadLocation(s), { lat: 49.8397, lon: 24.0297 })
})

test('returns null for missing, corrupt, or wrong-shaped values', () => {
  assert.equal(loadLocation(memStorage()), null)
  assert.equal(loadLocation(memStorage({ 'astroweather.location': 'not json' })), null)
  assert.equal(loadLocation(memStorage({ 'astroweather.location': '{"lat":"x","lon":1}' })), null)
})

test('storage that throws is treated as empty', () => {
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(loadLocation(broken), null)
  saveLocation({ lat: 1, lon: 2 }, broken) // must not throw
})
