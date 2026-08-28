/**
 * tunmo-backend WebSocket 推送事件的类型，对应 conversation.event 的 params。
 * 只列出桌面端映射聊天气泡时用到的字段。
 */

/** 后端返回给客户端的业务错误。 */
export interface PublicError {
  /** 稳定错误码，例如 INVALID_PARAMS。 */
  code: string
  /** 可展示的中文说明。 */
  message: string
  /** 为 true 时调用方可重试。 */
  retryable?: boolean
}

/** 一条 UI 消息里的内容块：正文、思考、图片或工具调用。 */
export interface UiContent {
  /** 块类型，如 text / thinking / toolCall。 */
  type: string
  /** 文本块正文。 */
  text?: string
  /** 思考块内容（默认不向普通客户端展开）。 */
  thinking?: string
  /** 工具调用 id。 */
  id?: string
  /** 工具名。 */
  name?: string
  /** 工具入参。 */
  arguments?: unknown
}

/** 快照或 message.completed 里的一条消息。 */
export interface UiMessage {
  /** 消息 id。 */
  id: string
  /** 角色。 */
  role: 'user' | 'assistant' | 'toolResult' | 'system'
  /** 内容块列表。 */
  content: UiContent[]
  /** streaming / completed / failed 等。 */
  status: string
  /** 失败或截断原因。 */
  stopReason?: string
}

/** 单条对话事件。桌面端主要用文本增量、工具起止、run 结束。 */
export type ConversationEvent =
  | { type: 'run.accepted'; clientRequestId: string }
  | { type: 'run.started' }
  | { type: 'run.interrupting'; reason: string }
  | { type: 'run.interrupted'; mode: string }
  | { type: 'run.failed'; error: PublicError }
  | { type: 'run.settled'; outcome: string }
  | { type: 'message.text.delta'; messageId: string; contentIndex: number; delta: string }
  | { type: 'message.completed'; message: UiMessage }
  | { type: 'tool.started'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool.completed'; toolCallId: string; output: unknown; isError: boolean }

/** 包在 JSON-RPC notification 里的事件信封，带会话 id 和单调序号。 */
export interface ConversationEventEnvelope {
  /** 协议版本，当前固定为 1。 */
  schemaVersion: 1
  /** 后端对话 id，对应 conversation.create 的返回值。 */
  conversationId: string
  /** 本次 run id，中断时会用到。 */
  runId?: string
  /** 对话内递增序号，用于重放和去重。 */
  seq: number
  /** 事件发生时间（ISO 字符串）。 */
  occurredAt: string
  /** 真正的事件体。 */
  event: ConversationEvent
}
