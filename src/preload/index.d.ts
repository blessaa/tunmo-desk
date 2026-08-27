import { ElectronAPI } from '@electron-toolkit/preload'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface AppSettings {
  workspacePath: string
  apiKey: string
  provider: string
  modelId: string
}

export interface RpcState {
  status: 'idle' | 'starting' | 'running' | 'missing' | 'error'
  engine: 'sdk'
  lastError: string
  modelId: string
  modelName: string
}

export interface ModelOption {
  id: string
  name: string
  provider: string
}

export interface ChatStreamEvent {
  type: string
  sessionId?: string
  [key: string]: unknown
}

export interface UpdateInfo {
  version?: string
  releaseName?: string
  releaseNotes?: string | null
}

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

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
