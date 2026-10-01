import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupCheckState } from '../../src/lib/groupCheck.ts'
import { formatTemperature } from '../../src/lib/formatters.ts'

test('group check state: all, some, none', () => {
  assert.equal(groupCheckState([true, true]), 'all')
  assert.equal(groupCheckState([true, false, true]), 'some')
  assert.equal(groupCheckState([false, false]), 'none')
})

test('group check state: an empty group counts as none', () => {
  assert.equal(groupCheckState([]), 'none')
})

test('temperature rounds float noise to 0.1 °C', () => {
  assert.equal(formatTemperature(-20.1000003814697), '-20.1°C')
  assert.equal(formatTemperature(-20), '-20°C')
  assert.equal(formatTemperature(-9.96), '-10°C')
  assert.equal(formatTemperature(5.25), '+5.3°C')
})

test('temperature never shows a signed zero', () => {
  assert.equal(formatTemperature(-0.04), '0°C')
})
