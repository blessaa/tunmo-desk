import { randomUUID } from "node:crypto";
import type { ConversationManager } from "../application/conversation-manager.js";
import { DomainError } from "../domain/errors.js";
import type { PublicError } from "../domain/errors.js";
import type { ConversationEventEnvelope, ImageInput, ModelSelection } from "../domain/types.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: PublicError;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface RpcConnectionContext {
  connectionId: string;
  ownerId: string;
  initialized: boolean;
  notify: (method: string, params: unknown) => boolean;
  subscriptions: Map<string, () => void>;
}

interface RecordValue {
  [key: string]: unknown;
}

function objectParams(value: unknown): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DomainError("INVALID_PARAMS");
  }
  return value as RecordValue;
}

function requiredString(params: RecordValue, field: string, maxLength = 200_000): string {
  const value = params[field];
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new DomainError("INVALID_PARAMS", { details: { field } });
  }
  return value;
}

function optionalString(params: RecordValue, field: string, maxLength = 4_096): string | undefined {
  const value = params[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new DomainError("INVALID_PARAMS", { details: { field } });
  }
  return value;
}

function conversationId(params: RecordValue): string {
  return requiredString(params, "conversationId", 128);
}

function clientRequestId(params: RecordValue): string {
  return requiredString(params, "clientRequestId", 128);
}

function parseImages(value: unknown): ImageInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10) throw new DomainError("INVALID_PARAMS", { details: { field: "images" } });
  const allowed = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  return value.map((entry) => {
    const image = objectParams(entry);
    if (image.type !== "image" || typeof image.data !== "string" || image.data.length > 8_000_000) {
      throw new DomainError("INVALID_PARAMS", { details: { field: "images" } });
    }
    if (typeof image.mimeType !== "string" || !allowed.has(image.mimeType)) {
      throw new DomainError("INVALID_PARAMS", { details: { field: "images.mimeType" } });
    }
    return { type: "image", data: image.data, mimeType: image.mimeType as ImageInput["mimeType"] };
  });
}

function parseModel(value: unknown): ModelSelection | undefined {
  if (value === undefined) return undefined;
  const model = objectParams(value);
  return {
    provider: requiredString(model, "provider", 128),
    modelId: requiredString(model, "modelId", 256),
  };
}

export function parseJsonRpcRequest(value: unknown): JsonRpcRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DomainError("INVALID_PARAMS");
  const request = value as RecordValue;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || request.method.length > 128) {
    throw new DomainError("INVALID_PARAMS");
  }
  if (request.id !== undefined && typeof request.id !== "string" && typeof request.id !== "number") {
    throw new DomainError("INVALID_PARAMS", { details: { field: "id" } });
  }
  return {
    jsonrpc: "2.0",
    ...(request.id !== undefined ? { id: request.id } : {}),
    method: request.method,
    ...(request.params !== undefined ? { params: request.params } : {}),
  };
}

export class JsonRpcDispatcher {
  private readonly conversations: ConversationManager;
  private readonly heartbeatMs: number;
  private readonly maxFrameBytes: number;

  constructor(conversations: ConversationManager, options: { heartbeatMs: number; maxFrameBytes: number }) {
    this.conversations = conversations;
    this.heartbeatMs = options.heartbeatMs;
    this.maxFrameBytes = options.maxFrameBytes;
  }

