/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fsp } from 'fs';
import * as path from 'path';
import type { StorageLogger } from '../types/logger.js';
import { NullStorageLoggerImpl } from '../types/logger.js';
import { Storage } from '../config/storage.js';

function defaultConversationLogPath(): string {
  return path.join(Storage.getGlobalDataDir(), 'conversations');
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
  private writeChain: Promise<void> = Promise.resolve();

  constructor(logPath?: string, logger?: StorageLogger) {
    this.logPath = resolveConversationLogPath(logPath);
    this.currentLogFile = path.join(
      this.logPath,
      `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
    );
    this.logger = logger ?? new NullStorageLoggerImpl();
  }

  async writeEntry(entry: Record<string, unknown>): Promise<void> {
    // Serialize writes through a per-instance chain so concurrent callers
    // append in invocation order, preserving the guarantee the synchronous
    // implementation had implicitly. The trailing .catch() guarantees the
    // chain and the returned promise never reject — a throwing logger or a
    // filesystem error cannot poison subsequent writes.
    this.writeChain = this.writeChain
      .then(() => this.appendEntry(entry))
      .catch(() => {});
    return this.writeChain;
  }

  private async appendEntry(entry: Record<string, unknown>): Promise<void> {
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

/** Create a conversation file writer bound to the caller's log directory. */
export function getConversationFileWriter(
  logPath?: string,
): ConversationFileWriter {
  return new ConversationFileWriter(logPath);
}
