import { Notification } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { log } from './log.js'

export type AutomationJob = {
  id: string
  title: string
  prompt: string
  everyMinutes: number
  enabled: boolean
  nextRunAt: number
  lastRunAt?: number
}

const MIN_MINUTES = 5
const TICK_MS = 30_000

let filePath = ''
let jobs: AutomationJob[] = []
let timer: ReturnType<typeof setInterval> | undefined
let onDue: ((job: AutomationJob) => void) | undefined

export function initAutomation(userDataDir: string, notify: (job: AutomationJob) => void): void {
  filePath = join(userDataDir, 'automation-jobs.json')
  onDue = notify
  jobs = load()
  if (timer !== undefined) clearInterval(timer)
  timer = setInterval(() => {
    tick()
  }, TICK_MS)
  tick()
}

export function listJobs(): AutomationJob[] {
  return jobs.map((job) => ({ ...job }))
}

export function saveJob(input: Partial<AutomationJob> & { title: string; prompt: string }): AutomationJob[] {
  const everyMinutes = Math.max(
    MIN_MINUTES,
    Number.isFinite(input.everyMinutes) ? Math.floor(Number(input.everyMinutes)) : MIN_MINUTES,
  )
  const now = Date.now()
  const existing = typeof input.id === 'string' ? jobs.find((job) => job.id === input.id) : undefined
  const job: AutomationJob = {
    id: existing?.id ?? `job-${now.toString(36)}`,
    title: input.title.trim() || '未命名任务',
    prompt: input.prompt.trim(),
    everyMinutes,
    enabled: input.enabled !== false,
    nextRunAt: existing?.nextRunAt && existing.nextRunAt > now ? existing.nextRunAt : now + everyMinutes * 60_000,
    lastRunAt: existing?.lastRunAt,
  }
  if (existing === undefined) jobs.push(job)
  else jobs = jobs.map((item) => (item.id === job.id ? job : item))
  persist()
  return listJobs()
}

export function toggleJob(id: string, enabled: boolean): AutomationJob[] {
  jobs = jobs.map((job) => {
    if (job.id !== id) return job
    return {
      ...job,
      enabled,
      nextRunAt: enabled ? Date.now() + job.everyMinutes * 60_000 : job.nextRunAt,
    }
  })
  persist()
  return listJobs()
}

export function deleteJob(id: string): AutomationJob[] {
  jobs = jobs.filter((job) => job.id !== id)
  persist()
  return listJobs()
}

function tick(): void {
  const now = Date.now()
  let changed = false
  for (const job of jobs) {
    if (!job.enabled || job.nextRunAt > now) continue
    changed = true
    job.lastRunAt = now
    job.nextRunAt = now + job.everyMinutes * 60_000
    log('info', `automation due: ${job.title}`)
    try {
      new Notification({
        title: job.title,
        body: job.prompt === '' ? '定时任务已到点。' : job.prompt.slice(0, 180),
      }).show()
    } catch (error) {
      log('warn', `automation notify failed: ${String(error)}`)
    }
    onDue?.(job)
  }
  if (changed) persist()
}

function load(): AutomationJob[] {
  if (!existsSync(filePath)) return []
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { jobs?: AutomationJob[] }
    if (!Array.isArray(raw.jobs)) return []
    return raw.jobs.filter((job) => typeof job.id === 'string' && typeof job.title === 'string')
  } catch {
    return []
  }
}

function persist(): void {
  if (filePath === '') return
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify({ jobs }, null, 2)}\n`)
}
