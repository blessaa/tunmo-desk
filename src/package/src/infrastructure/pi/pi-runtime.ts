import type { ImageInput, ModelSelection } from "../../domain/types.js";

export type PiRuntimeStatus = "starting" | "ready" | "failed" | "stopped";

export interface PiSessionState {
  sessionId: string;
  sessionFile?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  pendingMessageCount: number;
}

export interface PiRuntimeEvent extends Record<string, unknown> {
  type: string;
}

export interface PiRuntimeExitEvent extends PiRuntimeEvent {
  type: "__runtime_exit";
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface PiRuntimeAdapter {
  readonly sessionId: string | undefined;
  readonly status: PiRuntimeStatus;
  start(): Promise<void>;
  prompt(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void>;
  steer(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void>;
  followUp(input: { commandId: string; message: string; images?: ImageInput[] }): Promise<void>;
  abort(input: { commandId: string; timeoutMs: number }): Promise<void>;
  getState(): Promise<PiSessionState>;
  onEvent(listener: (event: PiRuntimeEvent) => void): () => void;
  stop(reason: string, force?: boolean): Promise<void>;
}

export interface PiRuntimeCreationOptions {
  conversationId: string;
  cwd: string;
  model?: ModelSelection;
}

export type PiRuntimeFactory = (options: PiRuntimeCreationOptions) => PiRuntimeAdapter;
