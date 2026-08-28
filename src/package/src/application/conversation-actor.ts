import { randomUUID } from "node:crypto";
import { DomainError, publicErrorFrom } from "../domain/errors.js";
import { PiEventReducer } from "../domain/pi-event-reducer.js";
import type {
  ConversationEvent,
  ConversationEventEnvelope,
  ConversationOptions,
  ConversationSnapshot,
  ImageInput,
  InterruptCommand,
  InterruptResult,
  QueueResult,
  RunOutcome,
  RunTargetCommand,
  SendCommand,
  SendResult,
  TerminalRun,
  UiMessage,
} from "../domain/types.js";
import type {
  PiRuntimeAdapter,
  PiRuntimeEvent,
  PiRuntimeFactory,
} from "../infrastructure/pi/pi-runtime.js";
import { EventHub, type EventListener } from "./event-hub.js";
import { SerialQueue } from "./serial-queue.js";

interface CachedCommand {
  type: "send" | "steer" | "followUp" | "interrupt";
  promise: Promise<unknown>;
}

export interface AttachResult {
  mode: "snapshot" | "replay";
  highWaterSeq: number;
  snapshot?: ConversationSnapshot;
  events: ConversationEventEnvelope[];
  unsubscribe: () => void;
}

export interface ConversationActorOptions {
  ownerId: string;
  conversationId: string;
  conversation: ConversationOptions;
  runtimeFactory: PiRuntimeFactory;
  replayCapacity: number;
  interruptTimeoutMs: number;
  exposeThinking: boolean;
  onDiagnostic?: (entry: {
    message: string;
    conversationId: string;
    runId?: string;
    clientRequestId?: string;
    piCommandId?: string;
    piSessionId?: string;
    toolCallId?: string;
    runtimeEpoch?: number;
    eventType?: string;
    seq?: number;
  }) => void;
}

function createUserMessage(message: string, images: ImageInput[] | undefined): UiMessage {
  return {
    id: `msg_${randomUUID()}`,
    role: "user",
    content: [
      { type: "text", text: message },
      ...(images ?? []).map((image) => ({
        type: "image" as const,
        mimeType: image.mimeType,
        data: image.data,
      })),
    ],
    status: "completed",
    createdAt: new Date().toISOString(),
  };
}

export class ConversationActor {
  readonly ownerId: string;
  readonly conversationId: string;
  readonly conversation: ConversationOptions;
  private readonly options: ConversationActorOptions;
  private readonly mailbox = new SerialQueue();
  private readonly eventHub = new EventHub();
  private readonly snapshot: ConversationSnapshot;
  private readonly reducer: PiEventReducer;
  private readonly events: ConversationEventEnvelope[] = [];
  private readonly commands = new Map<string, CachedCommand>();
  private readonly terminalRuns = new Map<string, TerminalRun>();
  private runtime: PiRuntimeAdapter | undefined;
  private runtimePromise: Promise<PiRuntimeAdapter> | undefined;
  private unsubscribeRuntime: (() => void) | undefined;
  private runtimeEpoch = 0;
  private closed = false;
  private startedEventRunId: string | undefined;
  private readonly bufferedPiEvents: Array<{ runtime: PiRuntimeAdapter; epoch: number; event: PiRuntimeEvent }> = [];
  private lastTouchedAt = Date.now();

  constructor(options: ConversationActorOptions) {
    this.options = options;
    this.ownerId = options.ownerId;
    this.conversationId = options.conversationId;
    this.conversation = options.conversation;
    this.snapshot = {
      schemaVersion: 1,
      conversationId: options.conversationId,
      lastSeq: 0,
      messages: [],
      activeTools: {},
      queue: { steering: [], followUp: [] },
    };
    this.reducer = new PiEventReducer(this.snapshot, options.exposeThinking);
  }

  get activeRunId(): string | undefined {
    return this.snapshot.activeRun?.runId;
  }

  get lastActiveAt(): number {
    return this.lastTouchedAt;
  }

  async send(command: SendCommand): Promise<SendResult> {
    return this.cached("send", command.clientRequestId, () => this.executeSend(command));
  }

  async steer(command: RunTargetCommand): Promise<QueueResult> {
    return this.cached("steer", command.clientRequestId, () => this.executeQueue("steer", command));
  }

  async followUp(command: RunTargetCommand): Promise<QueueResult> {
    return this.cached("followUp", command.clientRequestId, () => this.executeQueue("followUp", command));
  }

  async interrupt(command: InterruptCommand): Promise<InterruptResult> {
    return this.cached("interrupt", command.clientRequestId, () => this.executeInterrupt(command));
  }

