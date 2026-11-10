/**
 * 日志级别判定（纯逻辑，方便单测）。
 *
 * 原则：级别看内容/调用方，不看输出通道。Python 的 logging 默认把
 * INFO/WARNING/ERROR 全写到 stderr，pip/git 的进度也走 stderr——
 * 把 stderr 当错误会把普通日志整屏染红。
 */

const LEVELS = new Set(["debug", "info", "success", "warn", "error"]);

const BRACKET_LEVEL =
  /^\s*\[(TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|CRITICAL|FATAL)\]/iu;
const PREFIX_LEVEL =
  /^\s*(TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|CRITICAL|FATAL)\s*:/iu;
const TRACEBACK = /^\s*Traceback \(most recent call last\)/iu;
const TRACEBACK_FILE = /^\s*File ".*", line \d+/u;
const EXCEPTION_LINE =
  /^\s*(?:[A-Za-z_][\w.]*)?(?:Error|Exception|BaseException)\s*:/u;
const EXCEPTION_CHAIN =
  /^\s*(?:During handling of the above exception|The above exception was the direct cause)/iu;
const PY_EXCEPTION_HEAD = /^\s*!!!\s*(?:Exception|Error)/iu;
const SUCCESS_LINE = /^\s*Successfully installed\b/iu;
const LAUNCHER_ERROR =
  /^\[(?:启动器|任务|环境)\].*(?:失败|错误|异常|超时|未通过)/u;
const LAUNCHER_WARN = /^\[任务\]\s*已取消/u;
const LAUNCHER_SUCCESS = /^\[任务\]\s*完成/u;

const BRACKET_TO_LEVEL = {
  TRACE: "debug",
  DEBUG: "debug",
  INFO: "info",
  NOTICE: "info",
  WARNING: "warn",
  WARN: "warn",
  ERROR: "error",
  CRITICAL: "error",
  FATAL: "error",
};

/**
 * @param {string} text
 * @param {"debug"|"info"|"success"|"warn"|"error"|undefined} explicit 写入方显式指定的级别
 * @param {"debug"|"info"|"success"|"warn"|"error"|undefined} previous 上一条的级别（traceback 续行用）
 */
export function classifyLogLevel(text, explicit, previous) {
  if (explicit && LEVELS.has(explicit)) {
    return explicit;
  }

  const bracket = BRACKET_LEVEL.exec(text);

  if (bracket) {
    return BRACKET_TO_LEVEL[bracket[1].toUpperCase()] ?? "info";
  }

  const prefix = PREFIX_LEVEL.exec(text);

  if (prefix) {
    return BRACKET_TO_LEVEL[prefix[1].toUpperCase()] ?? "info";
  }

  if (
    TRACEBACK.test(text) ||
    TRACEBACK_FILE.test(text) ||
    EXCEPTION_LINE.test(text) ||
    EXCEPTION_CHAIN.test(text) ||
    PY_EXCEPTION_HEAD.test(text) ||
    LAUNCHER_ERROR.test(text)
  ) {
    return "error";
  }
  if (LAUNCHER_WARN.test(text)) {
    return "warn";
  }
  if (LAUNCHER_SUCCESS.test(text) || SUCCESS_LINE.test(text)) {
    return "success";
  }

  // traceback 的缩进续行继承上一条的级别（File/raise/异常详情等）
  if (
    previous !== undefined &&
    (previous === "error" || previous === "warn") &&
    /^\s{2,}\S/u.test(text)
  ) {
    return previous;
  }

  return "info";
}
