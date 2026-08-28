const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  description: "服务端或客户端生成的稳定标识。",
} as const;

const rpcIdSchema = {
  oneOf: [{ type: "string" }, { type: "number" }],
  description: "JSON-RPC 调用标识，仅用于本次请求与响应关联。",
} as const;

const imageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "data", "mimeType"],
  properties: {
    type: { type: "string", const: "image", description: "固定为 image。" },
    data: { type: "string", description: "不含 data URL 前缀的 Base64 图片内容。" },
    mimeType: {
      type: "string",
      enum: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      description: "图片 MIME 类型。",
    },
  },
} as const;

const rpcRequest = (method: string, params: object, description: string): object => ({
  type: "object",
  additionalProperties: false,
  description,
  required: ["jsonrpc", "id", "method", "params"],
  properties: {
    jsonrpc: { type: "string", const: "2.0", description: "JSON-RPC 协议版本，固定为 2.0。" },
    id: rpcIdSchema,
    method: { type: "string", const: method, description: `RPC 方法名，固定为 ${method}。` },
    params,
  },
});

const conversationAndClientParams = {
  conversationId: idSchema,
  clientRequestId: {
    ...idSchema,
    description: "客户端命令幂等键；网络重试必须复用同一个值。",
  },
} as const;

const messageParams = {
  ...conversationAndClientParams,
  message: { type: "string", minLength: 1, maxLength: 200_000, description: "发送给 Pi 的用户文本。" },
  images: { type: "array", maxItems: 10, items: imageSchema, description: "随消息发送的图片；可省略。" },
} as const;

const runTargetParams = {
  ...messageParams,
  runId: { ...idSchema, description: "目标活动 Run 标识，防止晚到命令影响下一轮。" },
} as const;

const publicErrorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message", "retryable", "traceId"],
  properties: {
    code: {
      type: "string",
      enum: [
        "INVALID_PARAMS",
        "UNAUTHORIZED",
        "CONVERSATION_NOT_FOUND",
        "RUN_ALREADY_ACTIVE",
        "RUN_NOT_ACTIVE",
        "COMMAND_CONFLICT",
        "PI_UNAVAILABLE",
        "PI_COMMAND_TIMEOUT",
        "INTERRUPT_TIMEOUT",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
      ],
      description: "稳定的业务错误码。",
    },
    message: { type: "string", description: "可安全展示给用户的中文错误信息。" },
    retryable: { type: "boolean", description: "客户端是否适合在状态校正后重试。" },
    traceId: { type: "string", description: "用于服务端日志检索的诊断标识。" },
    details: { type: "object", additionalProperties: true, description: "已脱敏的结构化错误详情；可省略。" },
  },
} as const;

const uiContentSchema = {
  oneOf: [
    {
      type: "object",
      required: ["type", "text"],
      properties: {
        type: { type: "string", const: "text", description: "文本内容块。" },
        text: { type: "string", description: "完整文本。" },
      },
    },
    {
      type: "object",
      required: ["type", "text"],
      properties: {
        type: { type: "string", const: "thinking", description: "受配置控制的思考内容块。" },
        text: { type: "string", description: "允许公开的思考文本；默认不返回。" },
      },
    },
    {
      type: "object",
      required: ["type", "mimeType"],
      properties: {
        type: { type: "string", const: "image", description: "图片内容块。" },
        mimeType: { type: "string", description: "图片 MIME 类型。" },
        data: { type: "string", description: "可选 Base64 内容。" },
      },
    },
    {
      type: "object",
      required: ["type", "id", "name", "arguments"],
      properties: {
        type: { type: "string", const: "toolCall", description: "模型产生的工具调用块。" },
        id: { type: "string", description: "Pi 工具调用标识。" },
        name: { type: "string", description: "工具名称。" },
        arguments: { description: "已脱敏的工具参数。" },
      },
    },
  ],
  description: "UI 消息内容块联合类型。",
} as const;

const uiMessageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "role", "content", "status", "createdAt"],
  properties: {
    id: { ...idSchema, description: "后端生成的 UI 消息标识。" },
    role: {
      type: "string",
      enum: ["user", "assistant", "toolResult", "system"],
      description: "消息角色。",
    },
    content: { type: "array", items: uiContentSchema, description: "按 contentIndex 排列的内容块。" },
    status: {
      type: "string",
      enum: ["streaming", "completed", "interrupted", "failed"],
      description: "消息当前状态。",
    },
    stopReason: { type: "string", description: "Pi 最终停止原因；流式期间可省略。" },
    createdAt: { type: "string", format: "date-time", description: "消息创建时间（ISO 8601）。" },
  },
} as const;

const toolExecutionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["toolCallId", "name", "input", "startedAt"],
  properties: {
    toolCallId: { ...idSchema, description: "Pi 工具调用标识。" },
    name: { type: "string", description: "工具名称。" },
    input: { description: "已脱敏的工具输入。" },
    output: { description: "截至当前的累计工具输出；进度更新时应替换而非追加。" },
    startedAt: { type: "string", format: "date-time", description: "工具开始时间。" },
  },
} as const;

const snapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "conversationId", "lastSeq", "messages", "activeTools", "queue"],
  properties: {
    schemaVersion: { type: "integer", const: 1, description: "快照结构版本。" },
    conversationId: { ...idSchema, description: "逻辑对话标识。" },
    piSessionId: { type: "string", description: "Pi Session 标识；runtime 尚未启动时省略。" },
    lastSeq: { type: "integer", minimum: 0, description: "快照已经包含的最大事件序号。" },
    activeRun: {
      type: "object",
      additionalProperties: false,
      required: ["runId", "phase", "startedAt"],
      properties: {
        runId: { ...idSchema, description: "当前活动 Run 标识。" },
        phase: {
          type: "string",
          enum: ["accepting", "running", "tool_running", "retry_wait", "compacting", "interrupting"],
          description: "面向 UI 的当前执行阶段。",
        },
        startedAt: { type: "string", format: "date-time", description: "Run 开始时间。" },
        interruptRequestedAt: { type: "string", format: "date-time", description: "用户请求中断的时间。" },
      },
      description: "存在活动 Run 时返回。",
    },
    messages: { type: "array", items: uiMessageSchema, description: "权威消息投影，包含当前流式临时消息。" },
    activeTools: {
      type: "object",
      additionalProperties: toolExecutionSchema,
      description: "以 toolCallId 为键的并行活动工具集合。",
    },
    queue: {
      type: "object",
      required: ["steering", "followUp"],
      properties: {
        steering: { type: "array", items: { type: "string" }, description: "等待注入的 steering 消息。" },
        followUp: { type: "array", items: { type: "string" }, description: "等待续跑的 follow-up 消息。" },
      },
    },
    retry: {
      type: "object",
      required: ["attempt", "maxAttempts", "nextAt"],
      properties: {
        attempt: { type: "integer", description: "当前重试次数。" },
        maxAttempts: { type: "integer", description: "最大重试次数。" },
        nextAt: { type: "string", format: "date-time", description: "预计下次尝试时间。" },
      },
    },
    compaction: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: {
          type: "string",
          enum: ["manual", "threshold", "overflow"],
          description: "上下文压缩原因。",
        },
      },
    },
  },
} as const;

