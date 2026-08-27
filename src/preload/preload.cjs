const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    getInfo: () => ipcRenderer.invoke('desktop:get-info'),
    restartHarness: () => ipcRenderer.invoke('desktop:restart-harness'),
    quit: () => ipcRenderer.invoke('desktop:quit'),
    openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
    openDataDir: () => ipcRenderer.invoke('desktop:open-data-dir'),
    copyError: () => ipcRenderer.invoke('desktop:copy-error'),
    getDesktopState: () => ipcRenderer.invoke('desktop:get-state'),
    setTheme: (theme) => ipcRenderer.invoke('desktop:set-theme', theme),
    setAutoCheckApp: (enabled) => ipcRenderer.invoke('desktop:set-auto-check-app', enabled),
    setGithubRepo: (owner, repo) => ipcRenderer.invoke('desktop:set-github-repo', owner, repo),
    checkAppUpdate: () => ipcRenderer.invoke('desktop:check-app-update'),
    openAppRelease: (url) => ipcRenderer.invoke('desktop:open-app-release', url),
    checkKernelUpdate: () => ipcRenderer.invoke('desktop:check-kernel-update'),
    downloadKernel: () => ipcRenderer.invoke('desktop:download-kernel'),
    applyKernel: () => ipcRenderer.invoke('desktop:apply-kernel'),
    revertKernel: () => ipcRenderer.invoke('desktop:revert-kernel'),
    listJobs: () => ipcRenderer.invoke('desktop:list-jobs'),
    saveJob: (job) => ipcRenderer.invoke('desktop:save-job', job),
    toggleJob: (id, enabled) => ipcRenderer.invoke('desktop:toggle-job', id, enabled),
    deleteJob: (id) => ipcRenderer.invoke('desktop:delete-job', id),
    listIm: () => ipcRenderer.invoke('desktop:list-im'),
    startWeixin: () => ipcRenderer.invoke('desktop:im-weixin-start'),
    submitWeixinVerify: (code) => ipcRenderer.invoke('desktop:im-weixin-verify', code),
    disconnectIm: (id) => ipcRenderer.invoke('desktop:im-disconnect', id),
    saveImCreds: (id, fields) => ipcRenderer.invoke('desktop:im-save', id, fields),
    testImSend: (id) => ipcRenderer.invoke('desktop:im-test', id),
    replyIm: (channel, to, text, contextToken) =>
      ipcRenderer.invoke('desktop:im-reply', channel, to, text, contextToken),
    checkImPlugin: (id) => ipcRenderer.invoke('desktop:im-plugin-check', id),
    downloadImPlugin: (id) => ipcRenderer.invoke('desktop:im-plugin-download', id),
    applyImPlugin: (id) => ipcRenderer.invoke('desktop:im-plugin-apply', id),
    onImProgress: (handler) => {
      const listener = (_event, payload) => {
        handler(payload)
      }
      ipcRenderer.on('desktop:im-progress', listener)
      return () => {
        ipcRenderer.removeListener('desktop:im-progress', listener)
      }
    },
    onAppUpdate: (handler) => {
      const listener = (_event, payload) => {
        handler(payload)
      }
      ipcRenderer.on('desktop:app-update', listener)
      return () => {
        ipcRenderer.removeListener('desktop:app-update', listener)
      }
    },
    listWorkspaces: () => ipcRenderer.invoke('desktop:list-workspaces'),
    setImWorkspace: (workspaceId, title) =>
      ipcRenderer.invoke('desktop:set-im-workspace', workspaceId, title),
    ensureImWorkspace: (title) => ipcRenderer.invoke('desktop:ensure-im-workspace', title),
    listImports: () => ipcRenderer.invoke('desktop:list-imports'),
    runImport: (ids) => ipcRenderer.invoke('desktop:run-import', ids),
    onKernelProgress: (handler) => {
      const listener = (_event, payload) => {
        handler(payload)
      }
      ipcRenderer.on('desktop:kernel-progress', listener)
      return () => {
        ipcRenderer.removeListener('desktop:kernel-progress', listener)
      }
    },
  }),
)
