/**
 * 桌面端与 tunmo-backend 的对接层。
 * 对外仍提供原来的 startPiAgent / promptPi，方便 index.ts 的 IPC 不用改形状。
 * 对内：拉起后端、建 conversation、把事件译成旧的 chat:stream 格式。
 */
import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import log from 'electron-log'
import { loadSettings } from './settings'
import { startBackend, stopBackend, backendRoot } from './backend-process'
import { BackendRpcClient } from './backend-rpc'
import type { ConversationEvent, ConversationEventEnvelope } from './backend-types'
import type { PiPromptCommand, PiRpcWireEvent } from '../shared/pi-rpc'
import { listModelsFromBackend } from './pi-models'

/** 左下角状态灯用的后端生命状态。 */
export type RpcStatus = 'idle' | 'starting' | 'running' | 'missing' | 'error'

/** 推给渲染进程的后端状态，侧边栏「pi · 已连接」读这个。 */
export interface RpcState {
  /** 进程是否在跑。 */
  status: RpcStatus
  /** 固定为 backend，表示对话走 tunmo-backend 而不是主进程内嵌 SDK。 */
  engine: 'backend'
  /** 最近一次失败原因，给状态灯 title。 */
  lastError: string
  /** 当前选用的模型 id。 */
  modelId: string
  /** 状态栏展示名，目前与 modelId 相同。 */
  modelName: string
}

/** 设置页模型下拉的一项。 */
export interface ModelOption {
  id: string
  name: string
  provider: string
}

/** 发给渲染进程的流式事件，形状保持旧 pi RPC，chat-stream.ts 不用改。 */
export type ChatStreamEvent = PiRpcWireEvent

/** 侧边栏一条对话 对应 后端一个 conversation。 */
interface ConversationBinding {
  /** tunmo-backend 的 conversationId。 */
  conversationId: string
  /** 这条 WebSocket 是否已经 attach，否则收不到事件。 */
  attached: boolean
}

/** 当前 JSON-RPC 客户端；后端重启后会清空。 */
let client: BackendRpcClient | null = null
/** 侧边栏 sessionId（chat-xxx）→ 后端 conversationId。 */
const conversations = new Map<string, ConversationBinding>()
/** 正在发送的那次 prompt 的 IPC 回调，用来把流式事件推到对应窗口。 */
const streamListeners = new Set<(event: ChatStreamEvent) => void>()
/** toolCallId → 工具名，tool.completed 里没有 name，完成时要靠这里补。 */
const toolNames = new Map<string, string>()
/** 当前展示给 UI 的后端状态。 */
let state: RpcState = {
  status: 'idle',
  engine: 'backend',
  lastError: '',
  modelId: '',
  modelName: ''
}

/** 把最新 RpcState 广播到所有窗口，侧边栏状态灯会更新。 */
function sendStatus(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('rpc:status', getRpcState())
  }
}

/** 返回状态副本，避免外部改到内部 state。 */
export function getRpcState(): RpcState {
  return { ...state }
}

/** 用 settings.json 里的模型填到状态栏。 */
function markSettings(): void {
  const settings = loadSettings()
  state.modelId = settings.modelId
  state.modelName = settings.modelId || ''
}

/** 发给 conversation.create 的工作目录：已打开的文件夹，否则用户主目录。 */
function workspaceCwd(): string {
  return loadSettings().workspacePath || homedir()
}

/** 把一条已映射的流式事件发给当前所有发送中的 IPC 监听。 */
function emitStream(event: ChatStreamEvent): void {
  for (const listener of streamListeners) listener(event)
}

/**
 * 把 tunmo-backend 事件译成旧 chat-stream 认识的 pi RPC 事件。
 * 译不了的类型返回 null，直接丢掉。
 */