const eventPayloads = [
  ["run.accepted", { clientRequestId: { type: "string", description: "原始客户端幂等键。" } }],
  ["run.started", {}],
  ["run.interrupting", { reason: { type: "string", description: "中断原因。" } }],
  ["run.interrupted", { mode: { type: "string", enum: ["cooperative", "forced"], description: "中断模式。" } }],
  ["run.failed", { error: publicErrorSchema }],
  ["run.settled", { outcome: { type: "string", enum: ["completed", "interrupted", "failed"], description: "最终结果。" } }],
  ["turn.started", { turnIndex: { type: "integer", description: "从 1 开始的回合序号。" } }],
  ["turn.completed", { turnIndex: { type: "integer", description: "已结束回合序号。" } }],
  ["message.started", { message: uiMessageSchema }],
  [
    "message.text.delta",
    {
      messageId: { type: "string", description: "目标消息标识。" },
      contentIndex: { type: "integer", description: "目标内容块索引。" },
      delta: { type: "string", description: "需要追加的文本增量。" },
    },
  ],
  [
    "message.thinking.delta",
    {
      messageId: { type: "string", description: "目标消息标识。" },
      contentIndex: { type: "integer", description: "目标内容块索引。" },
      delta: { type: "string", description: "允许公开的思考文本增量。" },
    },
  ],
  ["message.completed", { message: uiMessageSchema }],
  [
    "tool.started",
    {
      toolCallId: { type: "string", description: "工具调用标识。" },
      name: { type: "string", description: "工具名称。" },
      input: { description: "已脱敏工具输入。" },
    },
  ],
  ["tool.progress", { toolCallId: { type: "string" }, output: { description: "累计进度输出。" } }],
  [
    "tool.completed",
    {
      toolCallId: { type: "string" },
      output: { description: "最终工具输出。" },
      isError: { type: "boolean", description: "工具是否失败。" },
    },
  ],
  [
    "queue.changed",
    {
      steeringCount: { type: "integer", description: "steering 队列长度。" },
      followUpCount: { type: "integer", description: "follow-up 队列长度。" },
    },
  ],
  [
    "retry.scheduled",
    {
      attempt: { type: "integer" },
      maxAttempts: { type: "integer" },
      delayMs: { type: "integer", description: "等待毫秒数。" },
    },
  ],
  ["retry.completed", { success: { type: "boolean" }, attempt: { type: "integer" } }],
  [
    "compaction.started",
    { reason: { type: "string", enum: ["manual", "threshold", "overflow"], description: "压缩原因。" } },
  ],
  [
    "compaction.completed",
    {
      aborted: { type: "boolean", description: "压缩是否被中断。" },
      willRetry: { type: "boolean", description: "压缩后是否会自动续跑。" },
    },
  ],
] as const;

const conversationEventSchema = {
  oneOf: eventPayloads.map(([type, properties]) => ({
    type: "object",
    required: ["type", ...Object.keys(properties)],
    properties: { type: { type: "string", const: type, description: `事件类型 ${type}。` }, ...properties },
  })),
  discriminator: { propertyName: "type" },
  description: "版本化的对话业务事件。",
};

const eventEnvelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "conversationId", "seq", "occurredAt", "event"],
  properties: {
    schemaVersion: { type: "integer", const: 1, description: "事件结构版本。" },
    conversationId: { ...idSchema, description: "事件所属对话。" },
    runId: { ...idSchema, description: "事件所属 Run；非 Run 事件可省略。" },
    seq: { type: "integer", minimum: 1, description: "对话内单调递增事件序号。" },
    occurredAt: { type: "string", format: "date-time", description: "服务端提交事件的时间。" },
    event: conversationEventSchema,
  },
} as const;

const objectWith = (required: string[], properties: object): object => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

const jsonRpcSuccessResponse = (result: object, description: string): object => ({
  type: "object",
  additionalProperties: false,
  description,
  required: ["jsonrpc", "id", "result"],
  properties: {
    jsonrpc: { type: "string", const: "2.0", description: "JSON-RPC 版本，固定为 2.0。" },
    id: rpcIdSchema,
    result,
  },
});

const sessionInitializeResultSchema = objectWith(
  ["protocolVersion", "connectionId", "heartbeatIntervalMs", "maxFrameBytes", "capabilities"],
  {
    protocolVersion: { type: "integer", const: 1, description: "服务端确认的协议版本。" },
    connectionId: { ...idSchema, description: "当前 WebSocket/HTTP 调用上下文的连接标识。" },
    heartbeatIntervalMs: { type: "integer", minimum: 1, description: "WebSocket 心跳间隔，单位毫秒。" },
    maxFrameBytes: { type: "integer", minimum: 1, description: "允许的最大 WebSocket 文本帧字节数。" },
    capabilities: objectWith(["eventReplay", "deltaBatch", "interrupt", "wsTicket"], {
      eventReplay: { type: "boolean", description: "是否支持按 seq 重放事件。" },
      deltaBatch: { type: "boolean", description: "是否支持批量 delta；当前版本为 false。" },
      interrupt: { type: "boolean", description: "是否支持主动中断 Run。" },
      wsTicket: { type: "boolean", description: "是否支持 WebSocket 一次性 ticket。" },
    }),
  },
);

