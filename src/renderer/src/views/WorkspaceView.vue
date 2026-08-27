<template>
  <div class="layout">
    <AppSidebar />
    <ChatPane />
    <SettingsDialog />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppSidebar from '@renderer/components/AppSidebar.vue'
import ChatPane from '@renderer/components/ChatPane.vue'
import SettingsDialog from '@renderer/components/SettingsDialog.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { useUpdaterStore } from '@renderer/stores/updater'

const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const updater = useUpdaterStore()
let unbind: (() => void) | undefined

onMounted(async () => {
  unbind = updater.bind()
  await Promise.all([workspace.hydrate(), settings.load()])
})

onUnmounted(() => unbind?.())
</script>
