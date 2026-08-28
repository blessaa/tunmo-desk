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

function createWindow(): void {
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

function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_e, partial) => {
    const next = saveSettings(partial)
    if (partial?.apiKey || partial?.provider || partial?.modelId) {
      await applySettingsToRuntime()
    }
    return next
  })

  ipcMain.handle('workspace:open', async () => {
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
      const sessionId = command.sessionId || 'default'
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
  void startPiAgent()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopUpdateChecks()
})

app.on('window-all-closed', () => {
  stopPiAgent()
  if (process.platform !== 'darwin') app.quit()
})
