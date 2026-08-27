import { Menu, app, type MenuItemConstructorOptions } from 'electron'

export type MenuActions = {
  onReload: () => void
  onRestartEngine: () => void
  onOpenSettings: () => void
  onOpenLogs: () => void
  onOpenDataDir: () => void
  onShowAbout: () => void
  onQuit: () => void
}

export function installAppMenu(actions: MenuActions): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? ([
          {
            role: 'appMenu',
            submenu: [
              { label: '关于 Rui DSH Desktop', click: actions.onShowAbout },
              { type: 'separator' },
              { label: '设置', accelerator: 'CmdOrCtrl+,', click: actions.onOpenSettings },
              { type: 'separator' },
              { role: 'hide', label: '隐藏' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '显示全部' },
              { type: 'separator' },
              { label: '退出', accelerator: 'CmdOrCtrl+Q', click: actions.onQuit },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: '文件',
      submenu: [
        { label: '重新加载界面', accelerator: 'CmdOrCtrl+R', click: actions.onReload },
        { label: '重启引擎', click: actions.onRestartEngine },
        { label: '设置', accelerator: 'CmdOrCtrl+,', click: actions.onOpenSettings },
        { type: 'separator' },
        { label: '打开日志', click: actions.onOpenLogs },
        { label: '打开数据目录', click: actions.onOpenDataDir },
        { type: 'separator' },
        ...(process.platform === 'darwin'
          ? ([] as MenuItemConstructorOptions[])
          : ([{ label: '退出', accelerator: 'Alt+F4', click: actions.onQuit }] satisfies MenuItemConstructorOptions[])),
      ],
    },
    { role: 'editMenu', label: '编辑' },
    { role: 'viewMenu', label: '查看' },
    { role: 'windowMenu', label: '窗口' },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: actions.onShowAbout },
        {
          label: 'DeepSeek Harness（上游）',
          click: async () => {
            const { shell } = await import('electron')
            await shell.openExternal('https://github.com/deepseek-ai/deepseek-harness')
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  app.setName('Rui DSH Desktop')
}
