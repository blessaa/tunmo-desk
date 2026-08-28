import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
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
        if (status.value === 'downloading') {
          status.value = 'available'
          ElMessage.error('下载失败，请稍后重试')
        } else if (status.value !== 'available' && status.value !== 'ready') {
          status.value = 'none'
        }
        error.value = ''
      }
    })
  }

  async function installNow(): Promise<void> {
    try {
      if (status.value === 'ready') {
        await window.tunmo.updater.install()
        return
      }
      if (status.value !== 'available' && status.value !== 'downloading') {
        await window.tunmo.updater.check()
      }
      await window.tunmo.updater.download()
    } catch {
      ElMessage.error('更新失败，请稍后重试')
    }
  }

  function later(): void {
    dismissed.value = true
  }

  return { status, info, progress, error, dismissed, bind, installNow, later }
})
