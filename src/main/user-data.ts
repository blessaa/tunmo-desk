import { app } from 'electron'
import { join } from 'node:path'

if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'tunmo-desk-dev'))
}