function mapEvent(sessionId: string, event: ConversationEvent): ChatStreamEvent | null {
  switch (event.type) {
    case 'message.text.delta':
      return {
        type: 'message_update',
        sessionId,
        assistantMessageEvent: { type: 'text_delta', delta: event.delta }
      }
    case 'tool.started':
      toolNames.set(event.toolCallId, event.name)
      return {
        type: 'tool_execution_start',
        sessionId,
        toolCallId: event.toolCallId,
        toolName: event.name,
        args: event.input
      }
    case 'tool.completed':
      return {
        type: 'tool_execution_end',
        sessionId,
        toolCallId: event.toolCallId,
        toolName: toolNames.get(event.toolCallId) || event.toolCallId,
        isError: event.isError,
        result: event.output
      }
    case 'message.completed':
      if (event.message.role !== 'assistant') return null
      return {
        type: 'message_end',
        sessionId,
        role: 'assistant',
        content: event.message.content,
        errorMessage: event.message.status === 'failed' ? event.message.stopReason : undefined
      }
    default:
      return null
  }
}

/**
 * 默认事件入口：按 conversationId 找回侧边栏 session，再映射并推给渲染进程。
 */
function onEnvelope(envelope: ConversationEventEnvelope): void {
  /** 侧边栏对话 id，找不到说明不是本窗口的会话。 */
  let sessionId = ''
  for (const [id, binding] of conversations) {
    if (binding.conversationId === envelope.conversationId) {
      sessionId = id
      break
    }
  }
  if (!sessionId) return
  const mapped = mapEvent(sessionId, envelope.event)
  if (mapped) emitStream(mapped)
}

/** 确保后端进程在跑，并且 WebSocket 已 initialize。 */
async function ensureClient(): Promise<BackendRpcClient> {
  if (client) return client
  const { port } = await startBackend()
  /** 新客户端，连上后再挂默认事件处理。 */
  const next = new BackendRpcClient(port)
  await next.connect()
  next.setEventHandler(onEnvelope)
  client = next
  return next
}

/**
 * 侧边栏某条对话第一次发消息时，在后端 create + attach。
 * 之后复用同一个 conversationId，上下文才连续。
 */
async function ensureConversation(rpc: BackendRpcClient, sessionId: string): Promise<string> {
  const existing = conversations.get(sessionId)
  if (existing) {
    if (!existing.attached) {
      await rpc.call('conversation.attach', { conversationId: existing.conversationId, afterSeq: 0 })
      existing.attached = true
    }
    return existing.conversationId
  }

  const settings = loadSettings()
  /** create 的返回值，里面有后端分配的 conversationId。 */
  const created = (await rpc.call('conversation.create', {
    workingDirectory: workspaceCwd(),
    ...(settings.provider && settings.modelId
      ? { model: { provider: settings.provider, modelId: settings.modelId } }
      : {})
  })) as { conversationId: string }
  await rpc.call('conversation.attach', { conversationId: created.conversationId, afterSeq: 0 })
  conversations.set(sessionId, { conversationId: created.conversationId, attached: true })
  return created.conversationId
}

/** 关掉 WebSocket、清会话表、杀掉后端。改设置或换工作区时用。 */
async function resetConnection(): Promise<void> {
  const current = client
  client = null
  conversations.clear()
  streamListeners.clear()
  toolNames.clear()
  if (current) {
    try {
      await current.close()
    } catch {
      // 关闭时连接可能已经断了，忽略即可
    }
  }
  stopBackend()
}

/** 设置对话框点「刷新」时列出模型。 */
export async function listModels(overrides?: { provider?: string; apiKey?: string }): Promise<ModelOption[]> {
  return listModelsFromBackend(backendRoot(), overrides)
}

/** 应用启动或手动重连时调用：拉起后端并更新状态灯。 */
export async function startPiAgent(): Promise<RpcState> {
  state.status = 'starting'
  state.lastError = ''
  markSettings()
  sendStatus()
  try {
    await ensureClient()
    state.status = 'running'
    if (!state.modelId) {
      state.lastError = '未选择模型：请在设置中填写 API Key 并选择模型'
    }
    sendStatus()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.status = message.includes('找不到') || message.includes('未构建') ? 'missing' : 'error'
    state.lastError = message
    log.error('[backend]', message)
    sendStatus()
  }
  return getRpcState()
}

