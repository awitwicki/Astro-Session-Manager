import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_BATCH, batchEnqueued, batchFinished, scanTitle,
  buildOperations, summarize, progressFraction,
} from '../../src/lib/operations.ts'

const job = (id, status, o = {}) => ({
  id, files: ['a.fit', 'b.fit'], targetDir: `/root/${id}/lights`, label: `Lights → ${id}`,
  status, current: 0, total: 2, filename: '', ...o,
})
const idle = { importQueue: [], isScanning: false, scanProgress: null, isAnalyzing: false, analyzeProgress: null }

test('batch counts enqueued jobs and finished ones', () => {
  let b = EMPTY_BATCH
  for (let i = 0; i < 7; i++) b = batchEnqueued(b)
  assert.deepEqual(b, { done: 0, total: 7 })
  b = batchFinished(b, 1, 6)
  b = batchFinished(b, 1, 5)
  assert.deepEqual(b, { done: 2, total: 7 })
})

test('batch resets once the queue is empty', () => {
  assert.deepEqual(batchFinished({ done: 6, total: 7 }, 1, 0), { done: 0, total: 0 })
})

test('batch ignores a finish that removed nothing (job already gone)', () => {
  assert.deepEqual(batchFinished({ done: 2, total: 7 }, 0, 5), { done: 2, total: 7 })
})

test('batch never counts past total', () => {
  assert.deepEqual(batchFinished({ done: 6, total: 7 }, 3, 1), { done: 7, total: 7 })
})

test('skipping several queued jobs at once counts each', () => {
  assert.deepEqual(batchFinished({ done: 1, total: 7 }, 4, 2), { done: 5, total: 7 })
})

test('scan titles follow the phase', () => {
  assert.equal(scanTitle(null), 'Synchronizing')
  assert.equal(scanTitle({ phase: 'scanning', current: 1, total: 3, filePath: '/x' }), 'Scanning projects')
  assert.equal(scanTitle({ phase: 'headers', current: 1, total: 3, filePath: '/x' }), 'Reading headers')
})

test('nothing running gives no operations', () => {
  assert.deepEqual(buildOperations(idle), [])
})

test('active import first, then scan, analysis, then queued imports in order', () => {
  const ops = buildOperations({
    importQueue: [job('q1', 'queued'), job('a', 'active', { current: 11, total: 25, filename: 'L_0011.fit' }), job('q2', 'queued', { total: 61 })],
    isScanning: true,
    scanProgress: { phase: 'headers', current: 3, total: 9, filePath: '/root/M31/x.fit' },
    isAnalyzing: true,
    analyzeProgress: { current: 40, total: 120, filePath: '/root/M31/y.fit' },
  })
  assert.deepEqual(ops.map((o) => [o.id, o.kind, o.status]), [
    ['a', 'import', 'running'],
    ['scan', 'scan', 'running'],
    ['analyze', 'analyze', 'running'],
    ['q1', 'import', 'queued'],
    ['q2', 'import', 'queued'],
  ])
  assert.deepEqual(ops[0], {
    id: 'a', kind: 'import', title: 'Importing Lights → a', status: 'running',
    current: 11, total: 25, detail: 'L_0011.fit',
  })
  assert.equal(ops[1].title, 'Reading headers')
  assert.equal(ops[1].detail, '/root/M31/x.fit')
  assert.equal(ops[2].title, 'Analyzing subs')
  assert.deepEqual([ops[2].current, ops[2].total], [40, 120])
  assert.equal(ops[4].total, 61)
  assert.equal(ops[4].current, undefined)
})

test('active import without a filename yet has no detail', () => {
  const [op] = buildOperations({ ...idle, importQueue: [job('a', 'active')] })
  assert.equal(op.detail, undefined)
})

test('scan and analysis before their first event have no counts', () => {
  const ops = buildOperations({ ...idle, isScanning: true, isAnalyzing: true })
  assert.deepEqual(ops.map((o) => [o.title, o.current, o.total]), [
    ['Synchronizing', undefined, undefined],
    ['Analyzing subs', undefined, undefined],
  ])
})

test('scan progress is ignored when no scan is running (post-import rescan)', () => {
  const ops = buildOperations({ ...idle, scanProgress: { phase: 'headers', current: 1, total: 2, filePath: '/x' } })
  assert.deepEqual(ops, [])
})

test('error / done / cancelled jobs are not listed', () => {
  const ops = buildOperations({ ...idle, importQueue: [job('e', 'error'), job('d', 'done'), job('c', 'cancelled')] })
  assert.deepEqual(ops, [])
})

test('summary: running import is primary, with batch position and queue size', () => {
  const ops = buildOperations({
    ...idle,
    importQueue: [job('a', 'active'), job('q1', 'queued'), job('q2', 'queued')],
    isAnalyzing: true,
  })
  const s = summarize(ops, { done: 2, total: 7 })
  assert.equal(s.primary.id, 'a')
  assert.equal(s.othersRunning, 1)
  assert.equal(s.queued, 2)
  assert.deepEqual(s.batch, { position: 3, total: 7 })
})

test('summary: single-job batch shows no position', () => {
  const ops = buildOperations({ ...idle, importQueue: [job('a', 'active')] })
  assert.equal(summarize(ops, { done: 0, total: 1 }).batch, null)
})

test('summary: no running import shows no position', () => {
  const ops = buildOperations({ ...idle, isScanning: true })
  const s = summarize(ops, EMPTY_BATCH)
  assert.equal(s.primary.id, 'scan')
  assert.equal(s.batch, null)
  assert.equal(s.othersRunning, 0)
})

test('summary: gap between jobs keeps the first queued job as primary', () => {
  const ops = buildOperations({ ...idle, importQueue: [job('q1', 'queued'), job('q2', 'queued')] })
  const s = summarize(ops, { done: 1, total: 3 })
  assert.equal(s.primary.id, 'q1')
  assert.equal(s.queued, 2)
  assert.equal(s.othersRunning, 0)
  assert.equal(s.batch, null)
})

test('summary: empty list', () => {
  assert.deepEqual(summarize([], EMPTY_BATCH), { primary: null, othersRunning: 0, queued: 0, batch: null })
})

test('progress fraction is null without a total, clamped otherwise', () => {
  assert.equal(progressFraction({ id: 's', kind: 'scan', title: 't', status: 'running' }), null)
  assert.equal(progressFraction({ id: 'q', kind: 'import', title: 't', status: 'queued', total: 5 }), null)
  assert.equal(progressFraction({ id: 'a', kind: 'import', title: 't', status: 'running', current: 0, total: 0 }), null)
  assert.equal(progressFraction({ id: 'a', kind: 'import', title: 't', status: 'running', current: 11, total: 25 }), 0.44)
  assert.equal(progressFraction({ id: 'a', kind: 'import', title: 't', status: 'running', current: 30, total: 25 }), 1)
})
