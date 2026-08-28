import type { PublicError } from "./errors.js";

export type RunPhase =
  | "accepting"
  | "running"
  | "tool_running"
  | "retry_wait"
  | "compacting"
  | "interrupting"
  | "settled"
  | "interrupted"
  | "failed";

export type ActiveRunPhase = Exclude<RunPhase, "settled" | "interrupted" | "failed">;
export type RunOutcome = "completed" | "interrupted" | "failed";

export interface ImageInput {
  type: "image";
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export type UiContent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; mimeType: string; data?: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown };

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "toolResult" | "system";
  content: UiContent[];
  status: "streaming" | "completed" | "interrupted" | "failed";
  stopReason?: string;
  createdAt: string;
}

export interface UiToolExecution {
  toolCallId: string;
  name: string;
  input: unknown;
  output?: unknown;
  startedAt: string;
}

export interface ActiveRunSnapshot {
  runId: string;
  phase: ActiveRunPhase;
  startedAt: string;
  interruptRequestedAt?: string;
}

export interface ConversationSnapshot {
  schemaVersion: 1;
  conversationId: string;
  piSessionId?: string;
  lastSeq: number;
  activeRun?: ActiveRunSnapshot;
  messages: UiMessage[];
  activeTools: Record<string, UiToolExecution>;
  queue: { steering: string[]; followUp: string[] };
  retry?: { attempt: number; maxAttempts: number; nextAt: string };
  compaction?: { reason: "manual" | "threshold" | "overflow" };
}

export type ConversationEvent =
  | { type: "run.accepted"; clientRequestId: string }
  | { type: "run.started" }
  | { type: "run.interrupting"; reason: string }
  | { type: "run.interrupted"; mode: "cooperative" | "forced" }
  | { type: "run.failed"; error: PublicError }
  | { type: "run.settled"; outcome: RunOutcome }
  | { type: "turn.started"; turnIndex: number }
  | { type: "turn.completed"; turnIndex: number }
  | { type: "message.started"; message: UiMessage }
  | { type: "message.text.delta"; messageId: string; contentIndex: number; delta: string }
  | { type: "message.thinking.delta"; messageId: string; contentIndex: number; delta: string }
  | { type: "message.completed"; message: UiMessage }
  | { type: "tool.started"; toolCallId: string; name: string; input: unknown }
  | { type: "tool.progress"; toolCallId: string; output: unknown }
  | { type: "tool.completed"; toolCallId: string; output: unknown; isError: boolean }
  | { type: "queue.changed"; steeringCount: number; followUpCount: number }
  | { type: "retry.scheduled"; attempt: number; maxAttempts: number; delayMs: number }
  | { type: "retry.completed"; success: boolean; attempt: number }
  | { type: "compaction.started"; reason: "manual" | "threshold" | "overflow" }
  | { type: "compaction.completed"; aborted: boolean; willRetry: boolean };

export interface ConversationEventEnvelope {
  schemaVersion: 1;
  conversationId: string;
  runId?: string;
  seq: number;
  occurredAt: string;
  event: ConversationEvent;
}

export interface ModelSelection {
  provider: string;
  modelId: string;
}

export interface ConversationOptions {
  workingDirectory: string;
  model?: ModelSelection;
}

export interface SendCommand {
  conversationId: string;
  clientRequestId: string;
  message: string;
  images?: ImageInput[];
}

export interface RunTargetCommand {
  conversationId: string;
  runId: string;
  clientRequestId: string;
  message: string;
  images?: ImageInput[];
}

export interface InterruptCommand {
  conversationId: string;
  runId: string;
  clientRequestId: string;
  reason: string;
}

export interface SendResult {
  accepted: true;
  runId: string;
  status: "running";
}

export interface QueueResult {
  accepted: true;
  runId: string;
  status: "queued";
}

export interface InterruptResult {
  accepted: true;
  runId: string;
  status: "interrupted" | "settled" | "failed";
  alreadyTerminal?: boolean;
}

export interface TerminalRun {
  runId: string;
  outcome: RunOutcome;
  settledAt: string;
}
