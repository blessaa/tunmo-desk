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
    /** 这一层要渲染的节点。 */
    nodes: FileNode[]
    /** 初始展开的路径（通常是工作区根）。 */
    defaultExpanded?: string[]
  }>(),
  { defaultExpanded: () => [] }
)

/** 路径 → 是否展开。 */
const expanded = reactive<Record<string, boolean>>(
  Object.fromEntries(props.defaultExpanded.map((path) => [path, true]))
)
/** 懒加载得到的子节点缓存。 */
const loaded = reactive<Record<string, FileNode[]>>({})

/** 取某目录的子节点：优先已加载的，否则用 props 自带的 children。 */
function childrenOf(node: FileNode): FileNode[] {
  return loaded[node.path] ?? node.children ?? []
}

/** 点文件夹：收起，或展开并在需要时向主进程要下一层。 */
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
