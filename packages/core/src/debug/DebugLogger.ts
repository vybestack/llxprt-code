/**
 * @plan PLAN-20250120-DEBUGLOGGING.P05
 * @requirement REQ-001,REQ-002,REQ-006
 * @pseudocode lines 10-121
 */
import createDebug from 'debug';
import type { Debugger } from 'debug';
import { ConfigurationManager } from './ConfigurationManager.js';
import { FileOutput } from './FileOutput.js';
import type { LogEntry } from './types.js';

// Configure debug to use console.log instead of stderr for React UI compatibility
// This ensures debug output goes to the Ctrl+O debug console in the UI
if (typeof window === 'undefined') {
  // Disable colors to respect theme settings
  (createDebug as unknown as { useColors: () => boolean }).useColors = () =>
    false;

  // Use a wrapper function that calls the CURRENT console.log
  // This works even if console.log is patched later by the UI
  createDebug.log = (...args: unknown[]) => {
    // Call whatever console.log is at the time of logging
    // This allows the UI's ConsolePatcher to intercept it
    console.log(...args);
  };
}

export class DebugLogger {
  // Add static registry for singleton-per-namespace pattern
  private static instances: Map<string, DebugLogger> = new Map();

  private debugInstance: Debugger; // Line 11
  private _namespace: string; // Line 12
  private _configManager: ConfigurationManager; // Line 13
  private _fileOutput: FileOutput; // Line 14
  private _enabled: boolean; // Line 15
  private _level: string = 'debug';
  private boundOnConfigChange: () => void; // Store bound reference for unsubscribe

  /**
   * Factory method to get or create a DebugLogger for a namespace.
   * Returns cached instance if one exists, ensuring singleton-per-namespace.
   */
  static getLogger(namespace: string): DebugLogger {
    let logger = DebugLogger.instances.get(namespace);
    if (!logger) {
      logger = new DebugLogger(namespace);
      DebugLogger.instances.set(namespace, logger);
    }
    return logger;
  }

  /**
   * Dispose all cached logger instances.
   * Call this in test cleanup or application shutdown.
   */
  static disposeAll(): void {
    for (const logger of DebugLogger.instances.values()) {
      logger._configManager.unsubscribe(logger.boundOnConfigChange);
    }
    DebugLogger.instances.clear();
  }

  /**
   * Reset for testing - clears instances without unsubscribing
   * (use disposeAll in production)
   */
  static resetForTesting(): void {
    DebugLogger.instances.clear();
  }

