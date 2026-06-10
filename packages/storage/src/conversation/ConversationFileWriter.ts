/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { StorageLogger } from '../types/logger.js';
import { NullStorageLoggerImpl } from '../types/logger.js';

export class ConversationFileWriter {
  private logPath: string;
  private currentLogFile: string;
  private logger: StorageLogger;

  constructor(logPath?: string, logger?: StorageLogger) {
    this.logPath =
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty logPath string should fall through to default path
      logPath || path.join(os.homedir(), '.llxprt', 'conversations');
    this.currentLogFile = path.join(
      this.logPath,
      `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
    );
    this.logger = logger ?? new NullStorageLoggerImpl();
  }

  writeEntry(entry: Record<string, unknown>): void {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      };
      const line = JSON.stringify(logEntry) + '\n';
      fs.mkdirSync(this.logPath, { recursive: true });
      fs.appendFileSync(this.currentLogFile, line);
    } catch (error) {
      this.logger.error('Failed to write log entry:', error);
    }
  }

  writeRequest(
    provider: string,
    messages: unknown[],
    context?: Record<string, unknown>,
  ): void {
    this.writeEntry({
      type: 'request',
      provider,
      messages,
      context,
    });
  }

  writeResponse(
    provider: string,
    response: unknown,
    metadata?: Record<string, unknown>,
  ): void {
    this.writeEntry({
      type: 'response',
      provider,
      response,
      metadata,
    });
  }

  writeToolCall(
    provider: string,
    toolName: string,
    context?: Record<string, unknown>,
  ): void {
    this.writeEntry({
      type: 'tool_call',
      provider,
      tool: toolName,
      ...context,
    });
  }
}

// Singleton instance
let fileWriter: ConversationFileWriter | null = null;

export function getConversationFileWriter(
  logPath?: string,
): ConversationFileWriter {
  fileWriter ??= new ConversationFileWriter(logPath);
  return fileWriter;
}

export function resetConversationFileWriterForTesting(): void {
  fileWriter = null;
}
