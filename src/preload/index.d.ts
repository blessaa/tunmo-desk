/**
 * 渲染进程里 window.tunmo 的 TypeScript 声明。
 * 实现在 preload/index.ts，真正干活在主进程 IPC。
 */
import { ElectronAPI } from '@electron-toolkit/preload'

/** 文件树节点。 */
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

/** 与主进程 settings.json 对应。 */
export interface AppSettings {
  workspacePath: string
  apiKey: string
  provider: string
  modelId: string
}

/** 左下角后端状态。 */
export interface RpcState {
  status: 'idle' | 'starting' | 'running' | 'missing' | 'error'
  engine: 'backend'
  lastError: string
  modelId: string
  modelName: string
}

/** 设置页模型下拉一项。 */
export interface ModelOption {
  id: string
  name: string
  provider: string
}

/** 主进程推到 chat:stream 的事件。 */
export interface ChatStreamEvent {
  type: string
  sessionId?: string
  [key: string]: unknown
}

/** electron-updater 的版本信息。 */
export interface UpdateInfo {
  version?: string
  releaseName?: string
  releaseNotes?: string | null
}

/** 下载进度。 */
export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

/** window.tunmo 的完整形状。 */
export interface TunmoAPI {
  settings: {
    get: () => Promise<AppSettings>
    set: (partial: Partial<AppSettings>) => Promise<AppSettings>
  }
  models: {
    list: (overrides?: { provider?: string; apiKey?: string }) => Promise<ModelOption[]>
  }
  workspace: {
    open: () => Promise<AppSettings>
    tree: (root: string) => Promise<FileNode[]>
  }
  rpc: {
    status: () => Promise<RpcState>
    start: () => Promise<RpcState>
    restart: () => Promise<RpcState>
    onStatus: (callback: (state: RpcState) => void) => () => void
  }
  chat: {
    send: (command: { id?: string; sessionId?: string; type: 'prompt'; message: string }) => Promise<{
      type: 'response'
      command: 'prompt'
      success: boolean
      error?: string
      id?: string
    }>
    onEvent: (callback: (event: ChatStreamEvent) => void) => () => void
  }
  updater: {
    check: () => Promise<void>
    download: () => Promise<void>
    install: () => Promise<void>
    on: (callback: (channel: string, payload?: unknown) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    tunmo: TunmoAPI
  }
}
