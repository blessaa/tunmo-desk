<template>
  <router-view />
</template>

<script setup lang="ts">
import { onErrorCaptured } from 'vue'

onErrorCaptured((err) => {
  console.error('[tunmo] render', err)
  return false
})
</script>