const conversationCreateResultSchema = objectWith(["conversationId", "snapshot"], {
  conversationId: { ...idSchema, description: "新建的逻辑对话标识。" },
  snapshot: snapshotSchema,
});

const conversationAttachResultSchema = objectWith(["mode", "highWaterSeq", "events"], {
  mode: {
    type: "string",
    enum: ["snapshot", "replay"],
    description: "恢复方式：返回完整快照或从 afterSeq 开始重放事件。",
  },
  highWaterSeq: { type: "integer", minimum: 0, description: "本次恢复读取到的事件高水位序号。" },
  snapshot: snapshotSchema,
  events: { type: "array", items: eventEnvelopeSchema, description: "mode=replay 时返回的有序事件列表。" },
});

const conversationSendResultSchema = objectWith(["accepted", "runId", "status"], {
  accepted: { type: "boolean", const: true, description: "Pi prompt 预检是否已经通过。" },
  runId: { ...idSchema, description: "本轮 Agent Run 标识。" },
  status: { type: "string", const: "running", description: "接受成功后固定为 running。" },
});

const conversationQueueResultSchema = objectWith(["accepted", "runId", "status"], {
  accepted: { type: "boolean", const: true, description: "队列命令是否已被接受。" },
  runId: { ...idSchema, description: "目标活动 Run 标识。" },
  status: { type: "string", const: "queued", description: "排队成功后固定为 queued。" },
});

const conversationInterruptResultSchema = objectWith(["accepted", "runId", "status"], {
  accepted: { type: "boolean", const: true, description: "中断请求是否已完成确认。" },
  runId: { ...idSchema, description: "被中断或已经终态的 Run 标识。" },
  status: {
    type: "string",
    enum: ["interrupted", "settled", "failed"],
    description: "Run 的中断确认结果或已有终态。",
  },
  alreadyTerminal: { type: "boolean", description: "目标 Run 在本次调用前是否已经结束。" },
});

const conversationCloseResultSchema = objectWith(["closed"], {
  closed: { type: "boolean", const: true, description: "逻辑对话及其 Pi runtime 是否已释放。" },
});

