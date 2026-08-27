import { app, BrowserWindow, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDesktopSettings } from './desktop-settings.js'
import { log } from './log.js'

export type AppCheckResult = {
  updateAvailable: boolean
  message: string
  latest?: string
  url?: string
}

let lastCheck: AppCheckResult | undefined

export function lastAppCheck(): AppCheckResult | undefined {
  return lastCheck
}

function packageRepository(): { owner: string; repo: string } | undefined {
  try {
    const pkgPath = join(app.getAppPath(), 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      repository?: { url?: string } | string
    }
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    if (typeof url !== 'string') return undefined
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/i)
    if (match === null) return undefined
    return { owner: match[1], repo: match[2] }
  } catch {
    return undefined
  }
}

export function githubRepo(): { owner: string; repo: string } | undefined {
  const settings = getDesktopSettings()
  if (settings.githubOwner !== '' && settings.githubRepo !== '') {
    return { owner: settings.githubOwner, repo: settings.githubRepo }
  }
  return packageRepository()
}

function versionParts(value: string): number[] {
  return value.replace(/^v/i, '').split(/[.-]/).map((part) => {
    const n = Number.parseInt(part, 10)
    return Number.isFinite(n) ? n : 0
  })
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = versionParts(latest)
  const b = versionParts(current)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

function remember(result: AppCheckResult): AppCheckResult {
  lastCheck = result
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('desktop:app-update', result)
  }
  return result
}

export async function checkAppUpdate(currentVersion: string): Promise<AppCheckResult> {
  const repo = githubRepo()
  if (repo === undefined) {
    return remember({
      updateAvailable: false,
      message: '尚未配置 GitHub 仓库，无法检测客户端更新。在上方填写 owner/repo 后保存即可。',
    })
  }
  const response = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Rui-DSH-Desktop',
      },
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (response.status === 404) {
    return remember({
      updateAvailable: false,
      message: `仓库 ${repo.owner}/${repo.repo} 没有 latest Release。`,
    })
  }
  if (!response.ok) {
    throw new Error(`GitHub HTTP ${String(response.status)}`)
  }
  const body = (await response.json()) as { tag_name?: string; html_url?: string }
  const latest = String(body.tag_name ?? '').replace(/^v/i, '')
  const url = typeof body.html_url === 'string' ? body.html_url : undefined
  if (latest !== '' && isNewerVersion(latest, currentVersion)) {
    return remember({
      updateAvailable: true,
      latest,
      url,
      message: `发现客户端 ${latest}（当前 ${currentVersion}）。${url !== undefined ? `\n${url}` : ''}`,
    })
  }
  return remember({
    updateAvailable: false,
    latest: latest === '' ? undefined : latest,
    url,
    message: `客户端已是最新 ${currentVersion}。`,
  })
}

export function initUpdater(): void {
  if (!getDesktopSettings().autoCheckApp) {
    log('info', 'updater: skipped (auto-check disabled)')
    return
  }
  void checkAppUpdate(app.getVersion())
    .then((result) => {
      log('info', `updater: ${result.message}`)
    })
    .catch((error: unknown) => {
      log('warn', `updater: ${String(error)}`)
    })
}

export async function openAppRelease(url?: string): Promise<void> {
  if (url !== undefined) {
    await shell.openExternal(url)
    return
  }
  const repo = githubRepo()
  if (repo === undefined) return
  await shell.openExternal(`https://github.com/${repo.owner}/${repo.repo}/releases`)
}
