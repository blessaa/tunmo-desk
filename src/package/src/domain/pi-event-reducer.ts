import { randomUUID } from "node:crypto";
import { DomainError } from "./errors.js";
import { redactForClient } from "./redaction.js";
import type {
  ActiveRunSnapshot,
  ConversationEvent,
  ConversationSnapshot,
  UiContent,
  UiMessage,
  UiToolExecution,
} from "./types.js";
import type { PiRuntimeEvent } from "../infrastructure/pi/pi-runtime.js";

interface MessageBuilder {
  messageId: string;
  content: UiContent[];
}

export interface ReducerResult {
  events: ConversationEvent[];
  settled?: "completed" | "interrupted" | "failed";
  failure?: DomainError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function timestamp(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function contentFromPi(value: unknown, exposeThinking: boolean): UiContent[] {
  const entries = typeof value === "string" ? [{ type: "text", text: value }] : Array.isArray(value) ? value : [];
  const result: UiContent[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.type !== "string") continue;
    if (entry.type === "text" && typeof entry.text === "string") {
      result.push({ type: "text", text: entry.text });
    } else if (entry.type === "thinking" && exposeThinking && typeof entry.thinking === "string") {
      result.push({ type: "thinking", text: entry.thinking });
    } else if (entry.type === "image" && typeof entry.mimeType === "string") {
      result.push({
        type: "image",
        mimeType: entry.mimeType,
        ...(typeof entry.data === "string" ? { data: entry.data } : {}),
      });
    } else if (entry.type === "toolCall") {
      result.push({
        type: "toolCall",
        id: stringField(entry.id, `tool_${randomUUID()}`),
        name: stringField(entry.name, "unknown"),
        arguments: redactForClient(entry.arguments),
      });
    }
  }
  return result;
}

function messageFromPi(value: unknown, messageId: string, exposeThinking: boolean): UiMessage {
  const message = isRecord(value) ? value : {};
  const roleValue = message.role;
  const role =
    roleValue === "user" || roleValue === "assistant" || roleValue === "toolResult" || roleValue === "system"
      ? roleValue
      : "assistant";
  const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
  return {
    id: messageId,
    role,
    content: contentFromPi(message.content, exposeThinking),
    status: stopReason === "aborted" ? "interrupted" : stopReason === "error" ? "failed" : "completed",
    ...(stopReason ? { stopReason } : {}),
    createdAt: timestamp(message.timestamp),
  };
}

function ensureBlock(builder: MessageBuilder, index: number, type: "text" | "thinking"): UiContent {
  while (builder.content.length <= index) builder.content.push({ type: "text", text: "" });
  const current = builder.content[index];
  if (current?.type === type) return current;
  const block: UiContent = { type, text: "" };
  builder.content[index] = block;
  return block;
}

export class PiEventReducer {
  private readonly snapshot: ConversationSnapshot;
  private readonly exposeThinking: boolean;
  private builder: MessageBuilder | undefined;
  private turnIndex = 0;
  private runFailure: DomainError | undefined;

  constructor(snapshot: ConversationSnapshot, exposeThinking: boolean) {
    this.snapshot = snapshot;
    this.exposeThinking = exposeThinking;
  }

  resetForRun(): void {
    this.builder = undefined;
    this.turnIndex = 0;
    this.runFailure = undefined;
    this.snapshot.activeTools = {};
    this.snapshot.queue = { steering: [], followUp: [] };
    delete this.snapshot.retry;
    delete this.snapshot.compaction;
  }

  reduce(event: PiRuntimeEvent): ReducerResult {
    const activeRun = this.snapshot.activeRun;
    if (!activeRun) return { events: [] };

    switch (event.type) {
      case "agent_start":
        activeRun.phase = this.phase(activeRun);
        return { events: [{ type: "run.started" }] };
      case "turn_start":
        this.turnIndex += 1;
        return { events: [{ type: "turn.started", turnIndex: this.turnIndex }] };
      case "turn_end":
        return { events: [{ type: "turn.completed", turnIndex: this.turnIndex }] };
      case "message_start":
        return this.messageStart(event.message);
      case "message_update":
        return this.messageUpdate(event.assistantMessageEvent);
      case "message_end":
        return this.messageEnd(event.message);
      case "tool_execution_start":
        return this.toolStart(event, activeRun);
      case "tool_execution_update":
        return this.toolUpdate(event);
      case "tool_execution_end":
        return this.toolEnd(event, activeRun);
      case "queue_update":
        return this.queueUpdate(event);
      case "auto_retry_start":
        return this.retryStart(event, activeRun);
      case "auto_retry_end":
        return this.retryEnd(event, activeRun);
      case "compaction_start":
        return this.compactionStart(event, activeRun);
      case "compaction_end":
        return this.compactionEnd(event, activeRun);
      case "agent_end":
        return { events: [] };
      case "agent_settled": {
        const outcome = activeRun.interruptRequestedAt
          ? "interrupted"
          : this.runFailure
            ? "failed"
            : "completed";
        return {
          events: [],
          settled: outcome,
          ...(this.runFailure ? { failure: this.runFailure } : {}),
        };
      }
      default:
        return { events: [] };
    }
  }

