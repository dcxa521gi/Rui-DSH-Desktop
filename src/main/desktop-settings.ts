import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ThemePreference = 'system' | 'light' | 'dark'

export type EngineState = {
  source: 'bundled' | 'installed'
  version: string
  dir?: string
  pending?: {
    version: string
    dir: string
  }
}

export type DesktopSettings = {
  autoCheckApp: boolean
  theme: ThemePreference
  githubOwner: string
  githubRepo: string
  engine: EngineState
  imWorkspaceId: string
  imWorkspaceTitle: string
}

const DEFAULTS: DesktopSettings = {
  autoCheckApp: true,
  theme: 'system',
  githubOwner: 'dcxa521gi',
  githubRepo: 'Rui-DSH-Desktop',
  engine: { source: 'bundled', version: '' },
  imWorkspaceId: '',
  imWorkspaceTitle: 'IM',
}

let filePath = ''
let cache: DesktopSettings = { ...DEFAULTS }

export function settingsPath(): string {
  return filePath
}

export function initDesktopSettings(userDataDir: string, bundledVersion: string): DesktopSettings {
  filePath = join(userDataDir, 'desktop-settings.json')
  cache = load(bundledVersion)
  return cache
}

export function getDesktopSettings(): DesktopSettings {
  return cache
}

export function updateDesktopSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  cache = {
    ...cache,
    ...patch,
    engine: patch.engine !== undefined ? patch.engine : cache.engine,
  }
  persist()
  return cache
}

function load(bundledVersion: string): DesktopSettings {
  const fallback: DesktopSettings = {
    ...DEFAULTS,
    engine: { source: 'bundled', version: bundledVersion },
  }
  if (!existsSync(filePath)) return fallback
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<DesktopSettings>
    const theme =
      raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system' ? raw.theme : 'system'
    const source = raw.engine?.source === 'installed' ? 'installed' : 'bundled'
    return {
      autoCheckApp: raw.autoCheckApp !== false,
      theme,
      githubOwner: typeof raw.githubOwner === 'string' ? raw.githubOwner.trim() : '',
      githubRepo: typeof raw.githubRepo === 'string' ? raw.githubRepo.trim() : '',
      imWorkspaceId: typeof raw.imWorkspaceId === 'string' ? raw.imWorkspaceId : '',
      imWorkspaceTitle:
        typeof raw.imWorkspaceTitle === 'string' && raw.imWorkspaceTitle.trim() !== ''
          ? raw.imWorkspaceTitle.trim()
          : 'IM',
      engine: {
        source,
        version:
          typeof raw.engine?.version === 'string' && raw.engine.version !== ''
            ? raw.engine.version
            : bundledVersion,
        dir: typeof raw.engine?.dir === 'string' ? raw.engine.dir : undefined,
        pending:
          raw.engine?.pending !== undefined &&
          typeof raw.engine.pending.version === 'string' &&
          typeof raw.engine.pending.dir === 'string'
            ? raw.engine.pending
            : undefined,
      },
    }
  } catch {
    return fallback
  }
}

function persist(): void {
  if (filePath === '') return
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(cache, null, 2)}\n`)
}
