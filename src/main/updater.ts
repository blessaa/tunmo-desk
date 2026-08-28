import { BrowserWindow, app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const FIRST_CHECK_MS = 2500
const CHECK_INTERVAL_MS = 5 * 60 * 1000

let checkTimer: ReturnType<typeof setInterval> | undefined
let checking = false
let downloading = false

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

function isFeedNotReady(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /Cannot find latest(-mac|-linux)?\.yml|HttpError:\s*404/i.test(message)
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
  autoUpdater.disableWebInstaller = true

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
  autoUpdater.on('download-progress', (progress) => {
    downloading = true
    send('updater:progress', progress)
  })
  autoUpdater.on('update-downloaded', (info) => {
    downloading = false
    send('updater:downloaded', info)
  })
  autoUpdater.on('error', (err) => {
    downloading = false
    if (isFeedNotReady(err)) {
      log.info('[updater] release assets not ready yet, will retry later')
      send('updater:not-available')
      return
    }
    log.error('[updater]', err)
    send('updater:error')
  })

  if (!app.isPackaged) return

  setTimeout(() => {
    void checkForUpdates()
    checkTimer = setInterval(() => {
      void checkForUpdates()
    }, CHECK_INTERVAL_MS)
  }, FIRST_CHECK_MS)
}

export function stopUpdateChecks(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = undefined
  }
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    send('updater:dev-skip')
    return
  }
  if (checking || downloading) return
  checking = true
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    if (isFeedNotReady(err)) {
      log.info('[updater] release assets not ready yet, will retry later')
      send('updater:not-available')
    } else {
      log.error('[updater] check', err)
    }
  } finally {
    checking = false
  }
}

export async function downloadUpdate(): Promise<void> {
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    log.error('[updater] download', err)
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('check update first')) {
      await autoUpdater.checkForUpdates()
      await autoUpdater.downloadUpdate()
      return
    }
    send('updater:error')
  }
}

export function quitAndInstall(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.destroy()
  }
  autoUpdater.quitAndInstall(true, true)
}
