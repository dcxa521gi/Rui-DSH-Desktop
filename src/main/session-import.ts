import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { harnessRpc, type WorkspaceRow } from './harness-rpc.js'
import { log } from './log.js'

export type ImportSource = 'claude' | 'codex'

export type ImportItem = {
  id: string
  source: ImportSource
  title: string
  path: string
  mtime: number
  preview: string
  messageCount: number
}

const SCAN_LIMIT = 200
const PREVIEW_BYTES = 64_000
const IMPORT_BYTES = 1_500_000
const PROMPT_CHARS = 12_000
const MARKDOWN_CHARS = 400_000

let importDir = ''
let getHarnessUrl: () => string | undefined = () => undefined

export function initSessionImport(userDataDir: string, urlFn: () => string | undefined): void {
  importDir = join(userDataDir, 'import-workspace')
  getHarnessUrl = urlFn
  mkdirSync(importDir, { recursive: true })
}

export function listImportableSessions(): ImportItem[] {
  const items = [...scanRoot('claude', join(homedir(), '.claude', 'projects')), ...scanRoot('codex', join(homedir(), '.codex'))]
  items.sort((a, b) => b.mtime - a.mtime)
  return items.slice(0, SCAN_LIMIT)
}

export async function importSessions(ids: unknown): Promise<{ imported: number; failed: number; message: string }> {
  const wanted = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
  if (wanted.size === 0) return { imported: 0, failed: 0, message: '请先勾选要导入的会话。' }
  const catalog = listImportableSessions().filter((item) => wanted.has(item.id))
  if (catalog.length === 0) return { imported: 0, failed: 0, message: '没有匹配的会话文件。' }
  const url = getHarnessUrl()
  if (url === undefined) throw new Error('引擎未就绪，请等官方界面加载完成后再导入。')
  const workspaceId = await ensureImportWorkspace(url)
  let imported = 0
  let failed = 0
  for (const item of catalog) {
    try {
      await importOne(url, workspaceId, item)
      imported += 1
    } catch (error) {
      failed += 1
      log('warn', `import ${item.id}: ${String(error)}`)
    }
  }
  return {
    imported,
    failed,
    message: `已导入 ${String(imported)} 个会话${failed > 0 ? `，失败 ${String(failed)} 个` : ''}。请看侧边栏「导入」工作区。`,
  }
}

async function ensureImportWorkspace(url: string): Promise<string> {
  mkdirSync(importDir, { recursive: true })
  const listed = await harnessRpc<{ items: WorkspaceRow[] }>(url, 'workspace.list', {})
  const existing =
    listed.items.find((row) => samePath(row.path, importDir)) ??
    listed.items.find((row) => row.title === '导入')
  if (existing !== undefined) return existing.workspaceId
  const created = await harnessRpc<{ workspace: WorkspaceRow }>(url, 'workspace.create', { path: importDir })
  const workspaceId = created.workspace.workspaceId
  if (created.workspace.title !== '导入') {
    await harnessRpc(url, 'workspace.rename', { workspaceId, title: '导入' })
  }
  return workspaceId
}

async function importOne(url: string, workspaceId: string, item: ImportItem): Promise<void> {
  const raw = readFileHead(item.path, IMPORT_BYTES)
  const turns = collectTurns(raw)
  const transcript = turns
    .map((turn) => `### ${turn.role === 'assistant' ? '助手' : '用户'}\n\n${turn.text}`)
    .join('\n\n')
  const fileName = `${safeFileName(item.source, item.title)}.md`
  writeFileSync(
    join(importDir, fileName),
    [
      `# ${item.title}`,
      '',
      `- 来源：${item.source === 'claude' ? 'Claude Code' : 'Codex'}`,
      `- 文件：\`${item.path}\``,
      '',
      transcript.slice(0, MARKDOWN_CHARS) || '（未能解析出文本内容，请直接打开原 jsonl。）',
      '',
    ].join('\n'),
  )
  const created = await harnessRpc<{ sessionId: string }>(url, 'session.create', { workspaceId })
  const sessionId = created.sessionId
  const title = `${item.source === 'claude' ? 'Claude' : 'Codex'} · ${item.title}`.slice(0, 60)
  await harnessRpc(url, 'session.rename', { sessionId, title })
  const summary = (transcript === '' ? item.preview : transcript).slice(0, PROMPT_CHARS)
  await harnessRpc(url, 'session.prompt', {
    sessionId,
    mode: 'queue',
    content: [
      {
        type: 'text',
        text: `以下为从 ${item.source === 'claude' ? 'Claude Code' : 'Codex'} 导入的历史会话「${item.title}」。完整记录已写入工作区文件 ${fileName}。请阅读该文件了解上下文，不要重新执行其中的命令。\n\n${summary}`,
      },
    ],
  })
}

function scanRoot(source: ImportSource, root: string): ImportItem[] {
  if (!existsSync(root)) return []
  const files = listJsonl(root)
  const items: ImportItem[] = []
  for (const file of files) {
    const parsed = summarizeFile(source, file)
    if (parsed !== undefined) items.push(parsed)
  }
  return items
}

function listJsonl(root: string): string[] {
  try {
    const names = readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[]
    return names
      .filter((name) => name.endsWith('.jsonl') && !name.includes('node_modules'))
      .map((name) => join(root, name))
      .slice(0, SCAN_LIMIT)
  } catch {
    return []
  }
}

function summarizeFile(source: ImportSource, file: string): ImportItem | undefined {
  try {
    const raw = readFileHead(file, PREVIEW_BYTES)
    const turns = collectTurns(raw)
    const firstUser = turns.find((turn) => turn.role === 'user')?.text.trim() ?? ''
    const title = (firstUser.split(/\r?\n/)[0] ?? basename(file, '.jsonl')).slice(0, 48) || basename(file, '.jsonl')
    return {
      id: `${source}:${file}`,
      source,
      title,
      path: file,
      mtime: statSync(file).mtimeMs,
      preview: (firstUser || turns[0]?.text || '').slice(0, 120),
      messageCount: turns.length,
    }
  } catch {
    return undefined
  }
}

function collectTurns(raw: string): Array<{ role: string; text: string }> {
  const turns: Array<{ role: string; text: string }> = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const type = typeof obj.type === 'string' ? obj.type : ''
      const message = asRecord(obj.message)
      const roleFromMessage = typeof message?.role === 'string' ? message.role : ''
      const role =
        roleFromMessage === 'user' || roleFromMessage === 'assistant'
          ? roleFromMessage
          : type === 'user' || type === 'assistant'
            ? type
            : ''
      const content = message?.content ?? obj.content ?? asRecord(obj.payload)?.content
      const text = extractText(content)
      if (role !== '' && text.trim() !== '') turns.push({ role, text })
    } catch {
      // Skip malformed jsonl lines.
    }
  }
  return turns
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    const rec = asRecord(item)
    if (rec !== undefined && typeof rec.text === 'string') parts.push(rec.text)
  }
  return parts.join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readFileHead(file: string, maxBytes: number): string {
  const buf = readFileSync(file)
  return buf.subarray(0, Math.min(buf.length, maxBytes)).toString('utf8')
}

function safeFileName(source: ImportSource, title: string): string {
  const stamp = Date.now().toString(36)
  const body = title.replace(/[<>:"/\\|?*]+/g, ' ').trim().slice(0, 40) || 'session'
  return `${source}-${body}-${stamp}`
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}