  async dispatch(connection: RpcConnectionContext, request: JsonRpcRequest): Promise<unknown> {
    if (request.method !== "session.initialize" && !connection.initialized) {
      throw new DomainError("COMMAND_CONFLICT", { details: { requiredMethod: "session.initialize" } });
    }

    switch (request.method) {
      case "session.initialize": {
        const params = objectParams(request.params);
        if (params.protocolVersion !== 1) {
          throw new DomainError("INVALID_PARAMS", { details: { field: "protocolVersion", supported: [1] } });
        }
        requiredString(params, "clientId", 128);
        if (
          params.capabilities !== undefined &&
          (typeof params.capabilities !== "object" || params.capabilities === null || Array.isArray(params.capabilities))
        ) {
          throw new DomainError("INVALID_PARAMS", { details: { field: "capabilities" } });
        }
        connection.initialized = true;
        return {
          protocolVersion: 1,
          connectionId: connection.connectionId,
          heartbeatIntervalMs: this.heartbeatMs,
          maxFrameBytes: this.maxFrameBytes,
          capabilities: { eventReplay: true, deltaBatch: false, interrupt: true, wsTicket: true },
        };
      }
      case "conversation.create": {
        const params = objectParams(request.params ?? {});
        const workingDirectory = optionalString(params, "workingDirectory");
        const model = parseModel(params.model);
        return this.conversations.create(connection.ownerId, {
          ...(workingDirectory ? { workingDirectory } : {}),
          ...(model ? { model } : {}),
        });
      }
      case "conversation.attach": {
        const params = objectParams(request.params);
        const id = conversationId(params);
        const rawAfterSeq = params.afterSeq;
        if (
          rawAfterSeq !== undefined &&
          (typeof rawAfterSeq !== "number" || !Number.isSafeInteger(rawAfterSeq) || rawAfterSeq < 0)
        ) {
          throw new DomainError("INVALID_PARAMS", { details: { field: "afterSeq" } });
        }
        connection.subscriptions.get(id)?.();
        const result = await this.conversations.attach(
          connection.ownerId,
          id,
          rawAfterSeq as number | undefined,
          (event) => connection.notify("conversation.event", event),
        );
        connection.subscriptions.set(id, result.unsubscribe);
        return {
          mode: result.mode,
          highWaterSeq: result.highWaterSeq,
          ...(result.snapshot ? { snapshot: result.snapshot } : {}),
          events: result.events,
        };
      }
      case "conversation.send": {
        const params = objectParams(request.params);
        const images = parseImages(params.images);
        return this.conversations.send(connection.ownerId, {
          conversationId: conversationId(params),
          clientRequestId: clientRequestId(params),
          message: requiredString(params, "message"),
          ...(images ? { images } : {}),
        });
      }
      case "conversation.steer":
      case "conversation.followUp": {
        const params = objectParams(request.params);
        const images = parseImages(params.images);
        const command = {
          conversationId: conversationId(params),
          runId: requiredString(params, "runId", 128),
          clientRequestId: clientRequestId(params),
          message: requiredString(params, "message"),
          ...(images ? { images } : {}),
        };
        return request.method === "conversation.steer"
          ? this.conversations.steer(connection.ownerId, command)
          : this.conversations.followUp(connection.ownerId, command);
      }
      case "conversation.interrupt": {
        const params = objectParams(request.params);
        return this.conversations.interrupt(connection.ownerId, {
          conversationId: conversationId(params),
          runId: requiredString(params, "runId", 128),
          clientRequestId: clientRequestId(params),
          reason: optionalString(params, "reason", 256) || "user_cancelled",
        });
      }
      case "conversation.getSnapshot": {
        const params = objectParams(request.params);
        return this.conversations.getSnapshot(connection.ownerId, conversationId(params));
      }
      case "conversation.close": {
        const params = objectParams(request.params);
        const id = conversationId(params);
        if (params.interruptActiveRun !== undefined && typeof params.interruptActiveRun !== "boolean") {
          throw new DomainError("INVALID_PARAMS", { details: { field: "interruptActiveRun" } });
        }
        const result = await this.conversations.close(connection.ownerId, id, params.interruptActiveRun === true);
        connection.subscriptions.get(id)?.();
        connection.subscriptions.delete(id);
        return result;
      }
      default:
        throw new MethodNotFoundError(request.method);
    }
  }
}

export class MethodNotFoundError extends Error {
  readonly method: string;
  constructor(method: string) {
    super("Method not found");
    this.name = "MethodNotFoundError";
    this.method = method;
  }
}

export function createConnectionContext(
  ownerId: string,
  notify: (method: string, params: unknown) => boolean,
  initialized = false,
): RpcConnectionContext {
  return {
    connectionId: `conn_${randomUUID()}`,
    ownerId,
    initialized,
    notify,
    subscriptions: new Map(),
  };
}

export function disposeConnection(connection: RpcConnectionContext): void {
  for (const unsubscribe of connection.subscriptions.values()) unsubscribe();
  connection.subscriptions.clear();
}

export function responseForSuccess(id: string | number | undefined, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function responseForError(id: string | number | undefined, error: unknown): JsonRpcErrorResponse {
  if (error instanceof MethodNotFoundError) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: "方法不存在" } };
  }
  if (error instanceof DomainError) {
    const code = error.publicError.code === "INVALID_PARAMS" ? -32602 : -32000;
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message: error.publicError.message, data: error.publicError },
    };
  }
  const internal = new DomainError("INTERNAL_ERROR", { retryable: true }).publicError;
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message: internal.message, data: internal } };
}

export function eventNotification(event: ConversationEventEnvelope): {
  jsonrpc: "2.0";
  method: "conversation.event";
  params: ConversationEventEnvelope;
} {
  return { jsonrpc: "2.0", method: "conversation.event", params: event };
}
