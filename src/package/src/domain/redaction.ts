const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|password|secret|token)/i;
const MAX_STRING_LENGTH = 65_536;
const MAX_DEPTH = 8;

export function redactForClient(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[内容层级过深]";
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[已截断]` : value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 1_000).map((entry) => redactForClient(entry, depth + 1));
  if (typeof value !== "object") return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 1_000)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[已脱敏]" : redactForClient(entry, depth + 1);
  }
  return output;
}
