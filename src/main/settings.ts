import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AppSettings {
  workspacePath: string
  apiKey: string
  provider: string
  modelId: string
}

const defaults: AppSettings = {
  workspacePath: '',
  apiKey: '',
  provider: 'anthropic',
  modelId: ''
}

function filePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(filePath(), 'utf8')
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...partial }
  writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
