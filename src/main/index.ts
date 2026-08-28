/**
 * Electron 主进程入口。
 * 负责开窗口、注册 IPC、拉起 tunmo-backend、配置自动更新。
 */
import './user-data'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { loadSettings, saveSettings } from './settings'
import { pickWorkspace, readTree } from './workspace'
import {
  applySettingsToRuntime,
  bindWorkspace,
  getRpcState,
  listModels,
  promptPi,
  restartPiAgent,
  startPiAgent,
  stopPiAgent,
  type ChatStreamEvent
} from './pi-agent'
import { checkForUpdates, downloadUpdate, quitAndInstall, setupUpdater, stopUpdateChecks } from './updater'

/** 创建主窗口：隔离渲染进程，只能通过 preload 的 window.tunmo 调主进程。 */
function createWindow(): void {
  /** 唯一的应用窗口。 */
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '图墨',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 注册渲染进程可调用的 IPC。名字和 preload 里 window.tunmo 一一对应。 */
function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_e, partial) => {
    /** 合并写入后的完整设置。 */
    const next = saveSettings(partial)
    if (partial?.apiKey || partial?.provider || partial?.modelId) {
      await applySettingsToRuntime()
    }
    return next
  })

  ipcMain.handle('workspace:open', async () => {
    /** 用户选中的文件夹；取消则为空。 */
    const path = await pickWorkspace()
    if (!path) return loadSettings()
    const settings = saveSettings({ workspacePath: path })
    await bindWorkspace(path)
    return settings
  })
  ipcMain.handle('workspace:tree', (_e, root: string) => readTree(root))

  ipcMain.handle('rpc:status', () => getRpcState())
  ipcMain.handle('rpc:start', () => startPiAgent())
  ipcMain.handle('rpc:restart', () => restartPiAgent())
  ipcMain.handle('models:list', (_e, overrides?: { provider?: string; apiKey?: string }) =>
    listModels(overrides)
  )
  ipcMain.handle(
    'chat:send',
    async (
      event,
      command: { id?: string; sessionId?: string; type: string; message: string }
    ) => {
      /** 侧边栏对话 id；缺省走 default。 */
      const sessionId = command.sessionId || 'default'
      /** 把流式事件推回发起这次发送的窗口。 */
      const emit = (streamEvent: ChatStreamEvent): void => {
        event.sender.send('chat:stream', streamEvent)
      }
      return promptPi(sessionId, command as Parameters<typeof promptPi>[1], emit)
    }
  )

  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install', () => quitAndInstall())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.tunmo.desk')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  setupUpdater()
  createWindow()
  // 窗口起来后拉起 src/package 的 tunmo-backend，失败只反映在状态灯上
  void startPiAgent()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopUpdateChecks()
  // 退出前杀掉 tunmo-backend 及其 Pi 子进程
  stopPiAgent()
})

app.on('window-all-closed', () => {
  stopPiAgent()
  if (process.platform !== 'darwin') app.quit()
})
