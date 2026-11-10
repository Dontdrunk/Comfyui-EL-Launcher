import type { LogLevel } from "./types.ts";

export function classifyLogLevel(
  text: string,
  explicit?: LogLevel,
  previous?: LogLevel
): LogLevel;
