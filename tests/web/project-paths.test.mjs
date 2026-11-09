import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectForPath } from '../../src/lib/projectPaths.ts'

const projects = [
  { name: 'M31', path: '/lib/M31' },
  { name: 'M31 Andromeda', path: '/lib/M31 Andromeda' },
]

test('a path inside a project resolves to that project', () => {
  assert.equal(projectForPath(projects, '/lib/M31/L/Night 3/lights')?.name, 'M31')
})

test('a project whose name extends another one is not confused with it', () => {
  assert.equal(projectForPath(projects, '/lib/M31 Andromeda/L/Night 3/lights')?.name, 'M31 Andromeda')
  assert.equal(projectForPath([...projects].reverse(), '/lib/M31/L/Night 3/lights')?.name, 'M31')
})

test('the project folder itself matches', () => {
  assert.equal(projectForPath(projects, '/lib/M31')?.name, 'M31')
})

test('Windows separators and a trailing separator are accepted', () => {
  const win = [{ name: 'M42', path: 'D:\\Astro\\M42' }, { name: 'M42 HDR', path: 'D:\\Astro\\M42 HDR\\' }]
  assert.equal(projectForPath(win, 'D:\\Astro\\M42\\Ha\\Night 1\\flats')?.name, 'M42')
  assert.equal(projectForPath(win, 'D:\\Astro\\M42 HDR\\Ha\\Night 1\\lights')?.name, 'M42 HDR')
})

test('a path outside every project resolves to nothing', () => {
  assert.equal(projectForPath(projects, '/lib/M3/L/Night 1/lights'), undefined)
  assert.equal(projectForPath(projects, '/other/M31/L'), undefined)
})
