#!/usr/bin/env node
/**
 * Compare the pinned @deepseek-ai/dsh version with npm latest.
 * Prints human-readable output; exits 0 even when a newer version exists.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const pinned = String(pkg.dependencies['@deepseek-ai/dsh'] ?? '')

let installed = 'missing'
try {
  installed = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version
} catch {
  installed = 'not installed'
}

const response = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh/latest', {
  signal: AbortSignal.timeout(20_000),
})
if (!response.ok) {
  console.error(`check-upstream: npm registry HTTP ${response.status}`)
  process.exit(1)
}
const latest = (await response.json()).version
const update = latest !== pinned ? 'true' : 'false'
console.log(`pinned=${pinned}`)
console.log(`installed=${installed}`)
console.log(`latest=${latest}`)
console.log(`update=${update}`)
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `pinned=${pinned}\nlatest=${latest}\nupdate=${update}\n`,
  )
}
