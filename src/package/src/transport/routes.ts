import type { FastifyInstance, FastifyRequest } from "fastify";
import type WebSocket from "ws";
import type { AppConfig } from "../config.js";
import { DomainError } from "../domain/errors.js";
import type { JsonRpcDispatcher, RpcConnectionContext } from "./rpc-dispatcher.js";
import {
  createConnectionContext,
  disposeConnection,
  parseJsonRpcRequest,
  responseForError,
  responseForSuccess,
} from "./rpc-dispatcher.js";
import { authenticateHttp, authenticateWebSocket, WebSocketTicketStore } from "./auth.js";
import { jsonRpcHttpBodySchema, jsonRpcResponseSchema } from "./openapi.js";
import { SocketWriter } from "./socket-writer.js";

interface TicketRequestBody {
  clientId?: string;
}

class ConnectionRateLimiter {
  private readonly maxPerMinute: number;
  private windowStartedAt = Date.now();
  private count = 0;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  allow(method: string): boolean {
    if (method === "conversation.interrupt") return true;
    const now = Date.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.maxPerMinute;
  }
}

function originAllowed(request: FastifyRequest, allowedOrigins: string[]): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

function closeUnauthorized(socket: WebSocket): void {
  socket.close(1008, "unauthorized");
}

export async function registerRoutes(
  fastify: FastifyInstance,
  dispatcher: JsonRpcDispatcher,
  config: AppConfig,
): Promise<void> {
  const tickets = new WebSocketTicketStore(config.wsTicketTtlMs);
  const authOptions = {
    ...(config.authToken ? { token: config.authToken } : {}),
    ownerId: config.authOwnerId,
  };

  fastify.get(
    "/health",
    {
      schema: {
        tags: ["服务状态"],
        summary: "存活检查",
        description: "仅确认 Fastify 进程能够响应，不启动或探测 Pi 子进程。",
        response: {
          200: {
            type: "object",
            required: ["status", "service", "time"],
            properties: {
              status: { type: "string", const: "ok", description: "固定为 ok。" },
              service: { type: "string", description: "服务名称。" },
              time: { type: "string", format: "date-time", description: "服务端当前时间。" },
            },
          },
        },
      },
    },
    async () => ({ status: "ok", service: "tunmo-backend", time: new Date().toISOString() }),
  );

  fastify.get(
    "/ready",
    {
      schema: {
        tags: ["服务状态"],
        summary: "就绪检查",
        description: "确认配置和路由已经加载。Pi runtime 按对话延迟启动，因此不在此检查模型凭证。",
        response: {
          200: {
            type: "object",
            required: ["ready"],
            properties: { ready: { type: "boolean", description: "服务是否可接收请求。" } },
          },
        },
      },
    },
    async () => ({ ready: true }),
  );

  fastify.post<{ Body: TicketRequestBody }>(
    "/api/v1/agent/ws-ticket",
    {
      schema: {
        tags: ["身份认证"],
        summary: "签发 WebSocket 一次性 ticket",
        description: "浏览器无法在 WebSocket 握手中设置 Authorization 时调用。ticket 短时有效且首次校验后立即失效。",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            clientId: { type: "string", maxLength: 128, description: "可选客户端标识，仅用于调用方关联。" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["ticket", "expiresAt", "webSocketUrl", "subprotocol"],
            properties: {
              ticket: { type: "string", description: "一次性随机 ticket。" },
              expiresAt: { type: "string", format: "date-time", description: "ticket 失效时间。" },
              webSocketUrl: { type: "string", description: "WebSocket 相对路径；将 ticket 作为查询参数附加。" },
              subprotocol: { type: "string", description: "握手必须声明的子协议。" },
            },
          },
        },
      },
    },
    async (request) => {
      const ownerId = authenticateHttp(request, authOptions);
      return {
        ...tickets.issue(ownerId),
        webSocketUrl: "/api/v1/agent/ws",
        subprotocol: "tunmo.agent.v1",
      };
    },
  );

  fastify.post(
    "/api/v1/agent/rpc",
    {
      schema: {
        tags: ["对话 JSON-RPC"],
        summary: "Swagger/HTTP JSON-RPC 测试入口",
        description:
          "与 WebSocket 完全复用同一调度器。请在请求模型的 oneOf 中按 method 查看对应 params：Swagger 会展示必填字段、可选字段、类型和中文说明。HTTP 调用是无订阅的短连接，适合测试 create/send/interrupt/getSnapshot；实时事件请使用 WebSocket 并先调用 session.initialize 与 conversation.attach。",
        security: [{ bearerAuth: [] }],
        body: jsonRpcHttpBodySchema,
        response: {
          200: {
            ...jsonRpcResponseSchema,
          },
        },
      },
    },
    async (request) => {
      const ownerId = authenticateHttp(request, authOptions);
      const connection = createConnectionContext(ownerId, () => true, true);
      let rpcId: string | number | undefined;
      try {
        const rpc = parseJsonRpcRequest(request.body);
        rpcId = rpc.id;
        request.log.info(
          { connectionId: connection.connectionId, userId: ownerId, rpcId: rpc.id, rpcMethod: rpc.method },
          "开始处理 HTTP JSON-RPC",
        );
        const result = await dispatcher.dispatch(connection, rpc);
        return responseForSuccess(rpc.id, result);
      } catch (error) {
        return responseForError(rpcId, error);
      } finally {
        disposeConnection(connection);
      }
    },
  );

  fastify.get(
    "/api/v1/agent/ws-info",
    {
      schema: {
        tags: ["对话 JSON-RPC"],
        summary: "WebSocket 协议说明",
        description:
          "生产事件流入口是 GET /api/v1/agent/ws。握手需声明 Sec-WebSocket-Protocol: tunmo.agent.v1，并使用 Authorization Bearer 或短时 ticket。连接后先调用 session.initialize。",
        response: {
          200: {
            type: "object",
            required: ["path", "subprotocol", "firstMethod", "eventMethod"],
            properties: {
              path: { type: "string", description: "WebSocket 路径。" },
              subprotocol: { type: "string", description: "要求的 WebSocket 子协议。" },
              firstMethod: { type: "string", description: "连接后的首个 RPC 方法。" },
              eventMethod: { type: "string", description: "服务端事件 notification 方法。" },
            },
          },
        },
      },
    },
    async () => ({
      path: "/api/v1/agent/ws",
      subprotocol: "tunmo.agent.v1",
      firstMethod: "session.initialize",
      eventMethod: "conversation.event",
    }),
  );

  fastify.get(
    "/api/v1/agent/ws",
    { websocket: true, schema: { hide: true } },
    (socket: WebSocket, request: FastifyRequest) => {
      let ownerId: string;
      try {
        if (socket.protocol !== "tunmo.agent.v1" || !originAllowed(request, config.allowedOrigins)) {
          closeUnauthorized(socket);
          return;
        }
        ownerId = authenticateWebSocket(request, authOptions, tickets);
      } catch {
        closeUnauthorized(socket);
        return;
      }

      const writer = new SocketWriter(socket, config.maxWsBufferedBytes);
      const connection = createConnectionContext(ownerId, (method, params) => writer.notify(method, params));
      const limiter = new ConnectionRateLimiter(config.maxRpcPerMinute);
      let concurrentRequests = 0;
      let alive = true;

      socket.on("pong", () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, config.wsHeartbeatMs);
      heartbeat.unref();

      socket.on("message", (frame, isBinary) => {
        void handleWebSocketFrame(
          socket,
          writer,
          connection,
          dispatcher,
          limiter,
          frame,
          isBinary,
          config.maxFrameBytes,
          () => concurrentRequests,
          (value) => {
            concurrentRequests = value;
          },
          (entry) => fastify.log.info(entry, "处理 WebSocket JSON-RPC"),
        );
      });
      socket.once("close", () => {
        clearInterval(heartbeat);
        disposeConnection(connection);
      });
      socket.once("error", () => {
        clearInterval(heartbeat);
        disposeConnection(connection);
      });
    },
  );
}

