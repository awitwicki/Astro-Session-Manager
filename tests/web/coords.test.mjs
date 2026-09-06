import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDec, parseRA } from '../../src/lib/coords.ts'

const close = (got, want, eps = 1e-6) => got !== null && Math.abs(got - want) < eps

test('parseRA: sexagesimal hours in space, colon and hms forms', () => {
  const want = (12 + 34 / 60 + 56.7 / 3600) * 15
  for (const q of ['12 34 56.7', '12:34:56.7', '12h34m56.7s', '12h 34m 56.7s', ' 12 34 56.7 '])
    assert.ok(close(parseRA(q), want), `${q} -> ${parseRA(q)}`)
})

test('parseRA: hours and minutes only', () => {
  assert.ok(close(parseRA('12 30'), 187.5))
  assert.ok(close(parseRA('12h30m'), 187.5))
  assert.ok(close(parseRA('12h'), 180))
})

test('parseRA: a bare number is degrees, an h suffix means hours', () => {
  assert.ok(close(parseRA('187.5'), 187.5))
  assert.ok(close(parseRA('187.5°'), 187.5))
  assert.ok(close(parseRA('187.5d'), 187.5))
  assert.ok(close(parseRA('12.5h'), 187.5))
  assert.ok(close(parseRA('0'), 0))
})

test('parseRA: rejects out-of-range values and garbage', () => {
  for (const q of ['', '   ', '24 00 00', '12 60 00', '12 00 60', '-1 00 00', '360', '400', '25h', 'abc', '12 34 56 78', '12 xx'])
    assert.equal(parseRA(q), null, q)
})

test('parseDec: signed sexagesimal in space, colon and dms forms', () => {
  const want = 41 + 16 / 60 + 8.6 / 3600
  for (const q of ['+41 16 08.6', '41:16:08.6', '+41d16m08.6s', '41°16′08.6″', `41° 16' 08.6"`, '+41 16 8.6'])
    assert.ok(close(parseDec(q), want), `${q} -> ${parseDec(q)}`)
})

test('parseDec: negative values keep the sign, including on zero degrees', () => {
  assert.ok(close(parseDec('-00 30 00'), -0.5))
  assert.ok(close(parseDec('-5:23:28'), -(5 + 23 / 60 + 28 / 3600)))
  assert.ok(close(parseDec('−5 00 00'), -5)) // unicode minus
  assert.ok(close(parseDec('-41.27'), -41.27))
})

test('parseDec: degrees and minutes only, and decimal degrees', () => {
  assert.ok(close(parseDec('41 30'), 41.5))
  assert.ok(close(parseDec('41.27'), 41.27))
  assert.ok(close(parseDec('+90'), 90))
  assert.ok(close(parseDec('-90'), -90))
})

test('parseDec: rejects out-of-range values and garbage', () => {
  for (const q of ['', '91', '-90 00 01', '41 60 00', '41 00 60', 'abc', '12 34 56 78', '41h'])
    assert.equal(parseDec(q), null, q)
})
