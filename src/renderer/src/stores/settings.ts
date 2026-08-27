import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModelOption } from '../../../preload/index.d'

export const useSettingsStore = defineStore('settings', () => {
  const apiKey = ref('')
  const provider = ref('anthropic')
  const modelId = ref('')
  const models = ref<ModelOption[]>([])
  const loadingModels = ref(false)
  const visible = ref(false)

  async function load(): Promise<void> {
    const settings = await window.tunmo.settings.get()
    apiKey.value = settings.apiKey
    provider.value = settings.provider || 'anthropic'
    modelId.value = settings.modelId || ''
  }

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

  async function save(): Promise<void> {
    await window.tunmo.settings.set({
      apiKey: apiKey.value,
      provider: provider.value,
      modelId: modelId.value
    })
    visible.value = false
  }

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