async function handleWebSocketFrame(
  socket: WebSocket,
  writer: SocketWriter,
  connection: RpcConnectionContext,
  dispatcher: JsonRpcDispatcher,
  limiter: ConnectionRateLimiter,
  frame: Buffer | ArrayBuffer | Buffer[],
  isBinary: boolean,
  maxFrameBytes: number,
  getConcurrent: () => number,
  setConcurrent: (value: number) => void,
  logRpc: (entry: {
    connectionId: string;
    userId: string;
    rpcId?: string | number;
    rpcMethod: string;
    durationMs: number;
  }) => void,
): Promise<void> {
  if (isBinary) {
    socket.close(1003, "text frames only");
    return;
  }
  const buffer = Array.isArray(frame)
    ? Buffer.concat(frame)
    : Buffer.isBuffer(frame)
      ? frame
      : Buffer.from(new Uint8Array(frame));
  if (buffer.byteLength > maxFrameBytes) {
    socket.close(1009, "frame too large");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    writer.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON 解析失败" } });
    return;
  }

  let rpcId: string | number | undefined;
  try {
    const rpc = parseJsonRpcRequest(parsed);
    rpcId = rpc.id;
    if (!limiter.allow(rpc.method)) throw new DomainError("RATE_LIMITED", { retryable: true });
    if (getConcurrent() >= 8) throw new DomainError("RATE_LIMITED", { retryable: true });
    setConcurrent(getConcurrent() + 1);
    const startedAt = performance.now();
    try {
      const result = await dispatcher.dispatch(connection, rpc);
      if (rpc.id !== undefined) writer.send(responseForSuccess(rpc.id, result));
    } finally {
      logRpc({
        connectionId: connection.connectionId,
        userId: connection.ownerId,
        ...(rpc.id !== undefined ? { rpcId: rpc.id } : {}),
        rpcMethod: rpc.method,
        durationMs: Math.round(performance.now() - startedAt),
      });
      setConcurrent(getConcurrent() - 1);
    }
  } catch (error) {
    writer.send(responseForError(rpcId, error));
  }
}
