/**
 * 工作区路径、文件树、后端状态灯。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { FileNode, RpcState } from '../../../preload/index.d'

export const useWorkspaceStore = defineStore('workspace', () => {
  /** 当前工作区绝对路径。 */
  const path = ref('')
  /** 根目录下一层的文件树。 */
  const tree = ref<FileNode[]>([])
  /** 每次刷新 +1，用来强制重建 FileTree。 */
  const treeNonce = ref(0)
  /** 正在弹出选目录框。 */
  const loading = ref(false)
  /** tunmo-backend 状态，侧边栏底部展示。 */
  const rpc = ref<RpcState>({
    status: 'idle',
    engine: 'backend',
    lastError: '',
    modelId: '',
    modelName: ''
  })

  /** 侧边栏根节点显示名。 */
  const name = computed(() => {
    if (!path.value) return '未打开工作目录'
    return path.value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path.value
  })

  /** 页面挂载时恢复路径、监听后端状态、如有路径则拉文件树。 */
  async function hydrate(): Promise<void> {
    const settings = await window.tunmo.settings.get()
    path.value = settings.workspacePath
    rpc.value = await window.tunmo.rpc.status()
    window.tunmo.rpc.onStatus((state) => {
      rpc.value = state
    })
    if (path.value) await refreshTree()
  }

  /** 打开系统选目录，并刷新树。 */
  async function openFolder(): Promise<void> {
    loading.value = true
    try {
      const settings = await window.tunmo.workspace.open()
      path.value = settings.workspacePath
      await refreshTree()
    } finally {
      loading.value = false
    }
  }

  /** 重新列出工作区根下一层。 */
  async function refreshTree(): Promise<void> {
    if (!path.value) {
      tree.value = []
      return
    }
    tree.value = await window.tunmo.workspace.tree(path.value)
    treeNonce.value += 1
  }

  /** 若后端挂了，再调一次启动。 */
  async function refreshRpc(): Promise<void> {
    rpc.value = await window.tunmo.rpc.start()
  }

  /** 杀掉并重启 tunmo-backend。 */
  async function restartRpc(): Promise<void> {
    rpc.value = await window.tunmo.rpc.restart()
  }

  return { path, tree, treeNonce, loading, rpc, name, hydrate, openFolder, refreshTree, refreshRpc, restartRpc }
})
