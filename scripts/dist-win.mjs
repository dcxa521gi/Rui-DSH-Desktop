#!/usr/bin/env node
/**
 * Run electron-builder with a user-writable TEMP and CI=true so Windows
 * packaging never extracts into C:\WINDOWS\TEMP (Error 5 GUI dialogs).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userTemp = join(homedir(), 'AppData', 'Local', 'Temp')
const cliCandidates = [
  join(userTemp, 'rui-electron-builder', 'node_modules', 'electron-builder', 'cli.js'),
  join(root, 'node_modules', 'electron-builder', 'cli.js'),
]
const cli = cliCandidates.find((file) => existsSync(file))
if (cli === undefined) {
  console.error('dist-win: electron-builder cli.js not found')
  process.exit(1)
}

const args = process.argv.slice(2)
const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: 'true',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    TEMP: userTemp,
    TMP: userTemp,
    TMPDIR: userTemp,
  },
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