/** 保存 API Key / 模型后重启后端，让新环境变量生效。 */
export async function applySettingsToRuntime(): Promise<RpcState> {
  await resetConnection()
  return startPiAgent()
}

/** 侧边栏手动重启后端。 */
export async function restartPiAgent(): Promise<RpcState> {
  await resetConnection()
  return startPiAgent()
}

/**
 * 换了工作目录：Pi 的 PI_CWD_ROOT 必须跟着变，所以整进程重启。
 * @param _cwd 新目录，实际从 settings 再读一遍
 */
export async function bindWorkspace(_cwd: string): Promise<RpcState> {
  await resetConnection()
  return startPiAgent()
}

/** 退出应用时停后端，不阻塞 quit。 */
export function stopPiAgent(): void {
  void resetConnection()
  state.status = 'idle'
  state.lastError = ''
  state.modelId = ''
  state.modelName = ''
}

/**
 * 处理渲染进程的一次发送。
 * @param sessionId 侧边栏对话 id（chat-xxx）
 * @param command 旧的 pi prompt 命令，只用 message / id
 * @param emit 把流式事件和最终 response 推回该窗口
 */
export async function promptPi(
  sessionId: string,
  command: PiPromptCommand,
  emit: (event: PiRpcWireEvent) => void
): Promise<PiRpcWireEvent> {
  /** 给每条事件打上 sessionId，多对话同时流式时不会串台。 */
  const tagged = (event: PiRpcWireEvent): void => {
    emit({ ...event, sessionId })
  }
  streamListeners.add(emit)

  /** 组一条失败 response 并立刻推给界面。 */
  const fail = (error: string): PiRpcWireEvent => {
    const response = {
      id: command.id,
      type: 'response' as const,
      command: 'prompt' as const,
      success: false,
      error
    }
    tagged(response)
    return response
  }

  if (command.type !== 'prompt') {
    streamListeners.delete(emit)
    return fail(`unsupported rpc command: ${String((command as { type?: string }).type)}`)
  }

  const settings = loadSettings()
  if (!settings.modelId) {
    streamListeners.delete(emit)
    return fail('还没有可用模型。请在设置中填写 API Key，刷新并选择模型后再发送。')
  }

  try {
    const rpc = await ensureClient()
    /** 这条侧边栏对话对应的后端 conversationId。 */
    const conversationId = await ensureConversation(rpc, sessionId)
    /** 等到 run.settled / 失败 / 超时才结束这次 IPC。 */
    const settled = new Promise<PiRpcWireEvent>((resolve) => {
      /** 防止 failed 和 settled 各 resolve 一次。 */
      let done = false
      /** 5 分钟超时定时器。 */
      let timer: ReturnType<typeof setTimeout> | undefined
      /** 只生效一次的收尾。 */
      const finish = (response: PiRpcWireEvent): void => {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        resolve(response)
      }
      timer = setTimeout(() => finish(fail('等待模型响应超时')), 5 * 60 * 1000)
      rpc.setEventHandler((envelope) => {
        onEnvelope(envelope)
        if (done || envelope.conversationId !== conversationId) return
        if (envelope.event.type === 'run.failed') {
          finish(fail(envelope.event.error?.message || '对话失败'))
          return
        }
        if (envelope.event.type !== 'run.settled') return
        if (envelope.event.outcome === 'failed' || envelope.event.outcome === 'interrupted') {
          finish(fail(envelope.event.outcome === 'interrupted' ? '已中断' : '对话失败'))
          return
        }
        const response = {
          id: command.id,
          type: 'response' as const,
          command: 'prompt' as const,
          success: true
        }
        tagged(response)
        finish(response)
      })
    })

    await rpc.call('conversation.send', {
      conversationId,
      clientRequestId: command.id || `req-${Date.now()}`,
      message: command.message
    })
    return await settled
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  } finally {
    streamListeners.delete(emit)
    client?.setEventHandler(onEnvelope)
  }
}
