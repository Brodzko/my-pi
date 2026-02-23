import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, type DebugLevel } from "./config";

const LOG_DIR = ".brodzko/logs";
const LOG_FILE = "get-diagnostics.log";

/** Higher number = more verbose. "off" = nothing written. */
const LEVEL_RANK: Record<DebugLevel, number> = {
  off: 0,
  error: 1,
  info: 2,
  verbose: 3,
};

/**
 * Infer log level from the source/message.
 * Providers that report errors/timeouts → "error".
 * Most operational messages → "info".
 * Detailed tracing (resolve, glob, prewarm, sync) → "verbose".
 */
const inferLevel = (source: string, message: string): DebugLevel => {
  const lower = message.toLowerCase();
  if (lower.includes("error") || lower.includes("timeout") || lower.includes("rejected"))
    return "error";
  if (
    lower.includes("resolve") ||
    lower.includes("glob") ||
    lower.includes("prewarm") ||
    lower.includes("sync")
  )
    return "verbose";
  return "info";
};

let stream: fs.WriteStream | undefined;
let configLevel: DebugLevel | undefined;
let buffer: string[] = [];
let initialized = false;

const getLevel = (): DebugLevel => {
  if (configLevel === undefined) configLevel = loadConfig().debugLevel;
  return configLevel;
};

const timestamp = (): string => new Date().toISOString().slice(11, 23);

const formatLine = (source: string, message: string, data?: Record<string, unknown>): string =>
  data
    ? `[${timestamp()}] [${source}] ${message} ${JSON.stringify(data)}`
    : `[${timestamp()}] [${source}] ${message}`;

/**
 * Initialize the logger with a project cwd.
 * Creates `.brodzko/logs/` if needed and opens the log stream.
 * Flushes any buffered messages from before initialization.
 */
export const initLog = (cwd: string): void => {
  if (initialized) return;

  const level = getLevel();
  if (level === "off") {
    buffer = [];
    initialized = true;
    return;
  }

  const logDir = path.join(cwd, LOG_DIR);
  fs.mkdirSync(logDir, { recursive: true });

  const logPath = path.join(logDir, LOG_FILE);
  stream = fs.createWriteStream(logPath, { flags: "w" });
  initialized = true;

  // Flush buffered messages
  for (const line of buffer) {
    stream.write(line + "\n");
  }
  buffer = [];
};

export const log = (source: string, message: string, data?: Record<string, unknown>): void => {
  const level = getLevel();
  if (level === "off") return;

  const msgLevel = inferLevel(source, message);
  if (LEVEL_RANK[msgLevel] > LEVEL_RANK[level]) return;

  const line = formatLine(source, message, data);

  if (!initialized) {
    // Buffer until initLog(cwd) is called
    buffer.push(line);
    return;
  }

  stream?.write(line + "\n");
};

export const closeLog = (): void => {
  stream?.end();
  stream = undefined;
  configLevel = undefined;
  buffer = [];
  initialized = false;
};
