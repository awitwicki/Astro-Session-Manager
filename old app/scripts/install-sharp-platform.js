/**
 * Installs sharp platform-specific binaries for cross-platform electron-builder builds.
 * yarn/npm skip optionalDependencies that don't match the host OS/CPU, so this script
 * manually downloads and extracts them via `npm pack` + `tar`.
 *
 * Usage: node scripts/install-sharp-platform.js <os> <cpu>
 * Example: node scripts/install-sharp-platform.js win32 x64
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const targetOS = process.argv[2]
const targetCPU = process.argv[3]

if (!targetOS || !targetCPU) {
  console.error('Usage: node scripts/install-sharp-platform.js <os> <cpu>')
  process.exit(1)
}

const projectRoot = path.join(__dirname, '..')

// Read the installed sharp version to ensure platform packages match
const sharpPkgPath = path.join(projectRoot, 'node_modules', 'sharp', 'package.json')
const sharpVersion = JSON.parse(fs.readFileSync(sharpPkgPath, 'utf-8')).version
const pkg = `@img/sharp-${targetOS}-${targetCPU}`
const pkgWithVersion = `${pkg}@${sharpVersion}`
const dest = path.join(projectRoot, 'node_modules', '@img', `sharp-${targetOS}-${targetCPU}`)

if (fs.existsSync(path.join(dest, 'package.json'))) {
  const installedVersion = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf-8')).version
  if (installedVersion === sharpVersion) {
    console.log(`${pkgWithVersion} already installed, skipping.`)
    process.exit(0)
  }
  console.log(`Version mismatch (${installedVersion} vs ${sharpVersion}), reinstalling...`)
  fs.rmSync(dest, { recursive: true, force: true })
}

console.log(`Installing ${pkgWithVersion} for cross-platform build...`)

const tmpDir = path.join(projectRoot, '.sharp-tmp')
fs.mkdirSync(tmpDir, { recursive: true })

try {
  // Download the package tarball (run from tmpDir to avoid side effects in project root)
  const tgzName = execSync(`npm pack ${pkgWithVersion} --ignore-scripts`, {
    encoding: 'utf-8',
    cwd: tmpDir
  }).trim().split('\n').pop()

  const tgzPath = path.join(tmpDir, tgzName)

  // Extract to node_modules
  fs.mkdirSync(dest, { recursive: true })
  execSync(`tar xzf "${tgzPath}" --strip-components=1 -C "${dest}"`)

  console.log(`${pkg} installed successfully.`)
} finally {
  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
