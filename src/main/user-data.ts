/**
 * 必须作为主进程第一份 import。
 * 开发时把 userData 指到 tunmo-desk-dev，避免和正式安装的设置、日志混在一起。
 */
import { app } from 'electron'
import { join } from 'node:path'

if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'tunmo-desk-dev'))
}
