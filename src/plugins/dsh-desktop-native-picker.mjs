/**
 * Desktop directory picker for DeepSeek Harness.
 *
 * Upstream uses koffi to drive a native chooser; that error path can crash
 * under Electron's bundled Node. This plugin registers the same
 * `directoryPicker` service and implements pick() by asking the Electron
 * main process over the child's stdio IPC channel.
 */
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'

const PICK_TIMEOUT_MS = 10 * 60 * 1000

let nextId = 1
const pending = new Map()
let bridgeAttached = false

function attachBridge() {
  if (bridgeAttached) return
  bridgeAttached = true
  process.on('message', (message) => {
    if (message === null || typeof message !== 'object') return
    if (message.type !== 'dsh-desktop:pick-result') return
    const entry = pending.get(message.id)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    pending.delete(message.id)
    entry.resolve(typeof message.path === 'string' ? message.path : null)
  })
}

export default class DesktopNativeDirectoryPicker extends DirectoryPicker {
  capability() {
    return { kind: 'native', pick: (signal) => this.pick(signal) }
  }

  pick(signal) {
    if (typeof process.send !== 'function') return Promise.resolve(null)
    attachBridge()
    return new Promise((resolve) => {
      const id = nextId++
      const settle = (path) => {
        const entry = pending.get(id)
        if (entry === undefined) return
        clearTimeout(entry.timer)
        pending.delete(id)
        resolve(path)
      }
      const timer = setTimeout(() => {
        settle(null)
      }, PICK_TIMEOUT_MS)
      pending.set(id, { resolve, timer })
      if (signal !== undefined) {
        signal.addEventListener('abort', () => {
          settle(null)
        }, { once: true })
      }
      try {
        process.send({ type: 'dsh-desktop:pick-directory', id })
      } catch {
        settle(null)
      }
    })
  }
}
