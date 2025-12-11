/**
 * Lightweight logger for nui.
 * API compatible with @llxprt-code/core DebugLogger for future replacement.
 * Currently logs to file, can be extended to use opentui's console capture.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR = join(homedir(), '.llxprt', 'nuilog');
const LOG_FILE = join(LOG_DIR, 'nui.log');

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Ignore errors - logging is best-effort
}

type LogLevel = 'debug' | 'log' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  namespace: string;
  level: LogLevel;
  message: string;
  args?: unknown[];
}

function formatEntry(entry: LogEntry): string {
  const argsStr =
    entry.args !== undefined && entry.args.length > 0
      ? ` ${JSON.stringify(entry.args)}`
      : '';
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.namespace}] ${entry.message}${argsStr}`;
}

function writeLog(entry: LogEntry): void {
  try {
    appendFileSync(LOG_FILE, formatEntry(entry) + '\n', 'utf8');
  } catch {
    // Ignore write errors - logging is best-effort
  }
}

export class Logger {
  private _namespace: string;
  private _enabled = true;

  constructor(namespace: string) {
    this._namespace = namespace;
  }

  get namespace(): string {
    return this._namespace;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  private logAtLevel(level: LogLevel, message: string, args: unknown[]): void {
    if (!this._enabled) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      namespace: this._namespace,
      level,
      message,
      args: args.length > 0 ? args : undefined,
    };

    writeLog(entry);
  }

  debug(message: string, ...args: unknown[]): void {
    this.logAtLevel('debug', message, args);
  }

  log(message: string, ...args: unknown[]): void {
    this.logAtLevel('log', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.logAtLevel('warn', message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.logAtLevel('error', message, args);
  }
}

// Singleton loggers by namespace
const loggers = new Map<string, Logger>();

export function getLogger(namespace: string): Logger {
  let logger = loggers.get(namespace);
  if (logger === undefined) {
    logger = new Logger(namespace);
    loggers.set(namespace, logger);
  }
  return logger;
}
