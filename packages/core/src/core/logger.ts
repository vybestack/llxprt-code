/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ensureDir } from '../utils/paths.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { debugLogger } from '../utils/debugLogger.js';

const LOG_FILE_NAME = 'logs.json';

export enum MessageSenderType {
  USER = 'user',
}

export interface LogEntry {
  sessionId: string;
  messageId: number;
  timestamp: string;
  type: MessageSenderType;
  message: string;
}

function isValidLogEntry(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object') {
    return false;
  }
  const e = entry as Record<string, unknown>;
  if (
    typeof e.sessionId !== 'string' ||
    typeof e.messageId !== 'number' ||
    typeof e.timestamp !== 'string'
  ) {
    return false;
  }
  return typeof e.type === 'string' && typeof e.message === 'string';
}

export class Logger {
  private logFilePath: string | undefined;
  private sessionId: string | undefined;
  private messageId = 0; // Instance-specific counter for the next messageId
  private initialized = false;
  private logs: LogEntry[] = []; // In-memory cache, ideally reflects the last known state of the file

  constructor(
    sessionId: string,
    private readonly storage: Storage,
  ) {
    this.sessionId = sessionId;
  }

  private async _readLogFile(): Promise<LogEntry[]> {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during read attempt.');
    }
    try {
      const fileContent = await fs.readFile(this.logFilePath, 'utf-8');
      const parsedLogs = JSON.parse(fileContent);
      if (!Array.isArray(parsedLogs)) {
        debugLogger.debug(
          `Log file at ${this.logFilePath} is not a valid JSON array. Starting with empty logs.`,
        );
        await this._backupCorruptedLogFile('malformed_array');
        return [];
      }
      return parsedLogs.filter(isValidLogEntry) as LogEntry[];
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return [];
      }
      if (error instanceof SyntaxError) {
        debugLogger.debug(
          `Invalid JSON in log file ${this.logFilePath}. Backing up and starting fresh.`,
          error,
        );
        await this._backupCorruptedLogFile('invalid_json');
        return [];
      }
      debugLogger.debug(
        `Failed to read or parse log file ${this.logFilePath}:`,
        error,
      );
      throw error;
    }
  }

  private async _backupCorruptedLogFile(reason: string): Promise<void> {
    if (!this.logFilePath) return;
    const backupPath = `${this.logFilePath}.${reason}.${Date.now()}.bak`;
    try {
      await fs.rename(this.logFilePath, backupPath);
      debugLogger.debug(`Backed up corrupted log file to ${backupPath}`);
    } catch {
      // Rename failed (e.g., file doesn't exist); primary error already handled.
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    ensureDir(Storage.getGlobalLogDir());
    const llxprtDir = this.storage.getProjectTempDir();
    this.logFilePath = path.join(llxprtDir, LOG_FILE_NAME);

    try {
      await fs.mkdir(llxprtDir, { recursive: true });
      let fileExisted = true;
      try {
        await fs.access(this.logFilePath);
      } catch {
        // File doesn't exist yet.
        fileExisted = false;
      }
      this.logs = await this._readLogFile();
      if (!fileExisted && this.logs.length === 0) {
        await fs.writeFile(this.logFilePath, '[]', 'utf-8');
      }
      const sessionLogs = this.logs.filter(
        (entry) => entry.sessionId === this.sessionId,
      );
      this.messageId =
        sessionLogs.length > 0
          ? Math.max(...sessionLogs.map((entry) => entry.messageId)) + 1
          : 0;
      this.initialized = true;
    } catch (err) {
      debugLogger.error('Failed to initialize logger:', err);
      this.initialized = false;
    }
  }

  private async _updateLogFile(
    entryToAppend: LogEntry,
  ): Promise<LogEntry | null> {
    if (!this.logFilePath) {
      debugLogger.debug('Log file path not set. Cannot persist log entry.');
      throw new Error('Log file path not set during update attempt.');
    }

    let currentLogsOnDisk: LogEntry[];
    try {
      currentLogsOnDisk = await this._readLogFile();
    } catch (readError) {
      debugLogger.debug(
        'Critical error reading log file before append:',
        readError,
      );
      throw readError;
    }

    // Determine the correct messageId for the new entry based on current disk state for its session
    const sessionLogsOnDisk = currentLogsOnDisk.filter(
      (e) => e.sessionId === entryToAppend.sessionId,
    );
    const nextMessageIdForSession =
      sessionLogsOnDisk.length > 0
        ? Math.max(...sessionLogsOnDisk.map((e) => e.messageId)) + 1
        : 0;

    // Update the messageId of the entry we are about to append
    entryToAppend.messageId = nextMessageIdForSession;

    // Check if this entry (same session, same *recalculated* messageId, same content) might already exist
    // This is a stricter check for true duplicates if multiple instances try to log the exact same thing
    // at the exact same calculated messageId slot.
    const entryExists = currentLogsOnDisk.some(
      (e) =>
        e.sessionId === entryToAppend.sessionId &&
        e.messageId === entryToAppend.messageId &&
        e.timestamp === entryToAppend.timestamp && // Timestamps are good for distinguishing
        e.message === entryToAppend.message,
    );

    if (entryExists) {
      debugLogger.debug(
        `Duplicate log entry detected and skipped: session ${entryToAppend.sessionId}, messageId ${entryToAppend.messageId}`,
      );
      this.logs = currentLogsOnDisk; // Ensure in-memory is synced with disk
      return null; // Indicate that no new entry was actually added
    }

    currentLogsOnDisk.push(entryToAppend);

    try {
      await fs.writeFile(
        this.logFilePath,
        JSON.stringify(currentLogsOnDisk, null, 2),
        'utf-8',
      );
      this.logs = currentLogsOnDisk;
      return entryToAppend; // Return the successfully appended entry
    } catch (error) {
      debugLogger.debug('Error writing to log file:', error);
      throw error;
    }
  }

  async getPreviousUserMessages(): Promise<string[]> {
    if (!this.initialized) return [];
    const logsWithPersistedTypes: Array<
      Omit<LogEntry, 'type'> & { type: string }
    > = this.logs;
    return logsWithPersistedTypes
      .filter((entry) => entry.type === MessageSenderType.USER)
      .sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return dateB - dateA;
      })
      .map((entry) => entry.message);
  }

  async logMessage(type: MessageSenderType, message: string): Promise<void> {
    if (!this.initialized || this.sessionId === undefined) {
      debugLogger.debug(
        'Logger not initialized or session ID missing. Cannot log message.',
      );
      return;
    }

    // The messageId used here is the instance's idea of the next ID.
    // _updateLogFile will verify and potentially recalculate based on the file's actual state.
    const newEntryObject: LogEntry = {
      sessionId: this.sessionId,
      messageId: this.messageId, // This will be recalculated in _updateLogFile
      type,
      message,
      timestamp: new Date().toISOString(),
    };

    try {
      const writtenEntry = await this._updateLogFile(newEntryObject);
      if (writtenEntry) {
        // If an entry was actually written (not a duplicate skip),
        // then this instance can increment its idea of the next messageId for this session.
        this.messageId = writtenEntry.messageId + 1;
      }
    } catch {
      // Error already logged by _updateLogFile or _readLogFile.
    }
  }

  close(): void {
    this.initialized = false;
    this.logFilePath = undefined;
    this.logs = [];
    this.sessionId = undefined;
    this.messageId = 0;
  }
}
