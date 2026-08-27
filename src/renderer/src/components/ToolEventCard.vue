<template>
  <div class="tool" :class="event.status">
    <div class="head">
      <span class="badge">Tool</span>
      <span class="name">{{ event.name }}</span>
      <span class="status">{{ event.status }}</span>
    </div>
    <pre v-if="event.args" class="payload">{{ event.args }}</pre>
    <pre v-if="event.result" class="payload result">{{ event.result }}</pre>
  </div>
</template>

<script setup lang="ts">
import type { ToolEvent } from '@renderer/api/chat-stream'

defineProps<{
  event: ToolEvent
}>()
</script>

<style scoped>
.tool {
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 1px solid var(--tm-border);
  border-radius: 8px;
  background: var(--tm-panel);
  font-size: 12px;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #2a3346;
  color: var(--tm-accent);
}

.name {
  font-family: ui-monospace, Consolas, monospace;
}

.status {
  margin-left: auto;
  color: var(--tm-muted);
}

.payload {
  margin: 8px 0 0;
  white-space: pre-wrap;
  color: var(--tm-muted);
  font-family: ui-monospace, Consolas, monospace;
}

.result {
  color: #c5d0e2;
}
</style>