  getSnapshot(): Promise<ConversationSnapshot> {
    return this.mailbox.run(() => {
      this.touch();
      return structuredClone(this.snapshot);
    });
  }

  attach(afterSeq: number | undefined, listener: EventListener): Promise<AttachResult> {
    return this.mailbox.run(() => {
      this.touch();
      const unsubscribe = this.eventHub.subscribe(listener);
      const highWaterSeq = this.snapshot.lastSeq;
      if (afterSeq === undefined) {
        return {
          mode: "snapshot",
          highWaterSeq,
          snapshot: structuredClone(this.snapshot),
          events: [],
          unsubscribe,
        };
      }
      const oldestSeq = this.events[0]?.seq ?? highWaterSeq + 1;
      if (afterSeq < oldestSeq - 1 || afterSeq > highWaterSeq) {
        return {
          mode: "snapshot",
          highWaterSeq,
          snapshot: structuredClone(this.snapshot),
          events: [],
          unsubscribe,
        };
      }
      return {
        mode: "replay",
        highWaterSeq,
        events: structuredClone(this.events.filter((event) => event.seq > afterSeq)),
        unsubscribe,
      };
    });
  }

  async close(interruptActiveRun: boolean): Promise<void> {
    const activeRunId = await this.mailbox.run(() => this.snapshot.activeRun?.runId);
    if (activeRunId && !interruptActiveRun) throw new DomainError("COMMAND_CONFLICT");
    if (activeRunId) {
      try {
        await this.interrupt({
          conversationId: this.conversationId,
          runId: activeRunId,
          clientRequestId: `close_${randomUUID()}`,
          reason: "conversation_closed",
        });
      } catch {
        // close 仍需释放失效 runtime；结算状态已由 interrupt 路径记录。
      }
    }
    this.closed = true;
    this.eventHub.clear();
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = undefined;
    await this.runtime?.stop("conversation_closed", true);
    this.runtime = undefined;
    this.runtimePromise = undefined;
  }

  private cached<T>(type: CachedCommand["type"], clientRequestId: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.commands.get(clientRequestId);
    if (existing) {
      if (existing.type !== type) return Promise.reject(new DomainError("COMMAND_CONFLICT"));
      return existing.promise as Promise<T>;
    }
    const promise = operation();
    this.commands.set(clientRequestId, { type, promise });
    return promise;
  }

  private async executeSend(command: SendCommand): Promise<SendResult> {
    const runId = `run_${randomUUID()}`;
    await this.mailbox.run(() => {
      this.assertOpen();
      this.touch();
      if (this.snapshot.activeRun) throw new DomainError("RUN_ALREADY_ACTIVE");
      this.snapshot.activeRun = {
        runId,
        phase: "accepting",
        startedAt: new Date().toISOString(),
      };
      this.reducer.resetForRun();
      this.startedEventRunId = undefined;
      this.bufferedPiEvents.length = 0;
    });

    try {
      const runtime = await this.ensureRuntime();
      const piCommandId = `pi_${randomUUID()}`;
      await runtime.prompt({
        commandId: piCommandId,
        message: command.message,
        ...(command.images ? { images: command.images } : {}),
      });
      this.options.onDiagnostic?.({
        message: "Pi prompt 预检已通过",
        conversationId: this.conversationId,
        runId,
        clientRequestId: command.clientRequestId,
        piCommandId,
        ...(runtime.sessionId ? { piSessionId: runtime.sessionId } : {}),
        runtimeEpoch: this.runtimeEpoch,
        eventType: "prompt.accepted",
      });
    } catch (error) {
      await this.mailbox.run(() => this.failRun(runId, publicErrorFrom(error, "PI_UNAVAILABLE")));
      throw error;
    }

    await this.mailbox.run(() => {
      if (this.snapshot.activeRun?.runId !== runId) return;
      this.snapshot.activeRun.phase = "running";
      const userMessage = createUserMessage(command.message, command.images);
      this.snapshot.messages.push(userMessage);
      this.append(runId, { type: "run.accepted", clientRequestId: command.clientRequestId });
      this.append(runId, { type: "message.completed", message: structuredClone(userMessage) });
      const buffered = this.bufferedPiEvents.splice(0);
      for (const entry of buffered) this.applyRuntimeEvent(entry.runtime, entry.epoch, entry.event);
    });
    return { accepted: true, runId, status: "running" };
  }

