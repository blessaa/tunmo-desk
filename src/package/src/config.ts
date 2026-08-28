import { dirname, join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  authToken?: string;
  authOwnerId: string;
  wsTicketTtlMs: number;
  allowedOrigins: string[];
  pi: {
    command: string;
    args: string[];
    cwdRoot: string;
    defaultCwd: string;
    sessionDir?: string;
    provider?: string;
    model?: string;
    startTimeoutMs: number;
    commandTimeoutMs: number;
    interruptTimeoutMs: number;
    stopGraceMs: number;
  };
  maxActivePiProcesses: number;
  replayCapacity: number;
  conversationIdleTtlMs: number;
  maxFrameBytes: number;
  maxWsBufferedBytes: number;
  maxRpcPerMinute: number;
  wsHeartbeatMs: number;
  exposeThinking: boolean;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseArgs(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("PI_RPC_ARGS 必须是 JSON 字符串数组");
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error("PI_RPC_ARGS 必须是 JSON 字符串数组");
  }
  return parsed;
}

function resolvePiRpcEntry(): string {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const bundled = join(
    packageRoot,
    "node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js",
  );
  if (existsSync(bundled)) return bundled;
  return fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const startupCwd = process.cwd();
  const cwdRoot = resolve(optional(env.PI_CWD_ROOT) ?? startupCwd);
  const defaultCwd = resolve(optional(env.PI_DEFAULT_CWD) ?? cwdRoot);
  if (defaultCwd !== cwdRoot && !defaultCwd.startsWith(`${cwdRoot}${sep}`)) {
    throw new Error("PI_DEFAULT_CWD 必须位于 PI_CWD_ROOT 内");
  }

  const authToken = optional(env.AUTH_TOKEN);
  const sessionDir = optional(env.PI_SESSION_DIR);
  const provider = optional(env.PI_PROVIDER);
  const model = optional(env.PI_MODEL);
  const externalPiCommand = optional(env.PI_RPC_COMMAND);
  const packagedPiRpcEntry = resolvePiRpcEntry();
  if ((provider && !model) || (!provider && model)) {
    throw new Error("PI_PROVIDER 与 PI_MODEL 必须同时配置或同时省略");
  }

  return {
    host: optional(env.HOST) ?? "192.168.3.112",
    port: positiveInteger(env.PORT, 3000, "PORT"),
    logLevel: optional(env.LOG_LEVEL) ?? "info",
    ...(authToken ? { authToken } : {}),
    authOwnerId: optional(env.AUTH_OWNER_ID) ?? "local-user",
    wsTicketTtlMs: positiveInteger(env.WS_TICKET_TTL_MS, 60_000, "WS_TICKET_TTL_MS"),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    pi: {
      command: externalPiCommand ?? process.execPath,
      args: externalPiCommand
        ? parseArgs(env.PI_RPC_ARGS, ["--mode", "rpc"])
        : [packagedPiRpcEntry, ...parseArgs(env.PI_RPC_ARGS, [])],
      cwdRoot,
      defaultCwd,
      ...(sessionDir ? { sessionDir: resolve(sessionDir) } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      startTimeoutMs: positiveInteger(env.PI_START_TIMEOUT_MS, 15_000, "PI_START_TIMEOUT_MS"),
      commandTimeoutMs: positiveInteger(env.PI_COMMAND_TIMEOUT_MS, 30_000, "PI_COMMAND_TIMEOUT_MS"),
      interruptTimeoutMs: positiveInteger(env.PI_INTERRUPT_TIMEOUT_MS, 10_000, "PI_INTERRUPT_TIMEOUT_MS"),
      stopGraceMs: positiveInteger(env.PI_STOP_GRACE_MS, 2_000, "PI_STOP_GRACE_MS"),
    },
    maxActivePiProcesses: positiveInteger(env.MAX_ACTIVE_PI_PROCESSES, 8, "MAX_ACTIVE_PI_PROCESSES"),
    replayCapacity: positiveInteger(env.REPLAY_CAPACITY, 2_000, "REPLAY_CAPACITY"),
    conversationIdleTtlMs: positiveInteger(
      env.CONVERSATION_IDLE_TTL_MS,
      15 * 60_000,
      "CONVERSATION_IDLE_TTL_MS",
    ),
    maxFrameBytes: positiveInteger(env.MAX_FRAME_BYTES, 1_048_576, "MAX_FRAME_BYTES"),
    maxWsBufferedBytes: positiveInteger(
      env.MAX_WS_BUFFERED_BYTES,
      1_048_576,
      "MAX_WS_BUFFERED_BYTES",
    ),
    maxRpcPerMinute: positiveInteger(env.MAX_RPC_PER_MINUTE, 120, "MAX_RPC_PER_MINUTE"),
    wsHeartbeatMs: positiveInteger(env.WS_HEARTBEAT_MS, 30_000, "WS_HEARTBEAT_MS"),
    exposeThinking: env.EXPOSE_THINKING === "true",
  };
}