export const openApiComponents = {
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "静态服务令牌",
      description: "AUTH_TOKEN 已配置时必填；WebSocket 浏览器客户端可先换取一次性 ticket。",
    },
  },
  schemas: {
    PublicError: publicErrorSchema,
    ImageInput: imageSchema,
    UiContent: uiContentSchema,
    UiMessage: uiMessageSchema,
    UiToolExecution: toolExecutionSchema,
    ConversationSnapshot: snapshotSchema,
    ConversationEvent: conversationEventSchema,
    ConversationEventEnvelope: eventEnvelopeSchema,
    JsonRpcErrorResponse: {
      type: "object",
      required: ["jsonrpc", "id", "error"],
      properties: {
        jsonrpc: { type: "string", const: "2.0", description: "JSON-RPC 版本。" },
        id: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
          description: "对应请求 id；无法解析时为 null。",
        },
        error: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "integer", description: "JSON-RPC 标准或服务端保留错误码。" },
            message: { type: "string", description: "中文错误摘要。" },
            data: publicErrorSchema,
          },
        },
      },
    },
    JsonRpcSuccessResponse: {
      type: "object",
      required: ["jsonrpc", "id", "result"],
      properties: {
        jsonrpc: { type: "string", const: "2.0", description: "JSON-RPC 版本。" },
        id: rpcIdSchema,
        result: { description: "由 method 决定的成功结果模型。" },
      },
    },
    SessionInitializeSuccessResponse: jsonRpcSuccessResponse(
      sessionInitializeResultSchema,
      "session.initialize 成功响应。",
    ),
    ConversationCreateSuccessResponse: jsonRpcSuccessResponse(
      conversationCreateResultSchema,
      "conversation.create 成功响应。",
    ),
    ConversationAttachSuccessResponse: jsonRpcSuccessResponse(
      conversationAttachResultSchema,
      "conversation.attach 成功响应。",
    ),
    ConversationSendSuccessResponse: jsonRpcSuccessResponse(
      conversationSendResultSchema,
      "conversation.send 成功响应；仅表示请求已被接受。",
    ),
    ConversationSteerSuccessResponse: jsonRpcSuccessResponse(
      conversationQueueResultSchema,
      "conversation.steer 成功响应。",
    ),
    ConversationFollowUpSuccessResponse: jsonRpcSuccessResponse(
      conversationQueueResultSchema,
      "conversation.followUp 成功响应。",
    ),
    ConversationInterruptSuccessResponse: jsonRpcSuccessResponse(
      conversationInterruptResultSchema,
      "conversation.interrupt 成功响应。",
    ),
    ConversationGetSnapshotSuccessResponse: jsonRpcSuccessResponse(
      snapshotSchema,
      "conversation.getSnapshot 成功响应。",
    ),
    ConversationCloseSuccessResponse: jsonRpcSuccessResponse(
      conversationCloseResultSchema,
      "conversation.close 成功响应。",
    ),
    ConversationEventNotification: {
      type: "object",
      additionalProperties: false,
      description: "服务端通过 WebSocket 推送的对话事件 notification；notification 没有 id。",
      required: ["jsonrpc", "method", "params"],
      properties: {
        jsonrpc: { type: "string", const: "2.0", description: "JSON-RPC 版本，固定为 2.0。" },
        method: { type: "string", const: "conversation.event", description: "事件通知方法名。" },
        params: eventEnvelopeSchema,
      },
    },
    ResyncRequiredNotification: {
      type: "object",
      additionalProperties: false,
      description: "客户端消费过慢时发送的重同步通知；收到后应重新获取 snapshot。",
      required: ["jsonrpc", "method", "params"],
      properties: {
        jsonrpc: { type: "string", const: "2.0", description: "JSON-RPC 版本，固定为 2.0。" },
        method: { type: "string", const: "resync.required", description: "重同步通知方法名。" },
        params: objectWith(["reason", "message"], {
          reason: { type: "string", const: "slow_client", description: "触发重同步的原因。" },
          message: { type: "string", description: "面向客户端开发者的中文处理提示。" },
        }),
      },
    },
    SessionInitializeRequest: rpcRequest(
      "session.initialize",
      objectWith(
        ["protocolVersion", "clientId"],
        {
          protocolVersion: { type: "integer", const: 1, description: "客户端请求的协议版本。" },
          clientId: { type: "string", description: "客户端安装或标签标识，用于诊断。" },
          capabilities: { type: "object", additionalProperties: { type: "boolean" }, description: "客户端能力声明。" },
        },
      ),
      "初始化单次 WebSocket 连接；其他 WS 方法之前必须先调用。",
    ),
    ConversationCreateRequest: rpcRequest(
      "conversation.create",
      objectWith([], {
        workingDirectory: { type: "string", description: "Pi 工作目录，必须位于 PI_CWD_ROOT 内。" },
        model: objectWith(["provider", "modelId"], {
          provider: { type: "string", description: "模型提供方标识。" },
          modelId: { type: "string", description: "模型标识。" },
        }),
      }),
      "创建逻辑对话；Pi 子进程在第一次 send 时延迟启动。",
    ),
    ConversationAttachRequest: rpcRequest(
      "conversation.attach",
      objectWith(["conversationId"], {
        conversationId: idSchema,
        afterSeq: { type: "integer", minimum: 0, description: "客户端最后已应用的事件 seq；省略时返回完整快照。" },
      }),
      "订阅对话，并按 afterSeq 返回 replay 或完整快照。",
    ),
    ConversationSendRequest: rpcRequest(
      "conversation.send",
      objectWith(["conversationId", "clientRequestId", "message"], messageParams),
      "发送新用户消息。成功仅表示 Pi prompt 预检已通过。",
    ),
    ConversationSteerRequest: rpcRequest(
      "conversation.steer",
      objectWith(["conversationId", "runId", "clientRequestId", "message"], runTargetParams),
      "在活动 Run 的安全边界注入 steering 消息，不执行硬中断。",
    ),
    ConversationFollowUpRequest: rpcRequest(
      "conversation.followUp",
      objectWith(["conversationId", "runId", "clientRequestId", "message"], runTargetParams),
      "在当前 Agent 准备停止时排入 follow-up 消息。",
    ),
    ConversationInterruptRequest: rpcRequest(
      "conversation.interrupt",
      objectWith(["conversationId", "runId", "clientRequestId"], {
        ...conversationAndClientParams,
        runId: idSchema,
        reason: { type: "string", maxLength: 256, description: "中断原因；默认 user_cancelled。" },
      }),
      "中断指定活动 Run。重复 clientRequestId 返回第一次结果。",
    ),
    ConversationGetSnapshotRequest: rpcRequest(
      "conversation.getSnapshot",
      objectWith(["conversationId"], { conversationId: idSchema }),
      "获取当前权威对话投影。",
    ),
    ConversationCloseRequest: rpcRequest(
      "conversation.close",
      objectWith(["conversationId"], {
        conversationId: idSchema,
        interruptActiveRun: { type: "boolean", description: "是否显式中断活动 Run 后再关闭。" },
      }),
      "关闭逻辑对话并释放 Pi runtime；WebSocket 断开不会隐式调用此方法。",
    ),
  },
} as const;