  private phase(activeRun: ActiveRunSnapshot): ActiveRunSnapshot["phase"] {
    if (activeRun.interruptRequestedAt) return "interrupting";
    if (this.snapshot.compaction) return "compacting";
    if (this.snapshot.retry) return "retry_wait";
    if (Object.keys(this.snapshot.activeTools).length > 0) return "tool_running";
    return "running";
  }

  private messageStart(rawMessage: unknown): ReducerResult {
    const record = isRecord(rawMessage) ? rawMessage : {};
    if (record.role !== "assistant") return { events: [] };
    const messageId = `msg_${randomUUID()}`;
    const message: UiMessage = {
      id: messageId,
      role: "assistant",
      content: contentFromPi(record.content, this.exposeThinking),
      status: "streaming",
      createdAt: timestamp(record.timestamp),
    };
    this.builder = { messageId, content: structuredClone(message.content) };
    this.snapshot.messages.push(message);
    return { events: [{ type: "message.started", message: structuredClone(message) }] };
  }

  private messageUpdate(rawDelta: unknown): ReducerResult {
    if (!isRecord(rawDelta) || typeof rawDelta.type !== "string") return { events: [] };
    if (!this.builder) {
      const messageId = `msg_${randomUUID()}`;
      const message: UiMessage = {
        id: messageId,
        role: "assistant",
        content: [],
        status: "streaming",
        createdAt: new Date().toISOString(),
      };
      this.builder = { messageId, content: [] };
      this.snapshot.messages.push(message);
    }
    const builder = this.builder;
    const contentIndex = numberField(rawDelta.contentIndex);
    const message = this.snapshot.messages.find((entry) => entry.id === builder.messageId);
    const events: ConversationEvent[] = [];

    if (rawDelta.type === "text_start") {
      ensureBlock(builder, contentIndex, "text");
    } else if (rawDelta.type === "text_delta") {
      const block = ensureBlock(builder, contentIndex, "text");
      if (block.type === "text") block.text += stringField(rawDelta.delta);
      events.push({
        type: "message.text.delta",
        messageId: builder.messageId,
        contentIndex,
        delta: stringField(rawDelta.delta),
      });
    } else if (rawDelta.type === "text_end") {
      const block = ensureBlock(builder, contentIndex, "text");
      if (block.type === "text") block.text = stringField(rawDelta.content, block.text);
    } else if (rawDelta.type === "thinking_start" && this.exposeThinking) {
      ensureBlock(builder, contentIndex, "thinking");
    } else if (rawDelta.type === "thinking_delta" && this.exposeThinking) {
      const block = ensureBlock(builder, contentIndex, "thinking");
      if (block.type === "thinking") block.text += stringField(rawDelta.delta);
      events.push({
        type: "message.thinking.delta",
        messageId: builder.messageId,
        contentIndex,
        delta: stringField(rawDelta.delta),
      });
    } else if (rawDelta.type === "thinking_end" && this.exposeThinking) {
      const block = ensureBlock(builder, contentIndex, "thinking");
      if (block.type === "thinking") block.text = stringField(rawDelta.content, block.text);
    } else if (rawDelta.type === "toolcall_end" && isRecord(rawDelta.toolCall)) {
      builder.content[contentIndex] = {
        type: "toolCall",
        id: stringField(rawDelta.toolCall.id, `tool_${randomUUID()}`),
        name: stringField(rawDelta.toolCall.name, "unknown"),
        arguments: redactForClient(rawDelta.toolCall.arguments),
      };
    }
    if (message) message.content = structuredClone(builder.content);
    return { events };
  }

