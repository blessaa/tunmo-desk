<template>
  <div v-if="show" class="banner">
    <div>
      <strong>发现新版本 {{ updater.info?.version }}</strong>
      <span class="muted"> 是否现在更新？</span>
      <span v-if="updater.status === 'downloading'" class="muted">
        下载中 {{ Math.round(updater.progress?.percent ?? 0) }}%
      </span>
      <span v-if="updater.status === 'ready'" class="muted"> 已下载完成，将重启安装。</span>
      <span v-if="updater.status === 'error'" class="muted"> {{ updater.error }}</span>
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
  return ['available', 'downloading', 'ready', 'error'].includes(updater.status)
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