export const jsonRpcHttpBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["jsonrpc", "id", "method", "params"],
  properties: {
    jsonrpc: { type: "string", const: "2.0", description: "JSON-RPC 协议版本，固定为 2.0。" },
    id: rpcIdSchema,
    method: {
      type: "string",
      enum: [
        "session.initialize",
        "conversation.create",
        "conversation.attach",
        "conversation.send",
        "conversation.steer",
        "conversation.followUp",
        "conversation.interrupt",
        "conversation.getSnapshot",
        "conversation.close",
      ],
      description: "RPC 方法名。各方法的 params 详见下方请求模型。",
    },
    params: { type: "object", additionalProperties: true, description: "方法参数；字段结构详见对应请求模型。" },
  },
  "x-examples": {
    "01-session.initialize": {
      summary: "初始化连接",
      description: "WebSocket 建连后的第一个方法；HTTP Swagger 调用也可用于查看协商结果。",
      value: {
        jsonrpc: "2.0",
        id: "rpc-init-1",
        method: "session.initialize",
        params: {
          protocolVersion: 1,
          clientId: "swagger-ui",
          capabilities: { eventReplay: true, deltaBatch: false },
        },
      },
    },
    "02-conversation.create": {
      summary: "创建对话",
      description: "使用服务端默认工作目录和默认模型创建逻辑对话。保存响应中的 conversationId。",
      value: { jsonrpc: "2.0", id: "rpc-create-1", method: "conversation.create", params: {} },
    },
    "03-conversation.attach": {
      summary: "订阅或恢复对话",
      description: "将 conversationId 替换为 create 的返回值。HTTP 只返回快照/重放结果；实时订阅请使用 WebSocket。",
      value: {
        jsonrpc: "2.0",
        id: "rpc-attach-1",
        method: "conversation.attach",
        params: { conversationId: "conv_请替换", afterSeq: 0 },
      },
    },
    "04-conversation.send": {
      summary: "发送用户消息",
      description: "启动新的 Agent Run。保存响应中的 runId，后续 steer/followUp/interrupt 需要使用。",
      value: {
        jsonrpc: "2.0",
        id: "rpc-send-1",
        method: "conversation.send",
        params: {
          conversationId: "conv_请替换",
          clientRequestId: "client_req_send_001",
          message: "分析当前项目并给出修改建议",
          images: [],
        },
      },
    },
    "05-conversation.steer": {
      summary: "向活动 Run 注入指令",
      description: "不会硬中断 Run；在安全边界把新指令交给 Pi。",
      value: {
        jsonrpc: "2.0",
        id: "rpc-steer-1",
        method: "conversation.steer",
        params: {
          conversationId: "conv_请替换",
          runId: "run_请替换",
          clientRequestId: "client_req_steer_001",
          message: "停止修改代码，只总结目前发现",
          images: [],
        },
      },
    },
    "06-conversation.followUp": {
      summary: "排入后续消息",
      description: "当前 Agent 原本准备停止时继续处理这条消息。",
      value: {
        jsonrpc: "2.0",
        id: "rpc-follow-up-1",
        method: "conversation.followUp",
        params: {
          conversationId: "conv_请替换",
          runId: "run_请替换",
          clientRequestId: "client_req_follow_up_001",
          message: "完成后再补充一份测试建议",
          images: [],
        },
      },
    },
    "07-conversation.interrupt": {
      summary: "中断活动 Run",
      description: "等待 Pi abort 得到确认后才返回成功响应。",
      value: {
        jsonrpc: "2.0",
        id: "rpc-interrupt-1",
        method: "conversation.interrupt",
        params: {
          conversationId: "conv_请替换",
          runId: "run_请替换",
          clientRequestId: "client_req_interrupt_001",
          reason: "user_cancelled",
        },
      },
    },
    "08-conversation.getSnapshot": {
      summary: "获取权威快照",
      description: "用于页面刷新、断线恢复和客户端状态校正。",
      value: {
        jsonrpc: "2.0",
        id: "rpc-snapshot-1",
        method: "conversation.getSnapshot",
        params: { conversationId: "conv_请替换" },
      },
    },
    "09-conversation.close": {
      summary: "关闭对话",
      description: "释放逻辑对话和 Pi runtime；存在活动 Run 时需显式设置 interruptActiveRun=true。",
      value: {
        jsonrpc: "2.0",
        id: "rpc-close-1",
        method: "conversation.close",
        params: { conversationId: "conv_请替换", interruptActiveRun: false },
      },
    },
  },
} as const;

