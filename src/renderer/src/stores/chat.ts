/**
 * 侧边栏多对话 + 当前输入框。发送走 sendChatStream → window.tunmo.chat。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { sendChatStream, type ChatMessage, type ToolEvent } from '@renderer/api/chat-stream'
import { useSettingsStore } from './settings'
import { useWorkspaceStore } from './workspace'

/** 侧边栏里的一条独立对话，对应后端一个 conversation。 */
export interface ChatThread {
  id: string
  title: string
  messages: ChatMessage[]
  draft: string
  sending: boolean
}

/** 生成消息/对话 id。 */
function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** 空对话，点「新建」时用。 */
function emptyThread(): ChatThread {
  return {
    id: `chat-${uid()}`,
    title: '新对话',
    messages: [],
    draft: '',
    sending: false
  }
}

/** 用第一条用户消息截出侧边栏标题。 */
function titleFrom(text: string): string {
  const line = text.trim().replace(/\s+/g, ' ')
  if (!line) return '新对话'
  return line.length > 24 ? `${line.slice(0, 24)}…` : line
}

export const useChatStore = defineStore('chat', () => {
  /** 所有对话，最新的在前面。 */
  const threads = ref<ChatThread[]>([emptyThread()])
  /** 当前选中的对话 id。 */
  const activeId = ref(threads.value[0].id)

  /** 当前对话；列表异常时退回空对话避免崩溃。 */
  const active = computed(() => {
    const list = Array.isArray(threads.value) ? threads.value : []
    if (list.length === 0) return emptyThread()
    return list.find((item) => item.id === activeId.value) ?? list[0]
  })

  /** 绑定输入框：读写的是当前对话的 draft。 */
  const draft = computed({
    get: () => active.value?.draft ?? '',
    set: (value: string) => {
      if (active.value) active.value.draft = value
    }
  })

  /** 切换侧边栏会话。 */
  function select(id: string): void {
    if ((threads.value ?? []).some((item) => item.id === id)) {
      activeId.value = id
    }
  }

  /** 插入一条新对话并聚焦。 */
  function newChat(): void {
    const thread = emptyThread()
    if (!Array.isArray(threads.value)) {
      threads.value = []
    }
    threads.value.unshift(thread)
    activeId.value = thread.id
    ElMessage.success('已新建对话')
  }

  /** 把当前输入发给后端，并往气泡列表里追加 user/assistant。 */
  async function send(): Promise<void> {
    const thread = active.value
    if (!thread) return
    const text = thread.draft.trim()
    if (!text || thread.sending) return

    const workspace = useWorkspaceStore()
    const settings = useSettingsStore()

    if (thread.title === '新对话') {
      thread.title = titleFrom(text)
    }

    thread.messages.push({
      id: uid(),
      role: 'user',
      content: text,
      toolEvents: [],
      createdAt: Date.now()
    })
    thread.draft = ''

    /** 正在流式填充的那条助手消息 id。 */
    const assistantId = uid()
    thread.messages.push({
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      toolEvents: [],
      createdAt: Date.now()
    })
    thread.sending = true

    /** 按 id 找回助手气泡（列表被改过也能找到）。 */
    const current = (): ChatMessage | undefined =>
      thread.messages.find((item) => item.id === assistantId)

    try {
      await sendChatStream(
        {
          sessionId: thread.id,
          message: text,
          workspacePath: workspace.path,
          apiKey: settings.apiKey
        },
        {
          onText: (delta) => {
            const msg = current()
            if (msg) msg.content += delta
          },
          onTool: (event: ToolEvent) => {
            const msg = current()
            if (!msg) return
            const idx = msg.toolEvents.findIndex((item) => item.id === event.id)
            if (idx >= 0) msg.toolEvents[idx] = { ...msg.toolEvents[idx], ...event }
            else msg.toolEvents.push(event)
          },
          onDone: () => {
            const msg = current()
            if (msg) msg.streaming = false
          },
          onError: (message) => {
            const msg = current()
            if (!msg) return
            msg.content = message
            msg.streaming = false
          }
        }
      )
    } finally {
      const msg = current()
      if (msg) msg.streaming = false
      thread.sending = false
    }
  }

  return { threads, activeId, active, draft, select, newChat, send }
})