  private async executeQueue(kind: "steer" | "followUp", command: RunTargetCommand): Promise<QueueResult> {
    const runtime = await this.mailbox.run(() => {
      this.assertOpen();
      this.touch();
      const run = this.requireActiveRun(command.runId);
      if (run.interruptRequestedAt) throw new DomainError("COMMAND_CONFLICT");
      const currentRuntime = this.runtime;
      if (!currentRuntime || currentRuntime.status !== "ready") throw new DomainError("PI_UNAVAILABLE", { retryable: true });
      return currentRuntime;
    });
    const input = {
      commandId: `pi_${randomUUID()}`,
      message: command.message,
      ...(command.images ? { images: command.images } : {}),
    };
    if (kind === "steer") await runtime.steer(input);
    else await runtime.followUp(input);
    return { accepted: true, runId: command.runId, status: "queued" };
  }

  private async executeInterrupt(command: InterruptCommand): Promise<InterruptResult> {
    const preparation = await this.mailbox.run(() => {
      this.assertOpen();
      this.touch();
      const terminal = this.terminalRuns.get(command.runId);
      if (terminal) {
        return { terminal } as const;
      }
      const run = this.requireActiveRun(command.runId);
      if (!run.interruptRequestedAt) {
        run.interruptRequestedAt = new Date().toISOString();
        run.phase = "interrupting";
        this.append(run.runId, { type: "run.interrupting", reason: command.reason });
      }
      const runtime = this.runtime;
      if (!runtime) throw new DomainError("PI_UNAVAILABLE", { retryable: true });
      return { runtime, runId: run.runId } as const;
    });

    if ("terminal" in preparation) {
      return {
        accepted: true,
        runId: preparation.terminal.runId,
        status:
          preparation.terminal.outcome === "completed"
            ? "settled"
            : preparation.terminal.outcome === "failed"
              ? "failed"
              : "interrupted",
        alreadyTerminal: true,
      };
    }

    try {
      await preparation.runtime.abort({
        commandId: `pi_${randomUUID()}`,
        timeoutMs: this.options.interruptTimeoutMs,
      });
      await this.mailbox.run(() => {
        if (this.snapshot.activeRun?.runId === preparation.runId) {
          this.settleRun(preparation.runId, "interrupted", "cooperative");
        }
      });
      return { accepted: true, runId: preparation.runId, status: "interrupted" };
    } catch (error) {
      await preparation.runtime.stop("interrupt_timeout", true);
      await this.mailbox.run(() => {
        if (this.snapshot.activeRun?.runId === preparation.runId) {
          this.append(preparation.runId, { type: "run.interrupted", mode: "forced" });
          this.failRun(preparation.runId, publicErrorFrom(error, "INTERRUPT_TIMEOUT"));
        }
        this.detachRuntime(preparation.runtime);
      });
      if (error instanceof DomainError && error.publicError.code === "INTERRUPT_TIMEOUT") throw error;
      throw new DomainError("INTERRUPT_TIMEOUT");
    }
  }

  private ensureRuntime(): Promise<PiRuntimeAdapter> {
    if (this.runtime?.status === "ready") return Promise.resolve(this.runtime);
    if (this.runtimePromise) return this.runtimePromise;
    const epoch = ++this.runtimeEpoch;
    const runtime = this.options.runtimeFactory({
      conversationId: this.conversationId,
      cwd: this.conversation.workingDirectory,
      ...(this.conversation.model ? { model: this.conversation.model } : {}),
    });
    this.runtime = runtime;
    this.unsubscribeRuntime = runtime.onEvent((event) => {
      void this.mailbox.run(() => this.handleRuntimeEvent(runtime, epoch, event));
    });
    const promise = runtime
      .start()
      .then(() => {
        if (this.runtime !== runtime || this.runtimeEpoch !== epoch) throw new DomainError("PI_UNAVAILABLE", { retryable: true });
        if (runtime.sessionId) this.snapshot.piSessionId = runtime.sessionId;
        this.options.onDiagnostic?.({
          message: "Pi runtime 已启动",
          conversationId: this.conversationId,
          ...(this.snapshot.activeRun ? { runId: this.snapshot.activeRun.runId } : {}),
          ...(runtime.sessionId ? { piSessionId: runtime.sessionId } : {}),
          runtimeEpoch: epoch,
          eventType: "runtime.started",
        });
        return runtime;
      })
      .catch((error: unknown) => {
        this.detachRuntime(runtime);
        throw error;
      })
      .finally(() => {
        if (this.runtimePromise === promise) this.runtimePromise = undefined;
      });
    this.runtimePromise = promise;
    return promise;
  }

