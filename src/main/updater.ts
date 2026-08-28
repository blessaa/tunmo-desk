/**
 * 安装包自动更新：查 GitHub/Gitee 的 latest.yml，提示用户后再下载安装。
 * 开发环境跳过检查。
 */
import { BrowserWindow, app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log'
import electronUpdater from 'electron-updater'

/** electron-updater 单例。 */
const { autoUpdater } = electronUpdater

/** 启动后第一次查更新的延迟，避免和窗口初始化抢网。 */
const FIRST_CHECK_MS = 2500
/** 之后轮询间隔：5 分钟。 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000

/** 轮询定时器；退出时清掉。 */
let checkTimer: ReturnType<typeof setInterval> | undefined
/** 正在 checkForUpdates，防止重入。 */
let checking = false
/** 正在下载安装包。 */
let downloading = false

/** config/release.json 的形状：更新源和是否自动下载。 */
export interface ReleaseConfig {
  github: { owner: string; repo: string }
  gitee: { owner: string; repo: string; updateUrl: string }
  update: { source: 'github' | 'gitee'; autoDownload: boolean; promptUser: boolean }
}

/** 读 release.json。安装包在 resources 下，开发读仓库 config。 */
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

/** latest.yml 还没上传完时 GitHub 会 404，当成「暂无更新」稍后再试，不弹错误。 */
function isFeedNotReady(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /Cannot find latest(-mac|-linux)?\.yml|HttpError:\s*404/i.test(message)
}

/** 把更新事件广播给所有渲染窗口。 */
function send(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** 配置 feed、绑定事件；仅安装包会开始轮询。 */
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

/** 退出应用时停掉轮询。 */
export function stopUpdateChecks(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = undefined
  }
}

/** 向更新源查是否有更高版本。开发环境只通知界面 skip。 */
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

/** 用户点「立即更新」后下载安装包。若还没 check 过会先 check 再下。 */
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

/**
 * 用户点「安装并重启」。
 * 不要先 destroy 窗口，否则会先 app.quit，安装包不带 --force-run，装完不会自动打开。
 * Windows 不要静默：NSIS 需要显示复制进度，否则覆盖大 asar 时像死机。
 */
export function quitAndInstall(): void {
  autoUpdater.autoInstallOnAppQuit = false
  log.info('[updater] quitAndInstall')
  autoUpdater.quitAndInstall(false, true)
}
