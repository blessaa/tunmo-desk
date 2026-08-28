import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UpdateInfo, UpdateProgress } from '../../../preload/index.d'

export const useUpdaterStore = defineStore('updater', () => {
  const status = ref<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'>(
    'idle'
  )
  const info = ref<UpdateInfo | null>(null)
  const progress = ref<UpdateProgress | null>(null)
  const error = ref('')
  const dismissed = ref(false)

  function bind(): () => void {
    return window.tunmo.updater.on((channel, payload) => {
      if (channel === 'updater:checking') {
        if (['available', 'downloading', 'ready'].includes(status.value)) return
        status.value = 'checking'
      }
      if (channel === 'updater:available') {
        const next = (payload as UpdateInfo) ?? null
        if (next?.version && next.version !== info.value?.version) {
          dismissed.value = false
        }
        status.value = 'available'
        info.value = next
      }
      if (channel === 'updater:not-available' || channel === 'updater:dev-skip') {
        status.value = 'none'
      }
      if (channel === 'updater:progress') {
        status.value = 'downloading'
        progress.value = payload as UpdateProgress
      }
      if (channel === 'updater:downloaded') {
        status.value = 'ready'
        info.value = (payload as UpdateInfo) ?? info.value
      }
      if (channel === 'updater:error') {
        status.value = 'error'
        error.value = String(payload ?? 'update error')
      }
    })
  }

  async function installNow(): Promise<void> {
    if (status.value === 'ready') {
      await window.tunmo.updater.install()
      return
    }
    await window.tunmo.updater.download()
  }

  function later(): void {
    dismissed.value = true
  }

  return { status, info, progress, error, dismissed, bind, installNow, later }
})
