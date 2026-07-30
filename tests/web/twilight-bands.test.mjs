import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyTwilight, twilightBands } from '../../src/lib/twilightBands.ts'
import { sunAltitudes } from '../../src/lib/ephemeris.ts'
import { localMidnight, addMinutes, nightWindowStart } from '../../src/lib/localTime.ts'

test('classification thresholds', () => {
  assert.equal(classifyTwilight(10), 'day')
  assert.equal(classifyTwilight(-3), 'civil')
  assert.equal(classifyTwilight(-9), 'nautical')
  assert.equal(classifyTwilight(-15), 'astro')
  assert.equal(classifyTwilight(-25), 'night')
})

test('bands are contiguous and cover 0..1', () => {
  const t = (alt) => ({ time: new Date(0), alt })
  const bands = twilightBands([t(-25), t(-15), t(-3), t(10), t(10), t(-3), t(-25)])
  assert.equal(bands[0].startFrac, 0)
  assert.equal(bands.at(-1).endFrac, 1)
  for (let i = 1; i < bands.length; i++) assert.equal(bands[i].startFrac, bands[i - 1].endFrac)
  assert.deepEqual(bands.map((b) => b.kind), ['night', 'astro', 'civil', 'day', 'civil', 'night'])
})

test('January night at lat 50 has a true night band, midsummer does not', () => {
  const jan = twilightBands(sunAltitudes(new Date('2026-01-14T23:00:00Z'), 50, 20))
  assert.ok(jan.some((b) => b.kind === 'night'))
  const jun = twilightBands(sunAltitudes(new Date('2026-06-19T22:00:00Z'), 50, 20))
  assert.ok(!jun.some((b) => b.kind === 'night')) // astro twilight all night at 50N midsummer
})

test('localMidnight in a DST zone', () => {
  // July in Warsaw is UTC+2: local midnight = 22:00 UTC the previous day
  const mid = localMidnight(new Date('2026-07-20T12:00:00Z'), 'Europe/Warsaw')
  assert.equal(mid.toISOString(), '2026-07-19T22:00:00.000Z')
  assert.equal(addMinutes(mid, 24 * 60).toISOString(), '2026-07-20T22:00:00.000Z')
})

test('nightWindowStart centers the night: noon on whichever side of noon the time falls', () => {
  // Europe/Warsaw in July is UTC+2, so local noon = 10:00 UTC
  const evening = new Date('2026-07-20T18:00:00Z') // 20:00 local, after noon
  const morning = new Date('2026-07-20T06:00:00Z') // 08:00 local, before noon
  assert.equal(nightWindowStart(evening, 'Europe/Warsaw').toISOString(), '2026-07-20T10:00:00.000Z')
  assert.equal(nightWindowStart(morning, 'Europe/Warsaw').toISOString(), '2026-07-19T10:00:00.000Z')
})
