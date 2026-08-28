/**
 * 聊天顶栏更新横幅的状态。事件来自主进程 electron-updater。
 */
import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { UpdateInfo, UpdateProgress } from '../../../preload/index.d'

export const useUpdaterStore = defineStore('updater', () => {
  /** 检查 / 可更新 / 下载中 / 已下完 / 正在安装 / 无更新。 */
  const status = ref<
    'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'none' | 'error'
  >('idle')
  /** 新版本号等信息。 */
  const info = ref<UpdateInfo | null>(null)
  /** 下载百分比。 */
  const progress = ref<UpdateProgress | null>(null)
  /** 内部错误缓存，界面不展示堆栈。 */
  const error = ref('')
  /** 用户点了「稍后」，本版本横幅先藏起来。 */
  const dismissed = ref(false)

  /** 订阅主进程更新频道，返回取消订阅函数。 */
  function bind(): () => void {
    return window.tunmo.updater.on((channel, payload) => {
      if (channel === 'updater:checking') {
        if (['available', 'downloading', 'ready', 'installing'].includes(status.value)) return
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
        } else if (status.value === 'installing') {
          status.value = 'ready'
          ElMessage.error('安装未开始，请再试一次')
        } else if (status.value !== 'available' && status.value !== 'ready') {
          status.value = 'none'
        }
        error.value = ''
      }
    })
  }

  /** 已下完则安装并重启；否则先下载。 */
  async function installNow(): Promise<void> {
    try {
      if (status.value === 'ready' || status.value === 'installing') {
        status.value = 'installing'
        await nextTick()
        await new Promise((resolve) => setTimeout(resolve, 400))
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

  /** 关掉横幅，下次发现更新再出现。安装过程中不能取消。 */
  function later(): void {
    if (status.value === 'installing') return
    dismissed.value = true
  }

  return { status, info, progress, error, dismissed, bind, installNow, later }
})
