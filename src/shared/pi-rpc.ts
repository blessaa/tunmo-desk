/**
 * 主进程和渲染进程共用的对话事件形状。
 * 渲染进程 chat-stream 仍按旧 pi RPC 的 text_delta / tool_execution_* 来画气泡。
 */

/** 发给后端（经主进程）的一条用户提问。 */
export interface PiPromptCommand {
  /** 请求 id，对应 JSON-RPC clientRequestId。 */
  id?: string
  /** 侧边栏对话 id。 */
  sessionId?: string
  type: 'prompt'
  /** 用户输入的正文。 */
  message: string
  streamingBehavior?: 'steer' | 'followUp'
}

/** 一次发送结束时的结果。 */
export interface PiRpcResponse {
  id?: string
  type: 'response'
  command: 'prompt'
  success: boolean
  error?: string
}

/** 流式过程中的任意事件。 */
export interface PiRpcStreamEvent {
  type: string
  [key: string]: unknown
}

/** 流式事件或最终 response。 */
export type PiRpcWireEvent = PiRpcResponse | PiRpcStreamEvent

/** 去掉不可克隆字段后再走 IPC，避免 Structured Clone 失败。 */
export function jsonSafe<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return String(value) as T
  }
}

/** 从助手消息的 content 块里抽出可见文字。 */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const item = block as { type?: string; text?: string; thinking?: string }
      if (item.type === 'text') return item.text ?? ''
      if (item.type === 'thinking') return item.thinking ?? ''
      return ''
    })
    .join('')
}

/** 从一条 assistant 消息里取出正文和错误，给没有 delta 的模型做兜底。 */
export function summarizeAssistant(message: unknown): { text: string; error: string } {
  if (!message || typeof message !== 'object') return { text: '', error: '' }
  const item = message as {
    role?: string
    content?: unknown
    errorMessage?: string
    stopReason?: string
  }
  const text = extractMessageText(item.content)
  const error =
    item.errorMessage ||
    (item.stopReason === 'error' ? '模型返回 stopReason=error（没有正文）' : '')
  return { text, error }
}

/** 组装一条 prompt 命令，id 用时间戳保证本机唯一。 */
export function makePromptCommand(message: string, sessionId?: string): PiPromptCommand {
  return {
    id: `req-${Date.now()}`,
    sessionId,
    type: 'prompt',
    message
  }
}

/**
 * 把 SDK 原始事件收成可 IPC 的纯 JSON。
 * 现在对话走 tunmo-backend，主进程会先映射再推；这条仍留给兼容。
 */
export function toRpcWireEvent(event: { type?: string; [key: string]: unknown }): PiRpcStreamEvent {
  const assistant = event.assistantMessageEvent as Record<string, unknown> | undefined
  if (event.type === 'message_update' && assistant) {
    const { partial: _partial, ...rest } = assistant
    return {
      type: 'message_update',
      assistantMessageEvent: rest
    }
  }

  if (event.type === 'tool_execution_start') {
    return {
      type: 'tool_execution_start',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args
    }
  }

  if (event.type === 'tool_execution_update') {
    return {
      type: 'tool_execution_update',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
      partialResult: event.partialResult
    }
  }

  if (event.type === 'tool_execution_end') {
    return {
      type: 'tool_execution_end',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
      result: event.result
    }
  }

  if (event.type === 'message_end') {
    const message = event.message as {
      role?: string
      content?: unknown
      errorMessage?: string
      stopReason?: string
    } | undefined
    return jsonSafe({
      type: 'message_end',
      role: message?.role,
      content: message?.content,
      errorMessage: message?.errorMessage,
      stopReason: message?.stopReason
    })
  }

  if (event.type === 'turn_end') {
    const message = event.message as {
      role?: string
      content?: unknown
      errorMessage?: string
      stopReason?: string
    } | undefined
    return jsonSafe({
      type: 'turn_end',
      role: message?.role,
      content: message?.content,
      errorMessage: message?.errorMessage,
      stopReason: message?.stopReason
    })
  }

  if (event.type === 'agent_end') {
    return {
      type: 'agent_end',
      willRetry: event.willRetry,
      error: event.error
    }
  }

  return { type: String(event.type ?? 'unknown') }
}
