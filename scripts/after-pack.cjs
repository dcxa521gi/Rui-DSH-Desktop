const { cpSync, existsSync, mkdirSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

function resolveAppDir(context) {
  const product = context.packager.appInfo.productFilename
  const candidates = [
    join(context.appOutDir, 'resources', 'app'),
    join(context.appOutDir, `${product}.app`, 'Contents', 'Resources', 'app'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  throw new Error(`after-pack: cannot find app dir under ${context.appOutDir}`)
}

function copyTree(from, to) {
  if (!existsSync(from)) {
    console.warn(`after-pack: skip missing ${from}`)
    return
  }
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true, dereference: true, force: true })
}

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir
  const appDir = resolveAppDir(context)
  const copies = [
    ['node_modules/@deepseek-ai', 'node_modules/@deepseek-ai'],
    ['node_modules/@koromix', 'node_modules/@koromix'],
    ['node_modules/pnpm', 'node_modules/pnpm'],
    ['node_modules/koffi', 'node_modules/koffi'],
    ['node_modules/node-pty', 'node_modules/node-pty'],
    ['node_modules/qrcode-generator', 'node_modules/qrcode-generator'],
  ]
  for (const [relFrom, relTo] of copies) {
    const from = join(projectDir, relFrom)
    const to = join(appDir, relTo)
    console.log(`after-pack: copy ${relFrom}`)
    copyTree(from, to)
  }
  const scoped = join(appDir, 'node_modules', '@deepseek-ai')
  const count = existsSync(scoped) ? readdirSync(scoped).length : 0
  console.log(`after-pack: @deepseek-ai packages = ${count}`)
  if (context.electronPlatformName === 'win32') {
    const native = join(appDir, 'node_modules', '@koromix', 'koffi-win32-x64', 'win32_x64', 'koffi.node')
    if (!existsSync(native)) {
      throw new Error(`after-pack: missing ${native}`)
    }
  }
}
