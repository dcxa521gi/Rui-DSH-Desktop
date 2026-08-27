#!/usr/bin/env node
/**
 * Headless smoke test for the embedded @deepseek-ai/dsh engine.
 * Boots `dsh web --no-open --host 127.0.0.1 --port 0` under plain Node,
 * fetches the served page, then SIGTERM and expects a clean exit.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const BOOT_TIMEOUT_MS = 120_000
const URL_LINE_PATTERN = /https?:\/\/127\.0\.0\.1:\d+/
const PINNED = '0.1.1-rc.2'

function fail(message) {
  console.error(`smoke: FAIL — ${message}`)
  process.exit(1)
}

function resolveDshEntry() {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

function pinnedVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const version = pkg.dependencies?.['@deepseek-ai/dsh']
  if (typeof version !== 'string') fail('package.json is missing a pinned @deepseek-ai/dsh')
  return version.replace(/^[^\d]*/, '') || version
}

const expected = pinnedVersion()
if (expected !== PINNED) {
  fail(`expected pinned @deepseek-ai/dsh ${PINNED}, found ${expected}`)
}

const installed = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh/package.json'), 'utf8'))
if (installed.version !== expected) {
  fail(`installed @deepseek-ai/dsh ${installed.version} does not match pin ${expected}`)
}

const home = await mkdtemp(join(tmpdir(), 'dsh-smoke-'))
const entryIndex = process.argv.indexOf('--entry')
const entry = resolve(entryIndex >= 0 ? process.argv[entryIndex + 1] : resolveDshEntry())
const args = ['web', '--no-open', '--host', '127.0.0.1', '--port', '0']

let stdout = ''
let stderr = ''
const child = spawn(process.execPath, ['--expose-internals', entry, ...args], {
  cwd: home,
  env: {
    ...process.env,
    DSH_HOME: join(home, 'dsh-home'),
    DSH_TELEMETRY_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdout += chunk
})
child.stderr.on('data', (chunk) => {
  stderr += chunk
})

let ready = false
const url = await new Promise((resolveUrl) => {
  const timer = setTimeout(() => {
    fail(`no URL within ${BOOT_TIMEOUT_MS}ms\n${stderr}\n${stdout}`)
  }, BOOT_TIMEOUT_MS)
  const onData = (chunk) => {
    const match = chunk.match(URL_LINE_PATTERN)
    if (match !== null) {
      ready = true
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolveUrl(match[0])
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.once('exit', (code, signal) => {
    if (!ready) {
      fail(`engine exited before readiness (code ${String(code)}, signal ${String(signal)})\n${stderr}\n${stdout}`)
    }
  })
})

let status = 0
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  status = response.status
  await response.arrayBuffer()
} catch (error) {
  child.kill('SIGKILL')
  fail(`GET ${url} failed: ${String(error)}\n${stderr}`)
}
if (status !== 200) {
  child.kill('SIGKILL')
  fail(`GET ${url} -> HTTP ${String(status)} (expected 200)\n${stderr}`)
}
console.log(`smoke: engine serves ${url} (HTTP 200), pinned @deepseek-ai/dsh ${expected}`)

child.kill('SIGTERM')
const exit = await new Promise((resolveExit) => {
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
    resolveExit({ code: null, signal: 'SIGKILL-after-timeout' })
  }, 15_000)
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    resolveExit({ code, signal })
  })
})
if (exit.code !== 0 && exit.signal !== 'SIGTERM') {
  fail(`engine did not shut down cleanly: code ${String(exit.code)} signal ${String(exit.signal)}`)
}

await rm(home, { recursive: true, force: true })
console.log('smoke: OK — embedded engine boots, serves, and shuts down')
