/**
 * 把主进程 chat:stream 事件填进气泡：增量文字、工具卡片、结束/错误。
 */
import { extractMessageText, makePromptCommand, type PiRpcWireEvent } from '@shared/pi-rpc'

/** 工具卡片的四种展示状态。 */
export type ToolEventStatus = 'start' | 'running' | 'result' | 'error'

/** 一条助手消息里的一次工具调用。 */
export interface ToolEvent {
  id: string
  name: string
  status: ToolEventStatus
  args?: string
  result?: string
}

/** 聊天气泡。 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  toolEvents: ToolEvent[]
  createdAt: number
}

/** sendChatStream 用来更新 UI 的回调。 */
export interface ChatStreamHandlers {
  onText: (delta: string) => void
  onTool: (event: ToolEvent) => void
  onDone: () => void
  onError: (message: string) => void
}

/** 从 message_end 的 content 抽出全文（没有 text_delta 时用）。 */
function extractText(content: unknown): string {
  return extractMessageText(content)
}

/** 工具参数/结果转成可放进 <pre> 的字符串。 */
function compact(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 发一条消息并订阅流式事件，直到 IPC 返回。
 * workspacePath / apiKey 由主进程读 settings，这里只为保持调用形状。
 */
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
  /** 已经收到过增量则不再用 message_end 整段覆盖，避免重复。 */
  let gotTextDelta = false
  /** 已经报过的错误文案，防止 onError 连打两次。 */
  let reportedError = ''

  const fail = (message: string): void => {
    if (reportedError === message) return
    reportedError = message
    handlers.onError(message)
  }

  /** 取消 chat:stream 监听。 */
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
