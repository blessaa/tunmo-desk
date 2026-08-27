<template>
  <div v-if="crash" class="crash">
    <p>界面出错了，请按 Ctrl+R 刷新窗口。</p>
    <pre>{{ crash }}</pre>
  </div>
  <router-view v-else />
</template>

<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

const crash = ref('')

onErrorCaptured((err) => {
  crash.value = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  console.error('[tunmo] render', err)
  return false
})
</script>

<style scoped>
.crash {
  height: 100%;
  padding: 32px;
  color: #d7dbe3;
  background: #0f1115;
  white-space: pre-wrap;
}

.crash pre {
  margin-top: 16px;
  font-size: 12px;
  color: #f56c6c;
}
</style>
