import { spawn, type ChildProcess, type Serializable } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { log } from './log.js'
import { installRuntimeShims } from './shims.js'

const require = createRequire(import.meta.url)

let engineOverride: string | undefined

export const HARNESS_HOST = '127.0.0.1'
export const READY_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 250
export const STOP_GRACE_MS = 5_000
const NODE_MODE_ENV = 'ELECTRON_RUN_AS_NODE'
export const HARNESS_LOG_FILENAME = 'dsh-web.log'
const HARNESS_LOG_MAX_BYTES = 2 * 1024 * 1024

function toFilesystemPath(filePath: string): string {
  const marker = `${sep}app.asar${sep}`
  const unpacked = `${sep}app.asar.unpacked${sep}`
  if (!filePath.includes(marker)) return filePath
  const candidate = filePath.replace(marker, unpacked)
  return existsSync(candidate) ? candidate : filePath
}

function nodeModulesDir(fromFile: string): string | undefined {
  const needle = `${sep}node_modules${sep}`
  const index = fromFile.lastIndexOf(needle)
  if (index === -1) return undefined
  return fromFile.slice(0, index + 'node_modules'.length)
}

function pluginPath(): string {
  return toFilesystemPath(
    fileURLToPath(new URL('../plugins/dsh-desktop-native-picker.mjs', import.meta.url)),
  )
}

export function writeCompositionPatch(patchPath: string): string {
  const pluginUrl = pathToFileURL(pluginPath()).href
  const content = [
    '# Rui DSH Desktop runtime composition (regenerated on every boot).',
    '- id: directory-picker',
    '  disabled: true',
    '- insert:',
    '    - id: directory-picker-desktop-backend',
    `      name: ${JSON.stringify(pluginUrl)}`,
    '    - id: directory-picker-desktop-surface',
    "      name: '@deepseek-ai/dsh-client-ui-directory-picker-native'",
    '',
  ].join('\n')
  writeFileSync(patchPath, content)
  return patchPath
}

function canUseDesktopPicker(): boolean {
  try {
    require.resolve('@deepseek-ai/dsh-host-directory-picker')
    require.resolve('@deepseek-ai/dsh-client-ui-directory-picker-native')
    return existsSync(pluginPath())
  } catch {
    return false
  }
}

export function resolveDshEntry(): string {
  if (engineOverride !== undefined && existsSync(engineOverride)) {
    return toFilesystemPath(engineOverride)
  }
  const manifest = toFilesystemPath(require.resolve('@deepseek-ai/dsh/package.json'))
  return join(dirname(manifest), 'lib', 'bin.js')
}

export function setEngineOverride(entry: string | undefined): void {
  engineOverride = entry
}

