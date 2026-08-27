<template>
  <ul class="tree">
    <li v-for="node in nodes" :key="node.path">
      <button class="row" type="button" @click="toggle(node)">
        <span class="chev" :class="{ open: expanded[node.path], hidden: node.type !== 'directory' }">▸</span>
        <span class="name">{{ node.name }}</span>
      </button>
      <FileTree
        v-if="node.type === 'directory' && expanded[node.path]"
        :nodes="childrenOf(node)"
      />
    </li>
  </ul>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import type { FileNode } from '../../../preload/index.d'

defineOptions({ name: 'FileTree' })

const props = withDefaults(
  defineProps<{
    nodes: FileNode[]
    defaultExpanded?: string[]
  }>(),
  { defaultExpanded: () => [] }
)

const expanded = reactive<Record<string, boolean>>(
  Object.fromEntries(props.defaultExpanded.map((path) => [path, true]))
)
const loaded = reactive<Record<string, FileNode[]>>({})

function childrenOf(node: FileNode): FileNode[] {
  return loaded[node.path] ?? node.children ?? []
}

async function toggle(node: FileNode): Promise<void> {
  if (node.type !== 'directory') return
  if (expanded[node.path]) {
    expanded[node.path] = false
    return
  }
  if (!loaded[node.path] && !node.children?.length) {
    try {
      loaded[node.path] = await window.tunmo.workspace.tree(node.path)
    } catch (err) {
      console.error('[file-tree]', err)
      loaded[node.path] = []
    }
  }
  expanded[node.path] = true
}
</script>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0 0 0 8px;
}

.row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--tm-text);
  font-size: 13px;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}

.row:hover {
  background: #20242d;
}

.chev {
  width: 12px;
  color: var(--tm-muted);
  transform: rotate(0deg);
  display: inline-block;
  font-size: 11px;
}

.chev.open {
  transform: rotate(90deg);
}

.chev.hidden {
  visibility: hidden;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