export const jsonRpcDocumentationBodySchema = {
  description:
    "根据 method 选择对应请求模型。每个模型都会列出 params 的必填字段、可选字段、数据类型和中文说明。",
  oneOf: [
    { $ref: "#/components/schemas/SessionInitializeRequest" },
    { $ref: "#/components/schemas/ConversationCreateRequest" },
    { $ref: "#/components/schemas/ConversationAttachRequest" },
    { $ref: "#/components/schemas/ConversationSendRequest" },
    { $ref: "#/components/schemas/ConversationSteerRequest" },
    { $ref: "#/components/schemas/ConversationFollowUpRequest" },
    { $ref: "#/components/schemas/ConversationInterruptRequest" },
    { $ref: "#/components/schemas/ConversationGetSnapshotRequest" },
    { $ref: "#/components/schemas/ConversationCloseRequest" },
  ],
  discriminator: {
    propertyName: "method",
    mapping: {
      "session.initialize": "#/components/schemas/SessionInitializeRequest",
      "conversation.create": "#/components/schemas/ConversationCreateRequest",
      "conversation.attach": "#/components/schemas/ConversationAttachRequest",
      "conversation.send": "#/components/schemas/ConversationSendRequest",
      "conversation.steer": "#/components/schemas/ConversationSteerRequest",
      "conversation.followUp": "#/components/schemas/ConversationFollowUpRequest",
      "conversation.interrupt": "#/components/schemas/ConversationInterruptRequest",
      "conversation.getSnapshot": "#/components/schemas/ConversationGetSnapshotRequest",
      "conversation.close": "#/components/schemas/ConversationCloseRequest",
    },
  },
};