  constructor(namespace: string) {
    // Lines 17-24: Initialize logger
    this._namespace = namespace; // Line 18
    this.debugInstance = createDebug(namespace); // Line 19
    this._configManager = ConfigurationManager.getInstance(); // Line 20
    this._fileOutput = FileOutput.getInstance(); // Line 21
    this._enabled = this.checkEnabled(); // Line 22
    // Store bound reference so we can unsubscribe later
    this.boundOnConfigChange = () => this.onConfigChange();
    this._configManager.subscribe(this.boundOnConfigChange);
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

  get level(): string {
    return this._level;
  }

  set level(value: string) {
    this._level = value;
  }

  get configManager(): ConfigurationManager {
    return this._configManager;
  }

  get fileOutput(): FileOutput {
    return this._fileOutput;
  }

  log(messageOrFn: string | (() => string), ...args: unknown[]): void {
    // Lines 26-60: Main log method
    if (!this._enabled) {
      // Line 27-29
      return; // Zero overhead - no processing when disabled
    }

    let message: string;
    if (typeof messageOrFn === 'function') {
      // Line 32
      try {
        message = messageOrFn(); // Line 34
      } catch (_error) {
        message = '[Error evaluating log function]'; // Line 36
      }
    } else {
      message = messageOrFn; // Line 39
    }

    message = this.redactSensitive(message); // Line 42
    const timestamp = new Date().toISOString(); // Line 43

    const logEntry: LogEntry = {
      // Lines 45-51
      timestamp,
      namespace: this._namespace,
      level: 'log',
      message,
      args: args.length > 0 ? args : undefined,
      runId: this._fileOutput.runId,
      pid: process.pid,
    };

    const target = this._configManager.getOutputTarget();
    if (target.includes('file')) {
      // Line 53-55
      void this._fileOutput.write(logEntry);
    }

    if (target.includes('stderr')) {
      // Line 57-59
      this.debugInstance(message, ...args);
    }
  }

  debug(messageOrFn: string | (() => string), ...args: unknown[]): void {
    // Lines 62-64
    if (this._level === 'error') {
      return; // Don't log debug messages when level is error
    }

    // Create modified log entry with debug level
    if (!this._enabled) {
      return;
    }

    let message: string;
    if (typeof messageOrFn === 'function') {
      try {
        message = messageOrFn();
      } catch (_error) {
        message = '[Error evaluating log function]';
      }
    } else {
      message = messageOrFn;
    }

    message = this.redactSensitive(message);
    const timestamp = new Date().toISOString();

    const logEntry: LogEntry = {
      timestamp,
      namespace: this._namespace,
      level: 'debug',
      message,
      args: args.length > 0 ? args : undefined,
      runId: this._fileOutput.runId,
      pid: process.pid,
    };

    const target = this._configManager.getOutputTarget();
    if (target.includes('file')) {
      void this._fileOutput.write(logEntry);
    }

    if (target.includes('stderr')) {
      this.debugInstance(message, ...args);
    }
  }

  warn(messageOrFn: string | (() => string), ...args: unknown[]): void {
    // Use warn level for warnings
    this._logWithLevel('warn', messageOrFn, ...args);
  }

  private _logWithLevel(
    level: 'warn' | 'error',
    messageOrFn: string | (() => string),
    ...args: unknown[]
  ): void {
    if (!this._enabled) {
      return;
    }

    let message: string;
    if (typeof messageOrFn === 'function') {
      try {
        message = messageOrFn();
      } catch (_error) {
        message = '[Error evaluating log function]';
      }
    } else {
      message = messageOrFn;
    }

    message = this.redactSensitive(message);
    const timestamp = new Date().toISOString();

    const logEntry: LogEntry = {
      timestamp,
      namespace: this._namespace,
      level,
      message,
      args: args.length > 0 ? args : undefined,
      runId: this._fileOutput.runId,
      pid: process.pid,
    };

    const target = this._configManager.getOutputTarget();
    if (target.includes('file')) {
      void this._fileOutput.write(logEntry);
    }

    if (target.includes('stderr')) {
      this.debugInstance(message, ...args);
    }
  }

  error(messageOrFn: string | (() => string), ...args: unknown[]): void {
    this._logWithLevel('error', messageOrFn, ...args);
  }

  checkEnabled(): boolean {
    // Lines 72-85: Check if logger enabled
    const config = this._configManager.getEffectiveConfig(); // Line 73
    if (!config.enabled) {
      // Line 74-76
      return false;
    }

    // Handle namespaces as either array or object
    const namespaces = Array.isArray(config.namespaces)
      ? config.namespaces
      : Object.keys(config.namespaces);

    for (const pattern of namespaces) {
      // Line 78-82
      if (this.matchesPattern(this._namespace, pattern)) {
        return true;
      }
    }

    return false; // Line 84
  }

  private matchesPattern(namespace: string, pattern: string): boolean {
    // Lines 87-98: Pattern matching
    if (pattern === namespace) {
      // Line 88-90
      return true;
    }

    // Support wildcards anywhere in the pattern
    if (pattern.includes('*')) {
      // Convert pattern to regex:
      // - Escape special regex chars except *
      // - Replace * with .* for regex wildcard matching
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
        .replace(/\*/g, '.*'); // Convert * to regex wildcard

      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(namespace);
    }

    return false; // Line 97
  }

  private redactSensitive(message: string): string {
    // Lines 100-110: Redact sensitive data
    const patterns = this._configManager.getRedactPatterns(); // Line 101
    let result = message; // Line 102

    for (const pattern of patterns) {
      // Line 104-107
      const regex = new RegExp(`${pattern}["']?:\\s*["']?([^"'\\s]+)`, 'gi');
      result = result.replace(regex, `${pattern}: [REDACTED]`);
    }

    return result; // Line 109
  }

  private onConfigChange(): void {
    // Lines 112-114
    this._enabled = this.checkEnabled();
  }

  async dispose(): Promise<void> {
    // Unsubscribe using the bound reference
    this._configManager.unsubscribe(this.boundOnConfigChange);
    // Remove from registry if present
    if (DebugLogger.instances.get(this._namespace) === this) {
      DebugLogger.instances.delete(this._namespace);
    }
    await this._fileOutput.dispose();
  }
}
