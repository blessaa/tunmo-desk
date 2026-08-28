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

/** 工作区路径、文件树、后端状态。 */
const workspace = useWorkspaceStore()
/** 模型 Key / Provider。 */
const settings = useSettingsStore()
/** 更新横幅。 */
const updater = useUpdaterStore()
/** 取消订阅主进程更新事件。 */
let unbind: (() => void) | undefined

onMounted(async () => {
  unbind = updater.bind()
  await Promise.all([workspace.hydrate(), settings.load()])
})

onUnmounted(() => unbind?.())
</script>
