import { randomUUID } from "node:crypto";

export type PublicErrorCode =
  | "INVALID_PARAMS"
  | "UNAUTHORIZED"
  | "CONVERSATION_NOT_FOUND"
  | "RUN_ALREADY_ACTIVE"
  | "RUN_NOT_ACTIVE"
  | "COMMAND_CONFLICT"
  | "PI_UNAVAILABLE"
  | "PI_COMMAND_TIMEOUT"
  | "INTERRUPT_TIMEOUT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface PublicError {
  code: PublicErrorCode;
  message: string;
  retryable: boolean;
  traceId: string;
  details?: Record<string, unknown>;
}

const SAFE_MESSAGES: Record<PublicErrorCode, string> = {
  INVALID_PARAMS: "请求参数不合法",
  UNAUTHORIZED: "未通过身份认证或无权访问该资源",
  CONVERSATION_NOT_FOUND: "对话不存在",
  RUN_ALREADY_ACTIVE: "该对话已有正在执行的任务",
  RUN_NOT_ACTIVE: "目标任务不是当前活动任务",
  COMMAND_CONFLICT: "命令与当前对话状态冲突",
  PI_UNAVAILABLE: "Pi 运行时暂不可用",
  PI_COMMAND_TIMEOUT: "Pi 命令响应超时",
  INTERRUPT_TIMEOUT: "等待 Pi 确认中断超时",
  RATE_LIMITED: "请求过于频繁",
  INTERNAL_ERROR: "服务内部错误",
};

export class DomainError extends Error {
  readonly publicError: PublicError;

  constructor(
    code: PublicErrorCode,
    options: { retryable?: boolean; traceId?: string; details?: Record<string, unknown> } = {},
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "DomainError";
    this.publicError = {
      code,
      message: SAFE_MESSAGES[code],
      retryable: options.retryable ?? false,
      traceId: options.traceId ?? randomUUID(),
      ...(options.details ? { details: options.details } : {}),
    };
  }
}

export function publicErrorFrom(error: unknown, fallback: PublicErrorCode = "INTERNAL_ERROR"): PublicError {
  if (error instanceof DomainError) return error.publicError;
  return new DomainError(fallback, { retryable: fallback !== "INVALID_PARAMS" }).publicError;
}
