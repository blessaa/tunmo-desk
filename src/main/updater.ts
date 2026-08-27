import { BrowserWindow, app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export interface ReleaseConfig {
  github: { owner: string; repo: string }
  gitee: { owner: string; repo: string; updateUrl: string }
  update: { source: 'github' | 'gitee'; autoDownload: boolean; promptUser: boolean }
}

function loadReleaseConfig(): ReleaseConfig {
  const file = app.isPackaged
    ? join(process.resourcesPath, 'release.json')
    : join(app.getAppPath(), 'config', 'release.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ReleaseConfig
  } catch {
    return {
      github: { owner: '', repo: '' },
      gitee: { owner: '', repo: '', updateUrl: '' },
      update: { source: 'github', autoDownload: false, promptUser: true }
    }
  }
}

function send(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function setupUpdater(): void {
  const config = loadReleaseConfig()
  autoUpdater.logger = log
  autoUpdater.autoDownload = config.update.autoDownload
  autoUpdater.autoInstallOnAppQuit = true

  if (config.update.source === 'gitee' && config.gitee.updateUrl && !config.gitee.updateUrl.includes('YOUR_')) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: config.gitee.updateUrl
    })
  } else if (config.github.owner && config.github.repo && !config.github.owner.includes('YOUR_')) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: config.github.owner,
      repo: config.github.repo
    })
  }

  autoUpdater.on('checking-for-update', () => send('updater:checking'))
  autoUpdater.on('update-available', (info) => send('updater:available', info))
  autoUpdater.on('update-not-available', (info) => send('updater:not-available', info))
  autoUpdater.on('download-progress', (progress) => send('updater:progress', progress))
  autoUpdater.on('update-downloaded', (info) => send('updater:downloaded', info))
  autoUpdater.on('error', (err) => send('updater:error', err.message))
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    send('updater:dev-skip')
    return
  }
  await autoUpdater.checkForUpdates()
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
