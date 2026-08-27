import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  type WriteStream,
} from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 2 * 1024 * 1024
export const MAIN_LOG_FILENAME = 'main.log'

let logDir = ''
let stream: WriteStream | undefined

export function initLogs(dir: string): string {
  logDir = dir
  mkdirSync(dir, { recursive: true })
  const file = join(dir, MAIN_LOG_FILENAME)
  if (existsSync(file)) {
    try {
      if (statSync(file).size > MAX_LOG_BYTES) {
        const truncate = createWriteStream(file, { flags: 'w' })
        truncate.end()
      }
    } catch {
      // A racing reader may hold the file; append is safe.
    }
  }
  stream = createWriteStream(file, { flags: 'a' })
  return file
}

export function log(level: string, message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}`
  console.log(line)
  stream?.write(`${line}\n`)
}

export function currentLogDir(): string {
  return logDir
}

export function readTail(file: string, maxLines: number): string {
  try {
    if (!existsSync(file)) return '(no log file yet)'
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/).filter((line) => line !== '')
    return lines.slice(-maxLines).join('\n')
  } catch (error) {
    return `(cannot read ${file}: ${String(error)})`
  }
}
