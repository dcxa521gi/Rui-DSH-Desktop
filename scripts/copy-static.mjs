#!/usr/bin/env node
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outRenderer = join(root, 'out', 'renderer')
const outPlugins = join(root, 'out', 'plugins')
const outPreload = join(root, 'out', 'preload')
mkdirSync(outRenderer, { recursive: true })
mkdirSync(outPlugins, { recursive: true })
mkdirSync(outPreload, { recursive: true })
cpSync(join(root, 'src', 'renderer'), outRenderer, { recursive: true })
cpSync(join(root, 'src', 'plugins'), outPlugins, { recursive: true })
cpSync(join(root, 'src', 'preload', 'preload.cjs'), join(outPreload, 'preload.cjs'))
console.log('copy-static: renderer, plugins, and preload copied to out/')
