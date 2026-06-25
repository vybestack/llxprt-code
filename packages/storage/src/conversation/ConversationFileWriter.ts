/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { StorageLogger } from '../types/logger.js';
import { NullStorageLoggerImpl } from '../types/logger.js';

function defaultConversationLogPath(): string {
  return path.join(os.homedir(), '.llxprt', 'conversations');
}

function resolveConversationLogPath(logPath?: string): string {
  if (logPath === undefined || logPath === '') {
    return defaultConversationLogPath();
  }
  return logPath;
}

export class ConversationFileWriter {
  private logPath: string;
  private currentLogFile: string;
  private logger: StorageLogger;

  constructor(logPath?: string, logger?: StorageLogger) {
    this.logPath = resolveConversationLogPath(logPath);
    this.currentLogFile = path.join(
      this.logPath,
      `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
    );
    this.logger = logger ?? new NullStorageLoggerImpl();
  }

  async writeEntry(entry: Record<string, unknown>): Promise<void> {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      };
      const line = JSON.stringify(logEntry) + '\n';
      await fsp.mkdir(this.logPath, { recursive: true });
      await fsp.appendFile(this.currentLogFile, line);
    } catch (error) {
      this.logger.error('Failed to write log entry:', error);
    }
  }

  async writeRequest(
    provider: string,
    messages: unknown[],
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeEntry({
      type: 'request',
      provider,
      messages,
      context,
    });
  }

  async writeResponse(
    provider: string,
    response: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeEntry({
      type: 'response',
      provider,
      response,
      metadata,
    });
  }

  async writeToolCall(
    provider: string,
    toolName: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeEntry({
      type: 'tool_call',
      provider,
      tool: toolName,
      ...context,
    });
  }
}

// Singleton instance
let fileWriter: ConversationFileWriter | null = null;

/**
 * Returns the process-wide ConversationFileWriter singleton.
 *
 * First-call-wins: the `logPath` provided on the first invocation determines
 * the writer's output directory for the lifetime of the process. Subsequent
 * calls return the same instance and IGNORE any `logPath` argument. To target
 * a different path (e.g. in tests), call
 * {@link resetConversationFileWriterForTesting} first.
 */
export function getConversationFileWriter(
  logPath?: string,
): ConversationFileWriter {
  fileWriter ??= new ConversationFileWriter(logPath);
  return fileWriter;
}

export function resetConversationFileWriterForTesting(): void {
  fileWriter = null;
}
