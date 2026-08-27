/** Official pi RPC prompt command. See @earendil-works/pi-coding-agent docs/rpc.md */
export interface PiPromptCommand {
  id?: string
  sessionId?: string
  type: 'prompt'
  message: string
  streamingBehavior?: 'steer' | 'followUp'
}

export interface PiRpcResponse {
  id?: string
  type: 'response'
  command: 'prompt'
  success: boolean
  error?: string
}

export interface PiRpcStreamEvent {
  type: string
  [key: string]: unknown
}

export type PiRpcWireEvent = PiRpcResponse | PiRpcStreamEvent

export function jsonSafe<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return String(value) as T
  }
}

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

export function makePromptCommand(message: string, sessionId?: string): PiPromptCommand {
  return {
    id: `req-${Date.now()}`,
    sessionId,
    type: 'prompt',
    message
  }
}

/** Strip non-cloneable SDK fields so IPC matches the RPC wire events. */
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
