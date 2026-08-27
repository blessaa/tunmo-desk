import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { sendChatStream, type ChatMessage, type ToolEvent } from '@renderer/api/chat-stream'
import { useSettingsStore } from './settings'
import { useWorkspaceStore } from './workspace'

export interface ChatThread {
  id: string
  title: string
  messages: ChatMessage[]
  draft: string
  sending: boolean
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emptyThread(): ChatThread {
  return {
    id: `chat-${uid()}`,
    title: '新对话',
    messages: [],
    draft: '',
    sending: false
  }
}

function titleFrom(text: string): string {
  const line = text.trim().replace(/\s+/g, ' ')
  if (!line) return '新对话'
  return line.length > 24 ? `${line.slice(0, 24)}…` : line
}

export const useChatStore = defineStore('chat', () => {
  const threads = ref<ChatThread[]>([emptyThread()])
  const activeId = ref(threads.value[0].id)

  const active = computed(() => {
    const list = Array.isArray(threads.value) ? threads.value : []
    if (list.length === 0) return emptyThread()
    return list.find((item) => item.id === activeId.value) ?? list[0]
  })

  const draft = computed({
    get: () => active.value?.draft ?? '',
    set: (value: string) => {
      if (active.value) active.value.draft = value
    }
  })

  function select(id: string): void {
    if ((threads.value ?? []).some((item) => item.id === id)) {
      activeId.value = id
    }
  }

  function newChat(): void {
    const thread = emptyThread()
    if (!Array.isArray(threads.value)) {
      threads.value = []
    }
    threads.value.unshift(thread)
    activeId.value = thread.id
    ElMessage.success('已新建对话')
  }

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
