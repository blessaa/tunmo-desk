/**
 * 读写 userData/settings.json：工作目录、API Key、Provider、模型。
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 持久化到磁盘的应用设置。 */
export interface AppSettings {
  /** 当前工作区绝对路径，空表示还没打开过。 */
  workspacePath: string
  /** 当前 Provider 的 API Key。 */
  apiKey: string
  /** 模型提供商，如 anthropic、minimax-cn。 */
  provider: string
  /** 选中的模型 id。 */
  modelId: string
}

/** 文件不存在或损坏时用的默认值。 */
const defaults: AppSettings = {
  workspacePath: '',
  apiKey: '',
  provider: 'anthropic',
  modelId: ''
}

/** settings.json 的完整路径；必要时创建 userData 目录。 */
function filePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

/** 读设置；读失败则返回 defaults 的拷贝。 */
export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(filePath(), 'utf8')
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

/**
 * 合并写入设置并立刻落盘。
 * @param partial 要覆盖的字段
 */
export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...partial }
  writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
