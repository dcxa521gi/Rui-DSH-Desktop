import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HARNESS_HOST, pickEphemeralPort, resolveBundledDshVersion } from './harness.js'
import { getDesktopSettings, updateDesktopSettings } from './desktop-settings.js'
import { log } from './log.js'
import { resolvePnpmCli } from './shims.js'

const DSH_PACKAGE = '@deepseek-ai/dsh'
const MIN_SCOPED_PACKAGES = 150
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const SMOKE_TIMEOUT_MS = 90_000
const URL_PATTERN = /https?:\/\/127\.0\.0\.1:\d+/

export type KernelProgress = {
  phase: 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'error'
  message: string
}

export type KernelCheckResult = {
  current: string
  latest: string
  source: 'bundled' | 'installed'
  updateAvailable: boolean
  pending?: { version: string; dir: string }
}

type ProgressFn = (progress: KernelProgress) => void

function engineRoot(userDataDir: string): string {
  return join(userDataDir, 'engine')
}

export function bundledDshVersion(): string {
  return resolveBundledDshVersion()
}

export function activeEngineEntry(userDataDir: string): string | undefined {
  const engine = getDesktopSettings().engine
  if (engine.source !== 'installed' || engine.dir === undefined) return undefined
  const entry = join(engine.dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return existsSync(entry) ? entry : undefined
}

export async function checkKernelUpdate(): Promise<KernelCheckResult> {
  const settings = getDesktopSettings()
  const current =
    settings.engine.source === 'installed' && settings.engine.version !== ''
      ? settings.engine.version
      : bundledDshVersion()
  const response = await fetch(`https://registry.npmjs.org/${DSH_PACKAGE}/latest`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    throw new Error(`npm registry HTTP ${String(response.status)}`)
  }
  const body = (await response.json()) as { version?: string }
  const latest = body.version
  if (typeof latest !== 'string' || latest === '') {
    throw new Error('npm registry did not return a version')
  }
  return {
    current,
    latest,
    source: settings.engine.source,
    updateAvailable: latest !== current,
    pending: settings.engine.pending,
  }
}

export async function downloadKernelUpdate(
  userDataDir: string,
  onProgress: ProgressFn,
): Promise<KernelCheckResult> {
  const check = await checkKernelUpdate()
  if (!check.updateAvailable) {
    onProgress({ phase: 'idle', message: '已是最新内核，无需下载。' })
    return check
  }
  const pnpmCli = resolvePnpmCli()
  if (pnpmCli === undefined) {
    throw new Error('bundled pnpm not found')
  }

  const staging = join(engineRoot(userDataDir), 'staging', check.latest)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  writeFileSync(
    join(staging, 'package.json'),
    `${JSON.stringify({ private: true, dependencies: { [DSH_PACKAGE]: check.latest } }, null, 2)}\n`,
  )
  writeFileSync(
    join(staging, '.npmrc'),
    ['auto-install-peers=true', 'shamefully-hoist=true', 'registry=https://registry.npmjs.org/', ''].join(
      '\n',
    ),
  )

  onProgress({ phase: 'downloading', message: `正在下载 ${DSH_PACKAGE}@${check.latest}…` })
  await runElectronNode(pnpmCli, ['install', '--ignore-scripts=false'], staging, INSTALL_TIMEOUT_MS)

  onProgress({ phase: 'verifying', message: '正在校验依赖完整性…' })
  const scoped = join(staging, 'node_modules', '@deepseek-ai')
  const count = existsSync(scoped) ? readdirSync(scoped).length : 0
  if (count < MIN_SCOPED_PACKAGES) {
    throw new Error(`内核不完整：只找到 ${String(count)} 个 @deepseek-ai 包（需要至少 ${String(MIN_SCOPED_PACKAGES)}）`)
  }
  const entry = join(scoped, 'dsh', 'lib', 'bin.js')
  if (!existsSync(entry)) {
    throw new Error('内核不完整：缺少 dsh/lib/bin.js')
  }

  onProgress({ phase: 'verifying', message: '正在冒烟启动内核…' })
  await smokeEngine(entry)

  const readyDir = join(engineRoot(userDataDir), check.latest)
  rmSync(readyDir, { recursive: true, force: true })
  await renameDir(staging, readyDir)

  updateDesktopSettings({
    engine: {
      ...getDesktopSettings().engine,
      pending: { version: check.latest, dir: readyDir },
    },
  })
  onProgress({
    phase: 'ready',
    message: `内核 ${check.latest} 已下载并验证通过，可以更新。`,
  })
  log('info', `kernel ${check.latest} staged at ${readyDir} (${String(count)} packages)`)
  return checkKernelUpdate()
}

export function applyPendingKernel(): { version: string } {
  const settings = getDesktopSettings()
  const pending = settings.engine.pending
  if (pending === undefined || !existsSync(join(pending.dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
    throw new Error('没有已验证的内核可更新')
  }
  updateDesktopSettings({
    engine: {
      source: 'installed',
      version: pending.version,
      dir: pending.dir,
    },
  })
  log('info', `kernel applied ${pending.version}`)
  return { version: pending.version }
}

export function revertToBundledKernel(): { version: string } {
  const version = bundledDshVersion()
  updateDesktopSettings({
    engine: { source: 'bundled', version },
  })
  log('info', 'kernel reverted to bundled')
  return { version }
}

async function renameDir(from: string, to: string): Promise<void> {
  const { rename, cp } = await import('node:fs/promises')
  try {
    await rename(from, to)
  } catch {
    await cp(from, to, { recursive: true, dereference: true })
    rmSync(from, { recursive: true, force: true })
  }
}

function runElectronNode(
  script: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-internals', script, ...args], {
      cwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        npm_config_yes: 'true',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let err = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      err += chunk
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`timed out after ${String(timeoutMs)}ms\n${err.slice(-2000)}`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`exit ${String(code)}\n${err.slice(-2000)}`))
    })
  })
}

async function smokeEngine(entry: string): Promise<void> {
  const port = await pickEphemeralPort()
  const child = spawn(
    process.execPath,
    ['--expose-internals', entry, 'web', '--no-open', '--host', HARNESS_HOST, '--port', String(port)],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_TELEMETRY_DISABLED: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let out = ''
  let err = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    out += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    err += chunk
  })
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`smoke: no URL within ${String(SMOKE_TIMEOUT_MS)}ms\n${err.slice(-1500)}`))
      }, SMOKE_TIMEOUT_MS)
      const consider = (chunk: string) => {
        const match = chunk.match(URL_PATTERN)
        if (match !== null) {
          clearTimeout(timer)
          resolve(match[0])
        }
      }
      child.stdout?.on('data', consider)
      child.stderr?.on('data', consider)
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`smoke: exited ${String(code)}\n${err.slice(-1500)}\n${out.slice(-1500)}`))
      })
    })
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`smoke: HTTP ${String(response.status)}`)
    }
    await sleep(4_000)
    if (child.exitCode !== null) {
      throw new Error(`smoke: process died after ready (code ${String(child.exitCode)})\n${err.slice(-1500)}`)
    }
  } finally {
    child.kill()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
