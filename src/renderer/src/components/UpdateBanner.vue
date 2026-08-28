<template>
  <div v-if="show" class="banner">
    <div>
      <strong>发现新版本{{ versionText }}</strong>
      <span class="muted"> {{ hint }}</span>
    </div>
    <div class="actions">
      <el-button size="small" @click="updater.later">稍后</el-button>
      <el-button size="small" type="primary" :loading="updater.status === 'downloading'" @click="updater.installNow">
        {{ updater.status === 'ready' ? '安装并重启' : '立即更新' }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUpdaterStore } from '@renderer/stores/updater'

const updater = useUpdaterStore()

const show = computed(() => {
  if (updater.dismissed) return false
  return ['available', 'downloading', 'ready'].includes(updater.status)
})

const versionText = computed(() => {
  const version = updater.info?.version
  return version ? ` ${version}` : ''
})

const hint = computed(() => {
  if (updater.status === 'downloading') {
    return `正在下载 ${Math.round(updater.progress?.percent ?? 0)}%`
  }
  if (updater.status === 'ready') {
    return '已下载完成，将覆盖安装并重启。'
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
</style>
