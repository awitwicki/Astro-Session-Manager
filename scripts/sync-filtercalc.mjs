// The website's filter calculator (docs/filtercalc) runs the same math and
// chart geometry as the app. GitHub Pages serves plain files, so the two
// TypeScript modules are transpiled to JavaScript and committed.
//
//   yarn sync:filtercalc
//
// tests/web/fbsc.test.mjs fails when the committed copies are stale.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const MODULES = ['fbsc', 'fbscCharts']

const root = new URL('..', import.meta.url)
export const sourcePath = (name) => fileURLToPath(new URL(`src/lib/${name}.ts`, root))
export const outputPath = (name) => fileURLToPath(new URL(`docs/filtercalc/js/${name}.js`, root))

export function transpile(name) {
  const js = ts.transpileModule(readFileSync(sourcePath(name), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  // Browsers need the extension on relative imports.
  const linked = js.replace(/from '\.\/(\w+)'/g, "from './$1.js'")
  return `// Generated from src/lib/${name}.ts by scripts/sync-filtercalc.mjs. Do not edit.\n${linked}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const name of MODULES) writeFileSync(outputPath(name), transpile(name))
}
