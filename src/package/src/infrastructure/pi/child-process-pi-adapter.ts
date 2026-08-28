import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ImageInput, ModelSelection } from "../../domain/types.js";
import { DomainError } from "../../domain/errors.js";
import { attachJsonlLineReader, serializeJsonLine } from "./pi-jsonl.js";
import type {
  PiRuntimeAdapter,
  PiRuntimeEvent,
  PiRuntimeStatus,
  PiSessionState,
} from "./pi-runtime.js";

interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface PendingCommand {
  command: string;
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ChildProcessPiAdapterOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  sessionDir?: string;
  model?: ModelSelection;
  defaultProvider?: string;
  defaultModel?: string;
  startTimeoutMs: number;
  commandTimeoutMs: number;
  stopGraceMs: number;
  onDiagnostic?: (entry: { level: "warn" | "error"; message: string }) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSessionState(value: unknown): PiSessionState {
  if (!isRecord(value) || typeof value.sessionId !== "string") {
    throw new DomainError("PI_UNAVAILABLE", { retryable: true });
  }
  return {
    sessionId: value.sessionId,
    ...(typeof value.sessionFile === "string" ? { sessionFile: value.sessionFile } : {}),
    isStreaming: value.isStreaming === true,
    isCompacting: value.isCompacting === true,
    pendingMessageCount: typeof value.pendingMessageCount === "number" ? value.pendingMessageCount : 0,
  };
}

export class ChildProcessPiAdapter implements PiRuntimeAdapter {
  private readonly options: ChildProcessPiAdapterOptions;
  private readonly events = new EventEmitter();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly completedIds = new Set<string>();
  private child: ChildProcessWithoutNullStreams | undefined;
  private detachReader: (() => void) | undefined;
  private currentStatus: PiRuntimeStatus = "stopped";
  private currentSessionId?: string;
  private stopping = false;

  constructor(options: ChildProcessPiAdapterOptions) {
    this.options = options;
  }

  get sessionId(): string | undefined {
    return this.currentSessionId;
  }

  get status(): PiRuntimeStatus {
    return this.currentStatus;
  }

  async start(): Promise<void> {
    if (this.child) throw new Error("Pi runtime 已启动");
    this.currentStatus = "starting";
    this.stopping = false;

    const args = [...this.options.args];
    const model = this.options.model ??
      (this.options.defaultProvider && this.options.defaultModel
        ? { provider: this.options.defaultProvider, modelId: this.options.defaultModel }
        : undefined);
    if (model) args.push("--model", `${model.provider}/${model.modelId}`);
    if (this.options.sessionDir) args.push("--session-dir", this.options.sessionDir);

    const child = spawn(this.options.command, args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.child = child;
    this.detachReader = attachJsonlLineReader(child.stdout, (line) => this.handleLine(line));

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").slice(0, 4_096).trim();
      if (message) this.options.onDiagnostic?.({ level: "warn", message: "Pi stderr 已记录" });
    });
    child.stdin.on("error", () => this.failRuntime("Pi stdin 写入失败"));
    child.once("error", () => this.failRuntime("Pi 子进程启动失败"));
    child.once("exit", (code, signal) => this.handleExit(code, signal));

    try {
      const state = await this.request("get_state", {}, this.options.startTimeoutMs);
      const parsed = toSessionState(state.data);
      this.currentSessionId = parsed.sessionId;
      this.currentStatus = "ready";
    } catch (error) {
      this.currentStatus = "failed";
      await this.stop("startup_failed", true);
      if (error instanceof DomainError) throw error;
      throw new DomainError("PI_UNAVAILABLE", { retryable: true });
    }
  }

  async prompt(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void> {
    await this.request(
      "prompt",
      { message: input.message, ...(input.images ? { images: input.images } : {}) },
      this.options.commandTimeoutMs,
      input.commandId,
    );
  }

  async steer(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void> {
    await this.request(
      "steer",
      { message: input.message, ...(input.images ? { images: input.images } : {}) },
      this.options.commandTimeoutMs,
      input.commandId,
    );
  }

  async followUp(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void> {
    await this.request(
      "follow_up",
      { message: input.message, ...(input.images ? { images: input.images } : {}) },
      this.options.commandTimeoutMs,
      input.commandId,
    );
  }

  async abort(input: { commandId: string; timeoutMs: number }): Promise<void> {
    try {
      await this.request("abort", {}, input.timeoutMs, input.commandId);
    } catch (error) {
      if (error instanceof DomainError && error.publicError.code === "PI_COMMAND_TIMEOUT") {
        throw new DomainError("INTERRUPT_TIMEOUT", { retryable: false });
      }
      throw error;
    }
  }

  async getState(): Promise<PiSessionState> {
    const response = await this.request("get_state", {}, this.options.commandTimeoutMs);
    return toSessionState(response.data);
  }

  onEvent(listener: (event: PiRuntimeEvent) => void): () => void {
    this.events.on("event", listener);
    return () => this.events.off("event", listener);
  }

  async stop(_reason: string, force = false): Promise<void> {
    const child = this.child;
    if (!child) {
      this.currentStatus = "stopped";
      return;
    }
    this.stopping = true;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const exited = await this.waitForExit(child, force ? 0 : this.options.stopGraceMs);
    if (!exited && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (!exited) await this.waitForExit(child, this.options.stopGraceMs);
    this.detachReader?.();
    this.detachReader = undefined;
    this.child = undefined;
    this.currentStatus = "stopped";
    this.rejectPending(new DomainError("PI_UNAVAILABLE", { retryable: true }));
  }

  private request(
    command: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
    suppliedId?: string,
  ): Promise<RpcResponse> {
    const child = this.child;
    if (!child || (this.currentStatus !== "starting" && this.currentStatus !== "ready")) {
      return Promise.reject(new DomainError("PI_UNAVAILABLE", { retryable: true }));
    }
    const id = suppliedId ?? `pi_${randomUUID()}`;
    if (this.pending.has(id) || this.completedIds.has(id)) {
      return Promise.reject(new DomainError("COMMAND_CONFLICT"));
    }

    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DomainError("PI_COMMAND_TIMEOUT", { retryable: true }));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { command, resolve, reject, timer });
      child.stdin.write(serializeJsonLine({ id, type: command, ...payload }), (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new DomainError("PI_UNAVAILABLE", { retryable: true }));
      });
    });
  }

  private handleLine(line: string): void {
    if (!line) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.options.onDiagnostic?.({ level: "error", message: "Pi stdout 出现非法 JSONL" });
      this.failRuntime("Pi RPC 协议错误");
      return;
    }
    if (!isRecord(value) || typeof value.type !== "string") {
      this.options.onDiagnostic?.({ level: "warn", message: "忽略未知 Pi RPC envelope" });
      return;
    }
    if (value.type !== "response") {
      this.events.emit("event", value as PiRuntimeEvent);
      return;
    }

    const response = value as unknown as RpcResponse;
    const id = response.id;
    if (typeof id !== "string") {
      this.options.onDiagnostic?.({ level: "warn", message: "忽略无 id 的 Pi response" });
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      this.options.onDiagnostic?.({
        level: "warn",
        message: this.completedIds.has(id) ? "忽略重复 Pi response" : "忽略未知 Pi response",
      });
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    this.rememberCompleted(id);
    if (response.command !== pending.command) {
      pending.reject(new DomainError("PI_UNAVAILABLE", { retryable: true }));
      this.failRuntime("Pi response command 与请求不匹配");
      return;
    }
    if (!response.success) {
      pending.reject(new DomainError("PI_UNAVAILABLE", { retryable: false }));
      return;
    }
    pending.resolve(response);
  }

  private rememberCompleted(id: string): void {
    this.completedIds.add(id);
    if (this.completedIds.size <= 1_000) return;
    const oldest = this.completedIds.values().next().value;
    if (typeof oldest === "string") this.completedIds.delete(oldest);
  }

  private failRuntime(message: string): void {
    if (this.currentStatus === "failed" || this.currentStatus === "stopped") return;
    this.options.onDiagnostic?.({ level: "error", message });
    this.currentStatus = "failed";
    this.rejectPending(new DomainError("PI_UNAVAILABLE", { retryable: true }));
    this.events.emit("event", { type: "__runtime_exit", code: null, signal: null } satisfies PiRuntimeEvent);
    if (this.child?.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.detachReader?.();
    this.detachReader = undefined;
    this.child = undefined;
    this.currentStatus = this.stopping ? "stopped" : "failed";
    this.rejectPending(new DomainError("PI_UNAVAILABLE", { retryable: true }));
    if (!this.stopping) {
      this.events.emit("event", { type: "__runtime_exit", code, signal } satisfies PiRuntimeEvent);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const onExit = (): void => {
        if (timer) clearTimeout(timer);
        resolve(true);
      };
      child.once("exit", onExit);
      timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      timer.unref();
    });
  }
}