  private messageEnd(rawMessage: unknown): ReducerResult {
    const record = isRecord(rawMessage) ? rawMessage : {};
    if (record.role !== "assistant") return { events: [] };
    const messageId = this.builder?.messageId ?? `msg_${randomUUID()}`;
    const authoritative = messageFromPi(record, messageId, this.exposeThinking);
    const index = this.snapshot.messages.findIndex((entry) => entry.id === messageId);
    if (index === -1) this.snapshot.messages.push(authoritative);
    else this.snapshot.messages[index] = authoritative;
    this.builder = undefined;
    if (authoritative.status === "failed") {
      this.runFailure = new DomainError("PI_UNAVAILABLE", { retryable: false });
    } else if (authoritative.status === "interrupted" && !this.snapshot.activeRun?.interruptRequestedAt) {
      this.runFailure = new DomainError("PI_UNAVAILABLE", { retryable: false });
    }
    return { events: [{ type: "message.completed", message: structuredClone(authoritative) }] };
  }

  private toolStart(event: PiRuntimeEvent, activeRun: ActiveRunSnapshot): ReducerResult {
    const toolCallId = stringField(event.toolCallId);
    if (!toolCallId) return { events: [] };
    const tool: UiToolExecution = {
      toolCallId,
      name: stringField(event.toolName, "unknown"),
      input: redactForClient(event.args),
      startedAt: new Date().toISOString(),
    };
    this.snapshot.activeTools[toolCallId] = tool;
    activeRun.phase = this.phase(activeRun);
    return {
      events: [{ type: "tool.started", toolCallId, name: tool.name, input: structuredClone(tool.input) }],
    };
  }

  private toolUpdate(event: PiRuntimeEvent): ReducerResult {
    const toolCallId = stringField(event.toolCallId);
    const tool = this.snapshot.activeTools[toolCallId];
    if (!tool) return { events: [] };
    tool.output = redactForClient(event.partialResult);
    return { events: [{ type: "tool.progress", toolCallId, output: structuredClone(tool.output) }] };
  }

  private toolEnd(event: PiRuntimeEvent, activeRun: ActiveRunSnapshot): ReducerResult {
    const toolCallId = stringField(event.toolCallId);
    const output = redactForClient(event.result);
    delete this.snapshot.activeTools[toolCallId];
    activeRun.phase = this.phase(activeRun);
    return {
      events: [{ type: "tool.completed", toolCallId, output, isError: event.isError === true }],
    };
  }

  private queueUpdate(event: PiRuntimeEvent): ReducerResult {
    const steering = Array.isArray(event.steering)
      ? event.steering.filter((entry): entry is string => typeof entry === "string")
      : [];
    const followUp = Array.isArray(event.followUp)
      ? event.followUp.filter((entry): entry is string => typeof entry === "string")
      : [];
    this.snapshot.queue = { steering, followUp };
    return { events: [{ type: "queue.changed", steeringCount: steering.length, followUpCount: followUp.length }] };
  }

  private retryStart(event: PiRuntimeEvent, activeRun: ActiveRunSnapshot): ReducerResult {
    const attempt = numberField(event.attempt);
    const maxAttempts = numberField(event.maxAttempts);
    const delayMs = numberField(event.delayMs);
    this.snapshot.retry = {
      attempt,
      maxAttempts,
      nextAt: new Date(Date.now() + delayMs).toISOString(),
    };
    activeRun.phase = this.phase(activeRun);
    return { events: [{ type: "retry.scheduled", attempt, maxAttempts, delayMs }] };
  }

  private retryEnd(event: PiRuntimeEvent, activeRun: ActiveRunSnapshot): ReducerResult {
    delete this.snapshot.retry;
    activeRun.phase = this.phase(activeRun);
    const success = event.success === true;
    const attempt = numberField(event.attempt);
    if (!success) this.runFailure = new DomainError("PI_UNAVAILABLE", { retryable: false });
    return { events: [{ type: "retry.completed", success, attempt }] };
  }

  private compactionStart(event: PiRuntimeEvent, activeRun: ActiveRunSnapshot): ReducerResult {
    const reason =
      event.reason === "manual" || event.reason === "threshold" || event.reason === "overflow"
        ? event.reason
        : "threshold";
    this.snapshot.compaction = { reason };
    activeRun.phase = this.phase(activeRun);
    return { events: [{ type: "compaction.started", reason }] };
  }

  private compactionEnd(event: PiRuntimeEvent, activeRun: ActiveRunSnapshot): ReducerResult {
    delete this.snapshot.compaction;
    activeRun.phase = this.phase(activeRun);
    return {
      events: [
        {
          type: "compaction.completed",
          aborted: event.aborted === true,
          willRetry: event.willRetry === true,
        },
      ],
    };
  }
}
