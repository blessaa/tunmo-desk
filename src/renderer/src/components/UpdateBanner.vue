<template>
  <div v-if="show" class="banner">
    <div>
      <strong>{{ title }}</strong>
      <span class="muted"> {{ hint }}</span>
    </div>
    <div class="actions">
      <el-button size="small" :disabled="busy" @click="updater.later">稍后</el-button>
      <el-button size="small" type="primary" :loading="busy" @click="updater.installNow">
        {{ actionLabel }}
      </el-button>
    </div>
  </div>

  <el-dialog
    :model-value="updater.status === 'installing'"
    title="正在安装更新"
    width="440px"
    align-center
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
  >
    <p class="dialog-copy">图墨即将关闭。接下来会弹出安装窗口并显示复制进度，大约需要几十秒，请不要关机。</p>
    <p class="dialog-copy muted">完成后会自动打开新版本。如果出现「下一步」，点一下即可。</p>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUpdaterStore } from '@renderer/stores/updater'

const updater = useUpdaterStore()

/** 有新版本且用户没点「稍后」才显示。安装过程中也保持横幅。 */
const show = computed(() => {
  if (updater.dismissed && updater.status !== 'installing') return false
  return ['available', 'downloading', 'ready', 'installing'].includes(updater.status)
})

const busy = computed(() => updater.status === 'downloading' || updater.status === 'installing')

/** 「发现新版本 0.3.1」里的版本号部分。 */
const versionText = computed(() => {
  const version = updater.info?.version
  return version ? ` ${version}` : ''
})

const title = computed(() => {
  if (updater.status === 'installing') return '正在安装更新'
  return `发现新版本${versionText.value}`
})

const actionLabel = computed(() => {
  if (updater.status === 'installing') return '正在安装'
  if (updater.status === 'ready') return '安装并重启'
  return '立即更新'
})

/** 横幅副文案：下载进度或安装提示。 */
const hint = computed(() => {
  if (updater.status === 'downloading') {
    return `正在下载 ${Math.round(updater.progress?.percent ?? 0)}%`
  }
  if (updater.status === 'installing') {
    return '请留意随后弹出的安装进度窗口。'
  }
  if (updater.status === 'ready') {
    return '已下载完成。安装时会显示进度，大约几十秒，完成后自动打开。'
  }
  return '是否现在更新？'
})
</script>

<style scoped>
.banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 10px 22% 0;
  padding: 10px 12px;
  border: 1px solid #35507a;
  background: #1b283c;
  border-radius: 8px;
}

.actions {
  display: flex;
  gap: 8px;
}

.dialog-copy {
  margin: 0 0 10px;
  line-height: 1.6;
}

.dialog-copy:last-child {
  margin-bottom: 0;
}

.muted {
  color: #8b9bb4;
}
</style>
