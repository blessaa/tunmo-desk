import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import { DomainError } from "../domain/errors.js";
import type {
  ConversationOptions,
  ConversationSnapshot,
  InterruptCommand,
  InterruptResult,
  ModelSelection,
  QueueResult,
  RunTargetCommand,
  SendCommand,
  SendResult,
} from "../domain/types.js";
import type { PiRuntimeFactory } from "../infrastructure/pi/pi-runtime.js";
import { ConversationActor, type AttachResult } from "./conversation-actor.js";
import type { EventListener } from "./event-hub.js";

export interface ConversationManagerOptions {
  cwdRoot: string;
  defaultCwd: string;
  replayCapacity: number;
  interruptTimeoutMs: number;
  idleTtlMs: number;
  exposeThinking: boolean;
  runtimeFactory: PiRuntimeFactory;
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

export class ConversationManager {
  private readonly options: ConversationManagerOptions;
  private readonly conversations = new Map<string, ConversationActor>();
  private readonly evictionTimer: NodeJS.Timeout;

  constructor(options: ConversationManagerOptions) {
    this.options = options;
    this.evictionTimer = setInterval(() => void this.evictIdle(), Math.min(options.idleTtlMs, 60_000));
    this.evictionTimer.unref();
  }

  async create(
    ownerId: string,
    input: { workingDirectory?: string; model?: ModelSelection },
  ): Promise<{ conversationId: string; snapshot: ConversationSnapshot }> {
    const workingDirectory = await this.resolveWorkingDirectory(input.workingDirectory);
    const conversationId = `conv_${randomUUID()}`;
    const conversation: ConversationOptions = {
      workingDirectory,
      ...(input.model ? { model: input.model } : {}),
    };
    const actor = new ConversationActor({
      ownerId,
      conversationId,
      conversation,
      runtimeFactory: this.options.runtimeFactory,
      replayCapacity: this.options.replayCapacity,
      interruptTimeoutMs: this.options.interruptTimeoutMs,
      exposeThinking: this.options.exposeThinking,
      ...(this.options.onDiagnostic ? { onDiagnostic: this.options.onDiagnostic } : {}),
    });
    this.conversations.set(conversationId, actor);
    return { conversationId, snapshot: await actor.getSnapshot() };
  }

  send(ownerId: string, command: SendCommand): Promise<SendResult> {
    return this.get(ownerId, command.conversationId).send(command);
  }

  steer(ownerId: string, command: RunTargetCommand): Promise<QueueResult> {
    return this.get(ownerId, command.conversationId).steer(command);
  }

  followUp(ownerId: string, command: RunTargetCommand): Promise<QueueResult> {
    return this.get(ownerId, command.conversationId).followUp(command);
  }

  interrupt(ownerId: string, command: InterruptCommand): Promise<InterruptResult> {
    return this.get(ownerId, command.conversationId).interrupt(command);
  }

  getSnapshot(ownerId: string, conversationId: string): Promise<ConversationSnapshot> {
    return this.get(ownerId, conversationId).getSnapshot();
  }

  attach(ownerId: string, conversationId: string, afterSeq: number | undefined, listener: EventListener): Promise<AttachResult> {
    return this.get(ownerId, conversationId).attach(afterSeq, listener);
  }

  async close(ownerId: string, conversationId: string, interruptActiveRun: boolean): Promise<{ closed: true }> {
    const actor = this.get(ownerId, conversationId);
    await actor.close(interruptActiveRun);
    this.conversations.delete(conversationId);
    return { closed: true };
  }

  async closeAll(): Promise<void> {
    clearInterval(this.evictionTimer);
    const actors = [...this.conversations.values()];
    this.conversations.clear();
    await Promise.allSettled(actors.map((actor) => actor.close(true)));
  }

  private get(ownerId: string, conversationId: string): ConversationActor {
    const actor = this.conversations.get(conversationId);
    if (!actor) throw new DomainError("CONVERSATION_NOT_FOUND");
    if (actor.ownerId !== ownerId) throw new DomainError("UNAUTHORIZED");
    return actor;
  }

  private async resolveWorkingDirectory(requested: string | undefined): Promise<string> {
    let root: string;
    let target: string;
    try {
      [root, target] = await Promise.all([
        realpath(this.options.cwdRoot),
        realpath(requested ?? this.options.defaultCwd),
      ]);
    } catch {
      throw new DomainError("INVALID_PARAMS", { details: { field: "workingDirectory" } });
    }
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new DomainError("INVALID_PARAMS", { details: { field: "workingDirectory" } });
    }
    return target;
  }

  private async evictIdle(): Promise<void> {
    const expiredBefore = Date.now() - this.options.idleTtlMs;
    for (const [conversationId, actor] of this.conversations) {
      if (actor.activeRunId || actor.lastActiveAt >= expiredBefore) continue;
      this.conversations.delete(conversationId);
      await actor.close(false);
    }
  }
}
