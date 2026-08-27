import { extractMessageText, makePromptCommand, type PiRpcWireEvent } from '@shared/pi-rpc'

export type ToolEventStatus = 'start' | 'running' | 'result' | 'error'

export interface ToolEvent {
  id: string
  name: string
  status: ToolEventStatus
  args?: string
  result?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  toolEvents: ToolEvent[]
  createdAt: number
}

export interface ChatStreamHandlers {
  onText: (delta: string) => void
  onTool: (event: ToolEvent) => void
  onDone: () => void
  onError: (message: string) => void
}

function extractText(content: unknown): string {
  return extractMessageText(content)
}

function compact(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export async function sendChatStream(
  payload: { sessionId: string; message: string; workspacePath: string; apiKey: string },
  handlers: ChatStreamHandlers
): Promise<void> {
  void payload.workspacePath
  void payload.apiKey

  if (!window.tunmo?.chat) {
    handlers.onError('渲染进程未连上 preload（window.tunmo 不存在）')
    return
  }

  const command = makePromptCommand(payload.message, payload.sessionId)
  console.log('[pi-rpc] send', command)
  let gotTextDelta = false
  let reportedError = ''

  const fail = (message: string): void => {
    if (reportedError === message) return
    reportedError = message
    handlers.onError(message)
  }

  const off = window.tunmo.chat.onEvent((event: PiRpcWireEvent) => {
    const eventSession = (event as { sessionId?: string }).sessionId
    if (eventSession && eventSession !== payload.sessionId) return
    console.log('[pi-rpc] event', event)
    if (event.type === 'message_update') {
      const inner = event.assistantMessageEvent as { type?: string; delta?: string } | undefined
      if (inner?.type === 'text_delta' && inner.delta) {
        gotTextDelta = true
        handlers.onText(inner.delta)
      }
      return
    }
    if (event.type === 'tool_execution_start') {
      handlers.onTool({
        id: String(event.toolCallId ?? event.toolName ?? 'tool'),
        name: String(event.toolName ?? 'tool'),
        status: 'start',
        args: compact(event.args)
      })
      return
    }
    if (event.type === 'tool_execution_end') {
      handlers.onTool({
        id: String(event.toolCallId ?? event.toolName ?? 'tool'),
        name: String(event.toolName ?? 'tool'),
        status: event.isError ? 'error' : 'result',
        result: compact(event.result)
      })
      return
    }
    if (
      (event.type === 'message_end' || event.type === 'turn_end') &&
      event.role === 'assistant'
    ) {
      if (event.errorMessage) {
        fail(String(event.errorMessage))
        return
      }
      if (!gotTextDelta) {
        const text = extractText(event.content)
        if (text) handlers.onText(text)
      }
    }
  })

  try {
    const response = await window.tunmo.chat.send(command)
    console.log('[pi-rpc] response', response)
    if (!response?.success && response?.error) {
      fail(response.error)
    }
    handlers.onDone()
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  } finally {
    off()
  }
}
