import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import websocket from "@fastify/websocket";
import type { AppConfig } from "./config.js";
import { ConversationManager } from "./application/conversation-manager.js";
import { DomainError, publicErrorFrom } from "./domain/errors.js";
import { ChildProcessPiAdapter } from "./infrastructure/pi/child-process-pi-adapter.js";
import { withPiConcurrencyLimit } from "./infrastructure/pi/concurrency-limited-pi-adapter.js";
import type { PiRuntimeFactory } from "./infrastructure/pi/pi-runtime.js";
import { JsonRpcDispatcher } from "./transport/rpc-dispatcher.js";
import { registerRoutes } from "./transport/routes.js";

export interface BuildAppOptions {
  config: AppConfig;
  runtimeFactory?: PiRuntimeFactory;
  logger?: boolean;
  /** 桌面端内嵌时不挂 Swagger，避免把文档静态资源打进安装包。 */
  skipDocs?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: options.logger === false ? false : { level: options.config.logLevel },
    bodyLimit: options.config.maxFrameBytes,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    ajv: {
      plugins: [
        (ajv) => {
          ajv.addKeyword({ keyword: "x-examples" });
          return ajv;
        },
      ],
    },
  });

  fastify.setErrorHandler((error, request, reply) => {
    const validation = typeof error === "object" && error !== null && "validation" in error && error.validation;
    const publicError = validation
      ? publicErrorFrom(new DomainError("INVALID_PARAMS", { traceId: request.id }))
      : publicErrorFrom(error);
    const statusCode =
      publicError.code === "UNAUTHORIZED"
        ? 401
        : publicError.code === "CONVERSATION_NOT_FOUND"
          ? 404
          : publicError.code === "RATE_LIMITED"
            ? 429
            : publicError.code === "INVALID_PARAMS"
              ? 400
              : 500;
    if (statusCode >= 500) request.log.error({ err: error, traceId: publicError.traceId }, "请求处理失败");
    void reply.code(statusCode).send({ error: publicError });
  });

  if (!options.skipDocs) {
    const [{ default: swagger }, { default: swaggerUi }, { jsonRpcDocumentationBodySchema, openApiComponents }] =
      await Promise.all([
        import("@fastify/swagger"),
        import("@fastify/swagger-ui"),
        import("./transport/openapi.js"),
      ]);
    await fastify.register(swagger, {
      openapi: {
        info: {
          title: "Tunmo 对话后端接口文档",
          description:
            "基于 Fastify、WebSocket JSON-RPC 与 Pi RPC 的对话服务。所有说明、请求字段和响应模型均以中文描述。HTTP RPC 用于 Swagger 调试；实时增量通过 WebSocket notification 推送。",
          version: "1.0.0",
        },
        tags: [
          { name: "服务状态", description: "服务存活与就绪检查。" },
          { name: "身份认证", description: "WebSocket 短时一次性 ticket。" },
          { name: "对话 JSON-RPC", description: "对话命令、查询与 WebSocket 协议信息。" },
        ],
        components: openApiComponents as never,
      },
      transformObject: (documentObject) => {
        if ("swaggerObject" in documentObject) return documentObject.swaggerObject;
        const document = documentObject.openapiObject;
        const operation = document.paths?.["/api/v1/agent/rpc"]?.post;
        if (!operation || "$ref" in operation) return document;
        const requestBody = operation.requestBody;
        if (!requestBody || "$ref" in requestBody) return document;
        const mediaType = requestBody.content["application/json"];
        if (mediaType) mediaType.schema = jsonRpcDocumentationBodySchema;
        return document;
      },
    });
    await fastify.register(swaggerUi, {
      routePrefix: "/documentation",
      uiConfig: {
        docExpansion: "list",
        deepLinking: true,
        displayRequestDuration: true,
        persistAuthorization: true,
      },
      staticCSP: true,
      transformStaticCSP: (header) => header.replace(/\s*upgrade-insecure-requests;?/gu, ""),
    });
    fastify.get(
      "/api/v1/openapi.json",
      {
        schema: {
          hide: true,
        },
      },
      async () => fastify.swagger(),
    );
  }

  await fastify.register(websocket, {
    options: {
      maxPayload: options.config.maxFrameBytes,
      handleProtocols: (protocols: Set<string>) => (protocols.has("tunmo.agent.v1") ? "tunmo.agent.v1" : false),
    },
  });

  const baseRuntimeFactory: PiRuntimeFactory =
    options.runtimeFactory ??
    ((runtimeOptions) =>
      new ChildProcessPiAdapter({
        command: options.config.pi.command,
        args: options.config.pi.args,
        cwd: runtimeOptions.cwd,
        ...(options.config.pi.sessionDir ? { sessionDir: options.config.pi.sessionDir } : {}),
        ...(runtimeOptions.model ? { model: runtimeOptions.model } : {}),
        ...(options.config.pi.provider ? { defaultProvider: options.config.pi.provider } : {}),
        ...(options.config.pi.model ? { defaultModel: options.config.pi.model } : {}),
        startTimeoutMs: options.config.pi.startTimeoutMs,
        commandTimeoutMs: options.config.pi.commandTimeoutMs,
        stopGraceMs: options.config.pi.stopGraceMs,
        onDiagnostic: (entry) => fastify.log[entry.level]({ component: "pi-runtime" }, entry.message),
      }));
  const runtimeFactory = withPiConcurrencyLimit(baseRuntimeFactory, options.config.maxActivePiProcesses);

  const conversations = new ConversationManager({
    cwdRoot: options.config.pi.cwdRoot,
    defaultCwd: options.config.pi.defaultCwd,
    replayCapacity: options.config.replayCapacity,
    interruptTimeoutMs: options.config.pi.interruptTimeoutMs,
    idleTtlMs: options.config.conversationIdleTtlMs,
    exposeThinking: options.config.exposeThinking,
    runtimeFactory,
    onDiagnostic: (entry) => fastify.log.warn(entry, entry.message),
  });
  const dispatcher = new JsonRpcDispatcher(conversations, {
    heartbeatMs: options.config.wsHeartbeatMs,
    maxFrameBytes: options.config.maxFrameBytes,
  });

  await registerRoutes(fastify, dispatcher, options.config);

  fastify.addHook("onClose", async () => conversations.closeAll());
  await fastify.ready();
  return fastify;
}
