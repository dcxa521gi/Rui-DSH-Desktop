import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.js'

const require = createRequire(import.meta.url)

function toFilesystemPath(filePath: string): string {
  const marker = `${sep}app.asar${sep}`
  const unpacked = `${sep}app.asar.unpacked${sep}`
  if (!filePath.includes(marker)) return filePath
  const candidate = filePath.replace(marker, unpacked)
  return existsSync(candidate) ? candidate : filePath
}

function appRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

export function resolvePnpmCli(): string | undefined {
  const localCandidates = [
    join(appRoot(), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    join(appRoot(), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    join(appRoot(), 'node_modules', 'pnpm', 'dist', 'pnpm.cjs'),
  ]
  for (const filePath of localCandidates) {
    const resolved = toFilesystemPath(filePath)
    if (existsSync(resolved)) return resolved
  }
  const moduleCandidates = ['pnpm/bin/pnpm.cjs', 'pnpm/bin/pnpm.js', 'pnpm/dist/pnpm.cjs']
  for (const id of moduleCandidates) {
    try {
      return toFilesystemPath(require.resolve(id))
    } catch {
      // pnpm's package exports hide these paths from require.resolve
    }
  }
  return undefined
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

export function installRuntimeShims(userDataDir: string): string {
  const shimDir = join(userDataDir, 'runtime-shims')
  mkdirSync(shimDir, { recursive: true })
  const electronPath = process.execPath
  const pnpmCli = resolvePnpmCli()

  if (process.platform === 'win32') {
    writeFileSync(
      join(shimDir, 'node.cmd'),
      [
        '@echo off',
        'setlocal',
        'set ELECTRON_RUN_AS_NODE=1',
        `${quote(electronPath)} --expose-internals %*`,
        '',
      ].join('\r\n'),
    )
    if (pnpmCli !== undefined) {
      writeFileSync(
        join(shimDir, 'pnpm.cmd'),
        [
          '@echo off',
          'setlocal',
          'set ELECTRON_RUN_AS_NODE=1',
          `${quote(electronPath)} --expose-internals ${quote(pnpmCli)} %*`,
          '',
        ].join('\r\n'),
      )
    }
  } else {
    const nodeShim = join(shimDir, 'node')
    writeFileSync(
      nodeShim,
      [
        '#!/bin/sh',
        'export ELECTRON_RUN_AS_NODE=1',
        `exec ${quote(electronPath)} --expose-internals "$@"`,
        '',
      ].join('\n'),
    )
    chmodSync(nodeShim, 0o755)
    if (pnpmCli !== undefined) {
      const pnpmShim = join(shimDir, 'pnpm')
      writeFileSync(
        pnpmShim,
        [
          '#!/bin/sh',
          'export ELECTRON_RUN_AS_NODE=1',
          `exec ${quote(electronPath)} --expose-internals ${quote(pnpmCli)} "$@"`,
          '',
        ].join('\n'),
      )
      chmodSync(pnpmShim, 0o755)
    }
  }

  log(
    'info',
    `runtime shims in ${shimDir}${pnpmCli === undefined ? ' (pnpm not found)' : ''}`,
  )
  return shimDir
}