export const jsonRpcResponseSchema = {
  description: "九种 RPC 成功响应之一，或统一 JSON-RPC 错误响应。",
  oneOf: [
    openApiComponents.schemas.SessionInitializeSuccessResponse,
    openApiComponents.schemas.ConversationCreateSuccessResponse,
    openApiComponents.schemas.ConversationAttachSuccessResponse,
    openApiComponents.schemas.ConversationSendSuccessResponse,
    openApiComponents.schemas.ConversationSteerSuccessResponse,
    openApiComponents.schemas.ConversationFollowUpSuccessResponse,
    openApiComponents.schemas.ConversationInterruptSuccessResponse,
    openApiComponents.schemas.ConversationGetSnapshotSuccessResponse,
    openApiComponents.schemas.ConversationCloseSuccessResponse,
    openApiComponents.schemas.JsonRpcErrorResponse,
  ],
  "x-examples": {
    "01-session.initialize 成功": {
      summary: "初始化连接成功",
      value: {
        jsonrpc: "2.0",
        id: "rpc-init-1",
        result: {
          protocolVersion: 1,
          connectionId: "conn_0f4b27a5",
          heartbeatIntervalMs: 15000,
          maxFrameBytes: 1048576,
          capabilities: { eventReplay: true, deltaBatch: false, interrupt: true, wsTicket: true },
        },
      },
    },
    "02-conversation.create 成功": {
      summary: "创建对话成功",
      value: {
        jsonrpc: "2.0",
        id: "rpc-create-1",
        result: {
          conversationId: "conv_123",
          snapshot: {
            schemaVersion: 1,
            conversationId: "conv_123",
            lastSeq: 0,
            messages: [],
            activeTools: {},
            queue: { steering: [], followUp: [] },
          },
        },
      },
    },
    "03-conversation.attach 成功": {
      summary: "恢复对话成功",
      value: {
        jsonrpc: "2.0",
        id: "rpc-attach-1",
        result: {
          mode: "snapshot",
          highWaterSeq: 0,
          snapshot: {
            schemaVersion: 1,
            conversationId: "conv_123",
            lastSeq: 0,
            messages: [],
            activeTools: {},
            queue: { steering: [], followUp: [] },
          },
          events: [],
        },
      },
    },
    "04-conversation.send 成功": {
      summary: "发送消息已接受",
      value: {
        jsonrpc: "2.0",
        id: "rpc-send-1",
        result: { accepted: true, runId: "run_789", status: "running" },
      },
    },
    "05-conversation.steer 成功": {
      summary: "Steering 已排队",
      value: {
        jsonrpc: "2.0",
        id: "rpc-steer-1",
        result: { accepted: true, runId: "run_789", status: "queued" },
      },
    },
    "06-conversation.followUp 成功": {
      summary: "Follow-up 已排队",
      value: {
        jsonrpc: "2.0",
        id: "rpc-follow-up-1",
        result: { accepted: true, runId: "run_789", status: "queued" },
      },
    },
    "07-conversation.interrupt 成功": {
      summary: "中断已确认",
      value: {
        jsonrpc: "2.0",
        id: "rpc-interrupt-1",
        result: { accepted: true, runId: "run_789", status: "interrupted" },
      },
    },
    "08-conversation.getSnapshot 成功": {
      summary: "获取快照成功",
      value: {
        jsonrpc: "2.0",
        id: "rpc-snapshot-1",
        result: {
          schemaVersion: 1,
          conversationId: "conv_123",
          lastSeq: 12,
          messages: [],
          activeTools: {},
          queue: { steering: [], followUp: [] },
        },
      },
    },
    "09-conversation.close 成功": {
      summary: "关闭对话成功",
      value: { jsonrpc: "2.0", id: "rpc-close-1", result: { closed: true } },
    },
    "10-参数错误": {
      summary: "请求参数不合法",
      value: {
        jsonrpc: "2.0",
        id: "rpc-error-1",
        error: {
          code: -32602,
          message: "请求参数不合法",
          data: {
            code: "INVALID_PARAMS",
            message: "请求参数不合法",
            retryable: false,
            traceId: "trace_123",
            details: { field: "conversationId" },
          },
        },
      },
    },
    "11-对话不存在": {
      summary: "conversationId 不存在或不属于当前用户",
      value: {
        jsonrpc: "2.0",
        id: "rpc-error-2",
        error: {
          code: -32004,
          message: "对话不存在",
          data: {
            code: "CONVERSATION_NOT_FOUND",
            message: "对话不存在",
            retryable: false,
            traceId: "trace_456",
          },
        },
      },
    },
  },
} as const;