  private handleRuntimeEvent(runtime: PiRuntimeAdapter, epoch: number, event: PiRuntimeEvent): void {
    if (this.runtime !== runtime || this.runtimeEpoch !== epoch) return;
    const runId = this.snapshot.activeRun?.runId;
    if (!runId) return;
    this.touch();
    if (event.type === "__runtime_exit") {
      this.failRun(runId, new DomainError("PI_UNAVAILABLE", { retryable: true }).publicError);
      this.detachRuntime(runtime);
      return;
    }
    if (this.snapshot.activeRun?.phase === "accepting") {
      this.bufferedPiEvents.push({ runtime, epoch, event });
      return;
    }
    this.applyRuntimeEvent(runtime, epoch, event);
  }

  private applyRuntimeEvent(runtime: PiRuntimeAdapter, epoch: number, event: PiRuntimeEvent): void {
    if (this.runtime !== runtime || this.runtimeEpoch !== epoch) return;
    const runId = this.snapshot.activeRun?.runId;
    if (!runId) return;
    if (event.type === "agent_start" && this.startedEventRunId === runId) return;
    const result = this.reducer.reduce(event);
    if (event.type === "agent_start") this.startedEventRunId = runId;
    for (const domainEvent of result.events) this.append(runId, domainEvent);
    if (result.settled) {
      this.settleRun(runId, result.settled, "cooperative", result.failure);
    }
  }

  private settleRun(
    runId: string,
    outcome: RunOutcome,
    interruptMode: "cooperative" | "forced",
    failure?: DomainError,
  ): void {
    if (this.snapshot.activeRun?.runId !== runId) return;
    if (outcome === "interrupted") this.append(runId, { type: "run.interrupted", mode: interruptMode });
    if (outcome === "failed") {
      this.append(runId, {
        type: "run.failed",
        error: failure?.publicError ?? new DomainError("PI_UNAVAILABLE", { retryable: false }).publicError,
      });
    }
    this.append(runId, { type: "run.settled", outcome });
    this.terminalRuns.set(runId, { runId, outcome, settledAt: new Date().toISOString() });
    delete this.snapshot.activeRun;
    this.snapshot.activeTools = {};
    delete this.snapshot.retry;
    delete this.snapshot.compaction;
  }

  private failRun(runId: string, error: ReturnType<typeof publicErrorFrom>): void {
    if (this.snapshot.activeRun?.runId !== runId) return;
    this.append(runId, { type: "run.failed", error });
    this.append(runId, { type: "run.settled", outcome: "failed" });
    this.terminalRuns.set(runId, { runId, outcome: "failed", settledAt: new Date().toISOString() });
    delete this.snapshot.activeRun;
    this.snapshot.activeTools = {};
    delete this.snapshot.retry;
    delete this.snapshot.compaction;
  }

  private append(runId: string | undefined, event: ConversationEvent): void {
    const envelope: ConversationEventEnvelope = {
      schemaVersion: 1,
      conversationId: this.conversationId,
      ...(runId ? { runId } : {}),
      seq: this.snapshot.lastSeq + 1,
      occurredAt: new Date().toISOString(),
      event,
    };
    this.snapshot.lastSeq = envelope.seq;
    this.events.push(envelope);
    if (this.events.length > this.options.replayCapacity) this.events.shift();
    this.eventHub.publish(structuredClone(envelope));
    if (
      event.type !== "message.text.delta" &&
      event.type !== "message.thinking.delta" &&
      event.type !== "tool.progress"
    ) {
      const toolCallId = "toolCallId" in event && typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      this.options.onDiagnostic?.({
        message: "对话事件已提交",
        conversationId: this.conversationId,
        ...(runId ? { runId } : {}),
        ...(this.snapshot.piSessionId ? { piSessionId: this.snapshot.piSessionId } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        runtimeEpoch: this.runtimeEpoch,
        eventType: event.type,
        seq: envelope.seq,
      });
    }
  }

  private requireActiveRun(runId: string): NonNullable<ConversationSnapshot["activeRun"]> {
    const run = this.snapshot.activeRun;
    if (!run || run.runId !== runId) throw new DomainError("RUN_NOT_ACTIVE");
    return run;
  }

  private detachRuntime(runtime: PiRuntimeAdapter): void {
    if (this.runtime !== runtime) return;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = undefined;
    this.runtime = undefined;
    this.runtimePromise = undefined;
  }

  private assertOpen(): void {
    if (this.closed) throw new DomainError("CONVERSATION_NOT_FOUND");
  }

  private touch(): void {
    this.lastTouchedAt = Date.now();
  }
}
