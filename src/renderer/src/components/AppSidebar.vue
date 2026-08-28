<template>
  <aside class="sidebar">
    <div class="brand-row">
      <span class="brand">tunmo</span>
      <el-button size="small" class="new-btn" native-type="button" title="新建对话" @click="onNewChat">
        <el-icon><Plus /></el-icon>
        新建
      </el-button>
      <el-button size="small" class="icon-btn" title="刷新文件树" @click="workspace.refreshTree">
        <el-icon><RefreshLeft /></el-icon>
      </el-button>
    </div>

    <div class="tree-wrap scroll">
      <div class="branch">
        <button class="row root" type="button" @click="sessionsOpen = !sessionsOpen">
          <span class="chev" :class="{ open: sessionsOpen }">▸</span>
          <span class="name">会话区</span>
        </button>
        <ul v-show="sessionsOpen" class="tree">
          <li v-for="thread in chat.threads ?? []" :key="thread.id">
            <button
              class="row"
              type="button"
              :class="{ active: thread.id === chat.activeId }"
              :title="thread.title"
              @click="chat.select(thread.id)"
            >
              <span class="chev hidden">▸</span>
              <span class="name">{{ thread.title }}</span>
              <span v-if="thread.sending" class="busy-dot" />
            </button>
          </li>
        </ul>
      </div>

      <div class="branch">
        <div class="root-line">
          <button class="row root" type="button" @click="workspaceOpen = !workspaceOpen">
            <span class="chev" :class="{ open: workspaceOpen }">▸</span>
            <span class="name">工作区</span>
          </button>
          <el-button
            size="small"
            type="primary"
            :loading="workspace.loading"
            @click.stop="workspace.openFolder"
          >
            打开目录
          </el-button>
        </div>
        <div v-show="workspaceOpen" class="workspace-body">
          <FileTree
            v-if="workspace.path"
            :key="`${workspace.path}:${workspace.treeNonce}`"
            :nodes="workspaceRoot"
            :default-expanded="[workspace.path]"
          />
          <div v-else class="empty muted">打开一个工作目录，文件会显示在这里。</div>
        </div>
      </div>
    </div>

    <footer class="side-foot">
      <div class="rpc" :title="workspace.rpc.lastError || 'tunmo-backend'">
        <span class="dot" :class="workspace.rpc.status" />
        <span>pi · {{ rpcLabel }}</span>
      </div>
      <el-button text @click="settings.open">
        <el-icon><Setting /></el-icon>
      </el-button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Plus, RefreshLeft, Setting } from '@element-plus/icons-vue'
import FileTree from './FileTree.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { useChatStore } from '@renderer/stores/chat'
import type { FileNode } from '../../../preload/index.d'

const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const chat = useChatStore()
/** 会话区是否展开。 */
const sessionsOpen = ref(true)
/** 工作区文件树是否展开。 */
const workspaceOpen = ref(true)

/** 把工作区根包装成 FileTree 要的单根节点。 */
const workspaceRoot = computed<FileNode[]>(() => {
  if (!workspace.path) return []
  return [
    {
      name: workspace.name,
      path: workspace.path,
      type: 'directory',
      children: workspace.tree
    }
  ]
})

/** 新建对话并聚焦输入框。 */
async function onNewChat(): Promise<void> {
  chat.newChat()
  sessionsOpen.value = true
  await nextTick()
  document.querySelector<HTMLTextAreaElement>('.chat-pane textarea')?.focus()
}

/** 左下角状态灯文案。 */
const rpcLabel = computed(() => {
  if (workspace.rpc.status === 'running') {
    return workspace.rpc.modelName || '无模型'
  }
  const map = {
    idle: '未启动',
    starting: '启动中',
    running: '已连接',
    missing: '未安装',
    error: '异常'
  }
  return map[workspace.rpc.status]
})
</script>

<style scoped>
.brand-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--tm-border);
}

.brand {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--tm-text);
}

.new-btn,
.icon-btn {
  --el-button-bg-color: #1e222b;
  --el-button-border-color: #3a4150;
  --el-button-hover-bg-color: #2a303c;
  --el-button-hover-border-color: #4a5160;
  --el-button-text-color: var(--tm-text);
  --el-button-hover-text-color: var(--tm-text);
}

.icon-btn {
  padding: 7px;
}

.tree-wrap {
  flex: 1;
  min-height: 0;
  padding: 6px 4px 8px;
}

.branch + .branch {
  margin-top: 8px;
}

.root-line {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 4px;
}

.root-line .row {
  flex: 1;
  min-width: 0;
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
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}

.row.root {
  font-weight: 600;
}

.row:hover {
  background: #20242d;
}

.row.active {
  background: #243044;
}

.tree {
  list-style: none;
  margin: 0;
  padding: 0 0 0 8px;
}

.chev {
  width: 12px;
  color: var(--tm-muted);
  transform: rotate(0deg);
  display: inline-block;
  font-size: 11px;
  flex-shrink: 0;
}

.chev.open {
  transform: rotate(90deg);
}

.chev.hidden {
  visibility: hidden;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.busy-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3dd68c;
  flex-shrink: 0;
}

.workspace-body {
  padding-left: 0;
}

.empty {
  padding: 10px 8px 10px 20px;
  font-size: 12px;
  line-height: 1.6;
}

.side-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-top: 1px solid var(--tm-border);
  font-size: 12px;
  color: var(--tm-muted);
}

.rpc {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6b7280;
}

.dot.running {
  background: #3dd68c;
}

.dot.missing,
.dot.idle {
  background: #8b93a7;
}

.dot.error {
  background: #f56c6c;
}

.dot.starting {
  background: #e6a23c;
}
</style>
