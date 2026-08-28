/**
 * 预加载脚本：在隔离的渲染进程里暴露 window.tunmo。
 * 渲染进程不能直接 require('electron')，所有主进程能力都从这里走 IPC。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/** 挂到 window.tunmo 上的桌面端 API。 */
const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke('settings:set', partial)
  },
  models: {
    list: (overrides?: { provider?: string; apiKey?: string }) =>
      ipcRenderer.invoke('models:list', overrides)
  },
  workspace: {
    open: () => ipcRenderer.invoke('workspace:open'),
    tree: (root: string) => ipcRenderer.invoke('workspace:tree', root)
  },
  rpc: {
    status: () => ipcRenderer.invoke('rpc:status'),
    start: () => ipcRenderer.invoke('rpc:start'),
    restart: () => ipcRenderer.invoke('rpc:restart'),
    onStatus: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state)
      ipcRenderer.on('rpc:status', listener)
      return () => ipcRenderer.removeListener('rpc:status', listener)
    }
  },
  chat: {
    send: (command: { id?: string; sessionId?: string; type: 'prompt'; message: string }) =>
      ipcRenderer.invoke('chat:send', command),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload)
      ipcRenderer.on('chat:stream', listener)
      return () => ipcRenderer.removeListener('chat:stream', listener)
    }
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    on: (callback: (channel: string, payload?: unknown) => void) => {
      /** 主进程会推的全部更新频道。 */
      const channels = [
        'updater:checking',
        'updater:available',
        'updater:not-available',
        'updater:progress',
        'updater:downloaded',
        'updater:error',
        'updater:dev-skip'
      ]
      /** 每个频道对应的监听器，卸载时要成对 remove。 */
      const handlers = channels.map((channel) => {
        const listener = (_event: unknown, payload: unknown) => callback(channel, payload)
        ipcRenderer.on(channel, listener)
        return { channel, listener }
      })
      return () => {
        for (const { channel, listener } of handlers) {
          ipcRenderer.removeListener(channel, listener)
        }
      }
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('tunmo', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore 未开 contextIsolation 时的回退（本应用默认是开的）
  window.electron = electronAPI
  // @ts-ignore
  window.tunmo = api
}
