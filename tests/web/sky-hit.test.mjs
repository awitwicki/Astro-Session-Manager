import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isClick, nearestHit, placeCard } from '../../src/lib/skyHit.ts'

const c = (x, y, mag, item) => ({ x, y, mag, item })

test('nearestHit: the nearest candidate within 10 px wins', () => {
  const cands = [c(108, 100, 1, 'far'), c(103, 100, 5, 'near'), c(130, 100, -1, 'out')]
  assert.equal(nearestHit([100, 100], cands), 'near')
})

test('nearestHit: nothing within the radius gives null', () => {
  assert.equal(nearestHit([100, 100], [c(111, 100, 0, 'a'), c(100, 89, 0, 'b')]), null)
  assert.equal(nearestHit([100, 100], []), null)
})

test('nearestHit: the radius is configurable', () => {
  assert.equal(nearestHit([0, 0], [c(15, 0, 0, 'a')], 20), 'a')
})

test('nearestHit: equal distance goes to the brighter (lower mag)', () => {
  const cands = [c(105, 100, 4, 'dim'), c(95, 100, 2, 'bright'), c(100, 105, 3, 'mid')]
  assert.equal(nearestHit([100, 100], cands), 'bright')
})

test('nearestHit: near-ties under 0.5 px count as equal distance', () => {
  const cands = [c(105, 100, 4, 'dim'), c(105.3, 100, 2, 'bright')]
  assert.equal(nearestHit([100, 100], cands), 'bright')
})

test('nearestHit: a null magnitude loses to any number', () => {
  assert.equal(nearestHit([0, 0], [c(3, 0, null, 'none'), c(-3, 0, 14, 'faint')]), 'faint')
  assert.equal(nearestHit([0, 0], [c(-3, 0, 14, 'faint'), c(3, 0, null, 'none')]), 'faint')
})

test('nearestHit: a clearly nearer null-mag candidate still wins', () => {
  assert.equal(nearestHit([0, 0], [c(1, 0, null, 'none'), c(6, 0, -4, 'bright')]), 'none')
})

test('nearestHit: ties keep the earlier candidate when magnitudes match', () => {
  assert.equal(nearestHit([0, 0], [c(2, 0, null, 'first'), c(-2, 0, null, 'second')]), 'first')
  assert.equal(nearestHit([0, 0], [c(2, 0, 1, 'first'), c(-2, 0, 1, 'second')]), 'first')
})

test('isClick: under 4 px of movement is a click', () => {
  assert.equal(isClick([10, 10], [10, 10]), true)
  assert.equal(isClick([10, 10], [12, 12]), true) // 2.83 px
})

test('isClick: 4 px or more is a drag', () => {
  assert.equal(isClick([10, 10], [14, 10]), false)
  assert.equal(isClick([10, 10], [13, 13]), false) // 4.24 px
  assert.equal(isClick([10, 10], [200, 50]), false)
})

// placeCard(at, [w, h], [W, H]) → [left, top]; gap 12, margin 8
test('placeCard: below-right of the point when it fits', () => {
  assert.deepEqual(placeCard([100, 100], [200, 80], [1000, 600]), [112, 112])
})

test('placeCard: flips left near the right edge and up near the bottom', () => {
  assert.deepEqual(placeCard([950, 100], [200, 80], [1000, 600]), [738, 112])
  assert.deepEqual(placeCard([100, 560], [200, 80], [1000, 600]), [112, 468])
})

test('placeCard: clamped inside the page when neither side fits', () => {
  assert.deepEqual(placeCard([150, 50], [280, 80], [300, 600]), [8, 62])
  assert.deepEqual(placeCard([5, 5], [200, 80], [1000, 600]), [17, 17])
})
