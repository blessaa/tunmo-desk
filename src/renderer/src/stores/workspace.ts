import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { FileNode, RpcState } from '../../../preload/index.d'

export const useWorkspaceStore = defineStore('workspace', () => {
  const path = ref('')
  const tree = ref<FileNode[]>([])
  const treeNonce = ref(0)
  const loading = ref(false)
  const rpc = ref<RpcState>({
    status: 'idle',
    engine: 'sdk',
    lastError: '',
    modelId: '',
    modelName: ''
  })

  const name = computed(() => {
    if (!path.value) return '未打开工作目录'
    return path.value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path.value
  })

  async function hydrate(): Promise<void> {
    const settings = await window.tunmo.settings.get()
    path.value = settings.workspacePath
    rpc.value = await window.tunmo.rpc.status()
    window.tunmo.rpc.onStatus((state) => {
      rpc.value = state
    })
    if (path.value) await refreshTree()
  }

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

  async function refreshTree(): Promise<void> {
    if (!path.value) {
      tree.value = []
      return
    }
    tree.value = await window.tunmo.workspace.tree(path.value)
    treeNonce.value += 1
  }

  async function refreshRpc(): Promise<void> {
    rpc.value = await window.tunmo.rpc.start()
  }

  async function restartRpc(): Promise<void> {
    rpc.value = await window.tunmo.rpc.restart()
  }

  return { path, tree, treeNonce, loading, rpc, name, hydrate, openFolder, refreshTree, refreshRpc, restartRpc }
})
