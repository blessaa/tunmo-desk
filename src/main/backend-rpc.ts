/**
 * tunmo-backend 的 JSON-RPC WebSocket 客户端。
 * 主进程用它发 conversation.* 命令，并接收 conversation.event 推送。
 */
import log from 'electron-log'
import type { ConversationEventEnvelope } from './backend-types'

/** JSON-RPC 成功响应：用 id 对上之前发出的 call。 */
export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  /** 对应本次 call 的请求 id。 */
  id: string | number | null
  /** 方法返回值，例如 conversation.create 的 conversationId。 */
  result: unknown
}

/** JSON-RPC 失败响应。 */
export interface JsonRpcError {
  jsonrpc: '2.0'
  id: string | number | null
  error: {
    /** JSON-RPC 错误码。 */
    code: number
    /** 简短错误说明。 */
    message: string
    /** 后端附带的业务错误，优先展示 data.message。 */
    data?: { message?: string }
  }
}

/** 一条尚未完成的 RPC 调用，等服务端带相同 id 的响应。 */
type Pending = {
  /** 调用成功时把 result 交还给 call()。 */
  resolve: (value: unknown) => void
  /** 超时、断开或服务端 error 时失败。 */
  reject: (error: Error) => void
}

/** 连上本机 tunmo-backend 的 WebSocket，负责发命令和收事件。 */
export class BackendRpcClient {
  /** 当前连接；未连接或已关闭时为 null。 */
  private ws: WebSocket | null = null
  /** 自增请求 id，用来匹配请求和响应。 */
  private nextId = 1
  /** 尚未收到响应的 call，key 是请求 id。 */
  private readonly pending = new Map<number, Pending>()
  /** 收到 conversation.event 时回调；由 pi-agent 设置。 */
  private onEvent: ((envelope: ConversationEventEnvelope) => void) | null = null

  /**
   * @param port tunmo-backend 当前监听的端口
   */
  constructor(private readonly port: number) {}

  /**
   * 建立 WebSocket，并先做 session.initialize。
   * 子协议必须是 tunmo.agent.v1，否则后端会直接断开。
   */
  async connect(): Promise<void> {
    await this.close()
    /** 本机 WebSocket 地址，只给主进程用。 */
    const url = `ws://127.0.0.1:${this.port}/api/v1/agent/ws`
    this.ws = await new Promise<WebSocket>((resolve, reject) => {
      /** 带约定子协议的连接。 */
      const socket = new WebSocket(url, ['tunmo.agent.v1'])
      /** 握手失败时走这里，避免一直挂起。 */
      const onError = (): void => {
        reject(new Error(`WebSocket 连接失败：${url}`))
      }
      socket.addEventListener('error', onError, { once: true })
      socket.addEventListener(
        'open',
        () => {
          socket.removeEventListener('error', onError)
          resolve(socket)
        },
        { once: true }
      )
    })
    this.ws.addEventListener('message', (event) => this.handleMessage(String(event.data)))
    this.ws.addEventListener('close', () => {
      this.failAll(new Error('tunmo-backend 连接已断开'))
      this.ws = null
    })
    await this.call('session.initialize', {
      protocolVersion: 1,
      clientId: 'tunmo-desk',
      capabilities: { eventReplay: true }
    })
  }

  /** 注册/更换事件回调。发消息期间会临时换成带结算逻辑的处理器。 */
  setEventHandler(handler: ((envelope: ConversationEventEnvelope) => void) | null): void {
    this.onEvent = handler
  }

  /**
   * 发一条带 id 的 JSON-RPC 方法并等待结果。
   * 60 秒无响应视为超时。notification（无 id）不会走这里。
   */
  async call(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('tunmo-backend 未连接')
    }
    /** 本次请求的唯一 id。 */
    const id = this.nextId++
    /** 发到后端的 JSON-RPC 正文。 */
    const payload = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }
    return new Promise((resolve, reject) => {
      /** 超时定时器，到期从 pending 里摘掉并 reject。 */
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 超时`))
      }, 60_000)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.ws?.send(JSON.stringify(payload))
    })
  }

  /** 关掉当前连接，并把所有等待中的 call 全部失败掉。 */
  async close(): Promise<void> {
    this.failAll(new Error('tunmo-backend 连接已关闭'))
    /** 先摘掉 this.ws，避免 close 事件里再 failAll 一次。 */
    const socket = this.ws
    this.ws = null
    if (!socket) return
    if (socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      socket.addEventListener('close', () => resolve(), { once: true })
      socket.close()
      setTimeout(resolve, 500)
    })
  }

  /**
   * 处理服务端发来的一帧文本。
   * 有 method=conversation.event 的是推送；有 id 的是某次 call 的响应。
   */
  private handleMessage(raw: string): void {
    /** 解析后的 JSON-RPC 对象。 */
    let parsed: JsonRpcSuccess | JsonRpcError | { method?: string; params?: unknown }
    try {
      parsed = JSON.parse(raw) as JsonRpcSuccess | JsonRpcError | { method?: string; params?: unknown }
    } catch {
      log.warn('[backend-rpc] invalid json', raw.slice(0, 200))
      return
    }
    if ('method' in parsed && parsed.method === 'conversation.event') {
      this.onEvent?.(parsed.params as ConversationEventEnvelope)
      return
    }
    if (!('id' in parsed) || parsed.id == null) return
    /** 对应这次响应的等待回调。 */
    const pending = this.pending.get(Number(parsed.id))
    if (!pending) return
    this.pending.delete(Number(parsed.id))
    if ('error' in parsed && parsed.error) {
      pending.reject(new Error(parsed.error.data?.message || parsed.error.message))
      return
    }
    pending.resolve((parsed as JsonRpcSuccess).result)
  }

  /** 连接断开或主动关闭时，让所有还在等的 call 失败。 */
  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