export function resolveBundledDshVersion(): string {
  try {
    const manifest = toFilesystemPath(require.resolve('@deepseek-ai/dsh/package.json'))
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function resolveDshVersion(): string {
  try {
    const manifest =
      engineOverride !== undefined
        ? join(dirname(engineOverride), '..', 'package.json')
        : toFilesystemPath(require.resolve('@deepseek-ai/dsh/package.json'))
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function pickEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, HARNESS_HOST, () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close()
        reject(new Error('failed to allocate loopback port'))
        return
      }
      const { port } = address
      probe.close(() => {
        resolve(port)
      })
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export type HarnessServerOptions = {
  port: number
  logDir: string
  userDataDir: string
  onUnexpectedExit?: (code: number | null, signal: NodeJS.Signals | null | string) => void
  onChildMessage?: (message: unknown, send: (reply: Serializable) => void) => void
}

export class HarnessServer {
  readonly port: number
  readonly logDir: string
  readonly userDataDir: string
  private readonly onUnexpectedExit?: HarnessServerOptions['onUnexpectedExit']
  private readonly onChildMessage?: HarnessServerOptions['onChildMessage']
  private child: ChildProcess | undefined
  private logStream: WriteStream | undefined
  private stopping = false

  constructor(options: HarnessServerOptions) {
    this.port = options.port
    this.logDir = options.logDir
    this.userDataDir = options.userDataDir
    this.onUnexpectedExit = options.onUnexpectedExit
    this.onChildMessage = options.onChildMessage
  }

  get url(): string {
    return `http://${HARNESS_HOST}:${String(this.port)}`
  }

  get logPath(): string {
    return join(this.logDir, HARNESS_LOG_FILENAME)
  }

  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null
  }

  start(): void {
    if (this.running) throw new Error('harness engine already running')
    const entry = resolveDshEntry()
    const modulesDir = nodeModulesDir(entry)
    const args = ['web', '--no-open', '--host', HARNESS_HOST, '--port', String(this.port)]
    if (canUseDesktopPicker()) {
      const compositionPatch = writeCompositionPatch(
        join(this.userDataDir, 'desktop-composition.patch.yml'),
      )
      args.splice(1, 0, '--patch', compositionPatch)
      log('info', `desktop directory picker overlay: ${compositionPatch}`)
    } else {
      log('warn', 'desktop directory picker packages not found; using upstream picker')
    }

    const nodeArgs = ['--expose-internals', entry, ...args]
    const shimDir = installRuntimeShims(this.userDataDir)
    const pathSep = process.platform === 'win32' ? ';' : ':'
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [NODE_MODE_ENV]: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      PATH: `${shimDir}${pathSep}${process.env.PATH ?? ''}`,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
    }
    if (modulesDir !== undefined) {
      env.NODE_PATH = [modulesDir, process.env.NODE_PATH].filter(Boolean).join(pathSep)
    }

    mkdirSync(this.logDir, { recursive: true })
    const logFile = this.logPath
    if (existsSync(logFile)) {
      try {
        if (statSync(logFile).size > HARNESS_LOG_MAX_BYTES) {
          createWriteStream(logFile, { flags: 'w' }).end()
        }
      } catch {
        // Rotation is best-effort.
      }
    }
    this.logStream = createWriteStream(logFile, { flags: 'a' })
    log('info', `spawning dsh: ${process.execPath} ${nodeArgs.join(' ')}`)
    this.child = spawn(process.execPath, nodeArgs, {
      cwd: homedir(),
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    this.stopping = false
    this.child.stdout?.pipe(this.logStream, { end: false })
    this.child.stderr?.pipe(this.logStream, { end: false })
    if (this.onChildMessage !== undefined) {
      this.child.on('message', (message) => {
        this.onChildMessage?.(message, (reply: Serializable) => {
          this.child?.send?.(reply)
        })
      })
    }
    this.child.on('error', (error) => {
      this.logStream?.write(`spawn error: ${String(error)}\n`)
      this.onUnexpectedExit?.(undefined as unknown as number | null, String(error))
    })
    this.child.once('exit', (code, signal) => {
      this.logStream?.end()
      this.logStream = undefined
      if (!this.stopping) this.onUnexpectedExit?.(code, signal)
    })
  }

  async waitReady({ timeoutMs = READY_TIMEOUT_MS } = {}): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (!this.running) {
        const tail = existsSync(this.logPath) ? readFileSync(this.logPath, 'utf8').slice(-4000) : ''
        throw new Error(
          `harness engine exited before becoming ready (log: ${this.logPath})\n${tail}`.trim(),
        )
      }
      let answered = false
      try {
        const response = await fetch(this.url, { signal: AbortSignal.timeout(2_000) })
        answered = response.status > 0
      } catch {
        // Not listening yet, or the process died during the probe.
      }
      if (answered) {
        // HTTP can succeed while plugins are still loading; wait so a crash is not a false ready.
        await sleep(1_500)
        if (!this.running) {
          const tail = existsSync(this.logPath) ? readFileSync(this.logPath, 'utf8').slice(-4000) : ''
          throw new Error(
            `harness engine exited after answering ${this.url} (log: ${this.logPath})\n${tail}`.trim(),
          )
        }
        return
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `harness engine did not answer ${this.url} within ${String(timeoutMs)}ms (log: ${this.logPath})`,
        )
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  async stop({ graceMs = STOP_GRACE_MS } = {}): Promise<void> {
    if (this.child === undefined) return
    this.stopping = true
    const child = this.child
    this.child = undefined
    if (child.exitCode !== null) return
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => {
        resolve()
      })
    })
    try {
      child.kill('SIGTERM')
    } catch {
      return
    }
    const graceful = await Promise.race([
      exited.then(() => true),
      sleep(graceMs).then(() => false),
    ])
    if (!graceful && child.exitCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Best effort.
      }
      await exited
    }
  }
}
