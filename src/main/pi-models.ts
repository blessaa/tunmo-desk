/**
 * 从 tunmo-backend 自带的 Pi 包拉模型列表，供设置对话框使用。
 * 桌面端根目录已卸载 @earendil-works/pi-coding-agent，所以从 src/package/node_modules 动态 import。
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import log from 'electron-log'

/** 设置页下拉框里的一条模型。 */
export interface ModelOption {
  /** 传给 conversation.create 的 modelId。 */
  id: string
  /** 界面显示名。 */
  name: string
  /** 提供商，如 anthropic、minimax-cn。 */
  provider: string
}

/** 只取列出模型需要的 Pi SDK 表面，避免把整包类型引进主进程。 */
type PiModule = {
  ModelRuntime: {
    create: () => Promise<{
      setRuntimeApiKey: (provider: string, apiKey: string) => Promise<void>
      getAvailable: (provider?: string) => Promise<Array<{ id: string; name: string; provider: string }>>
      getModels: (provider?: string) => Array<{ id: string; name: string; provider: string }>
    }>
  }
}

/**
 * 在后端 node_modules 里找 Pi 的 ESM 入口。
 * @returns 绝对路径；包还没安装时返回 null
 */
function resolvePiEntry(backendDir: string): string | null {
  /** 常见的两种打包入口，哪个存在用哪个。 */
  const candidates = [
    join(backendDir, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js'),
    join(backendDir, 'node_modules/@earendil-works/pi-coding-agent/dist/sdk.js')
  ]
  return candidates.find((file) => existsSync(file)) ?? null
}

/**
 * 列出某 Provider 下的模型。
 * @param backendDir tunmo-backend 根目录
 * @param overrides 对话框里尚未保存的 provider / apiKey
 */
export async function listModelsFromBackend(
  backendDir: string,
  overrides?: { provider?: string; apiKey?: string }
): Promise<ModelOption[]> {
  /** Pi SDK 入口文件。 */
  const entry = resolvePiEntry(backendDir)
  if (!entry) return []
  try {
    /** 运行时 import，避免 electron-vite 把 Pi 打进主进程包。 */
    const importer = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<PiModule>
    const mod = await importer(pathToFileURL(entry).href)
    /** Pi 的模型运行时，用来设 Key 和拉列表。 */
    const runtime = await mod.ModelRuntime.create()
    /** 当前要查的提供商。 */
    const provider = overrides?.provider
    /** 当前输入框里的 Key，可能还没点保存。 */
    const apiKey = overrides?.apiKey
    if (apiKey && provider) {
      await runtime.setRuntimeApiKey(provider, apiKey)
    }
    /** 先问在线可用列表，失败再退回 SDK 内置表。 */
    let models: Array<{ id: string; name: string; provider: string }> = []
    try {
      models = [...(await runtime.getAvailable(provider))]
    } catch (err) {
      log.error('[pi] list models', err)
    }
    if (models.length === 0) {
      models = [...runtime.getModels(provider)]
    }
    return models.map((item) => ({
      id: item.id,
      name: item.name,
      provider: String(item.provider)
    }))
  } catch (err) {
    log.error('[pi] load models from tunmo-backend', err)
    return []
  }
}
