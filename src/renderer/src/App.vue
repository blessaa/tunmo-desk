<template>
  <router-view />
</template>

<script setup lang="ts">
import { onErrorCaptured } from 'vue'

/** 拦住子组件未处理的渲染错误，避免整页白屏。 */
onErrorCaptured((err) => {
  console.error('[tunmo] render', err)
  return false
})
</script>
