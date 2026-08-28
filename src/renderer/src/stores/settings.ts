/**
 * 模型配置对话框的状态：Key、Provider、模型列表。真正落盘走 window.tunmo.settings。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModelOption } from '../../../preload/index.d'

export const useSettingsStore = defineStore('settings', () => {
  /** 当前 Provider 的 API Key。 */
  const apiKey = ref('')
  /** 模型提供商。 */
  const provider = ref('anthropic')
  /** 选中的模型 id。 */
  const modelId = ref('')
  /** 刷新得到的模型下拉数据。 */
  const models = ref<ModelOption[]>([])
  /** 正在拉模型列表。 */
  const loadingModels = ref(false)
  /** 对话框是否打开。 */
  const visible = ref(false)

  /** 从主进程读已保存的设置。 */
  async function load(): Promise<void> {
    const settings = await window.tunmo.settings.get()
    apiKey.value = settings.apiKey
    provider.value = settings.provider || 'anthropic'
    modelId.value = settings.modelId || ''
  }

  /** 用当前输入框里的 Key 向主进程要模型列表。 */
  async function refreshModels(): Promise<void> {
    loadingModels.value = true
    try {
      models.value = await window.tunmo.models.list({
        provider: provider.value,
        apiKey: apiKey.value
      })
      if (!modelId.value && models.value[0]) {
        modelId.value = models.value[0].id
      }
    } finally {
      loadingModels.value = false
    }
  }

  /** 写入 settings.json，并让主进程按新 Key 重启后端。 */
  async function save(): Promise<void> {
    await window.tunmo.settings.set({
      apiKey: apiKey.value,
      provider: provider.value,
      modelId: modelId.value
    })
    visible.value = false
  }

  /** 打开对话框并立刻刷新模型。 */
  function open(): void {
    visible.value = true
    void refreshModels()
  }

  return {
    apiKey,
    provider,
    modelId,
    models,
    loadingModels,
    visible,
    load,
    refreshModels,
    save,
    open
  }
})
