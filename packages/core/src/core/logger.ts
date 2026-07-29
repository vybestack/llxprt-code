/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import {
  promises as fs,
  readFileSync,
  writeFileSync,
  appendFileSync,
  renameSync,
} from 'node:fs';
import { ensureDir } from '../utils/paths.js';
import type { EmojiFilter } from '../filters/EmojiFilter.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { debugLogger } from '../utils/debugLogger.js';

const LOG_FILE_NAME = 'logs.json';

/**
 * Structural shapes for checkpoint (de)serialization. Checkpoints are stored
 * as JSON and round-tripped through ContentConverters at the provider
 * boundary, so these intentionally operate on the legacy Google-shaped
 * `Content`/`Part` wire structure without importing @google/genai.
 */
interface CheckpointPart {
  text?: string;
  [key: string]: unknown;
}

export interface CheckpointContent {
  role?: string;
  parts?: CheckpointPart[];
  [key: string]: unknown;
}

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

function isValidLogEntry(entry: unknown): entry is LogEntry {
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

// This regex matches any character that is NOT a letter (a-z, A-Z),
// a number (0-9), a hyphen (-), an underscore (_), or a dot (.).

/**
 * Encodes a string to be safe for use as a filename.
 *
 * It replaces any characters that are not alphanumeric or one of `_`, `-`, `.`
 * with a URL-like percent-encoding (`%` followed by the 2-digit hex code).
 *
 * @param str The input string to encode.
 * @returns The encoded, filename-safe string.
 */
export function encodeTagName(str: string): string {
  return encodeURIComponent(str);
}

/**
 * Decodes a string that was encoded with the `encode` function.
 *
 * It finds any percent-encoded characters and converts them back to their
 * original representation.
 *
 * @param str The encoded string to decode.
 * @returns The decoded, original string.
 */
export function decodeTagName(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    // Malformed encoding; use fallback decoder.
    return str.replace(/%([0-9A-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
}

export class Logger {
  private llxprtDir: string | undefined;
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

  private _parseLegacyJsonArray(trimmed: string): LogEntry[] | null {
    if (!trimmed.startsWith('[')) {
      return null;
    }
    try {
      const parsedLogs: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsedLogs)) {
        return parsedLogs.filter(isValidLogEntry);
      }
    } catch {
      // Fall through to JSONL handling / corruption backup below.
    }
    return null;
  }

  private _parseJsonl(trimmed: string): LogEntry[] {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isValidLogEntry);
  }

  private _toJsonl(entries: LogEntry[]): string {
    return entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  }

  private _readLogFileSync(): LogEntry[] {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during read attempt.');
    }
    try {
      const fileContent = readFileSync(this.logFilePath, 'utf-8');
      const trimmed = fileContent.trim();
      if (trimmed.length === 0) {
        return [];
      }
      const legacy = this._parseLegacyJsonArray(trimmed);
      if (legacy !== null) {
        return legacy;
      }
      return this._parseJsonl(trimmed);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return [];
      }
      if (error instanceof SyntaxError) {
        debugLogger.debug(
          `Invalid JSON line in log file ${this.logFilePath}. Backing up and starting fresh.`,
          error,
        );
        this._backupCorruptedLogFileSync('malformed_line');
        return [];
      }
      throw error;
    }
  }

  private _writeJsonlSync(entries: LogEntry[]): void {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during write attempt.');
    }
    writeFileSync(this.logFilePath, this._toJsonl(entries), 'utf-8');
  }

  private _appendJsonlSync(entry: LogEntry): void {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during append attempt.');
    }
    appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  private _backupCorruptedLogFileSync(reason: string): void {
    if (!this.logFilePath) return;
    const backupPath = `${this.logFilePath}.${reason}.${Date.now()}.bak`;
    try {
      renameSync(this.logFilePath, backupPath);
      debugLogger.debug(`Backed up corrupted log file to ${backupPath}`);
    } catch {
      // Rename failed (e.g., file doesn't exist); primary error already handled.
    }
  }

  private _isLegacyFormat(): boolean {
    if (!this.logFilePath) {
      return false;
    }
    try {
      const content = readFileSync(this.logFilePath, 'utf-8');
      return content.trim().startsWith('[');
    } catch {
      return false;
    }
  }

  private _migrateLegacyToJsonl(): void {
    if (!this.logFilePath) {
      return;
    }
    const entries = this._readLogFileSync();
    this._writeJsonlSync(entries);
  }

  private _updateLogFileSync(entryToAppend: LogEntry): LogEntry | null {
    if (!this.logFilePath) {
      debugLogger.debug('Log file path not set. Cannot persist log entry.');
      throw new Error('Log file path not set during update attempt.');
    }

    if (this._isLegacyFormat()) {
      this._migrateLegacyToJsonl();
    }

    const currentLogsOnDisk = this._readLogFileSync();

    const sessionLogsOnDisk = currentLogsOnDisk.filter(
      (e) => e.sessionId === entryToAppend.sessionId,
    );
    const nextMessageIdForSession =
      sessionLogsOnDisk.length > 0
        ? Math.max(...sessionLogsOnDisk.map((e) => e.messageId)) + 1
        : 0;

    entryToAppend.messageId = nextMessageIdForSession;

    const entryExists = currentLogsOnDisk.some(
      (e) =>
        e.sessionId === entryToAppend.sessionId &&
        e.messageId === entryToAppend.messageId &&
        e.timestamp === entryToAppend.timestamp &&
        e.message === entryToAppend.message,
    );

    if (entryExists) {
      debugLogger.debug(
        `Duplicate log entry detected and skipped: session ${entryToAppend.sessionId}, messageId ${entryToAppend.messageId}`,
      );
      this.logs = currentLogsOnDisk;
      return null;
    }

    this._appendJsonlSync(entryToAppend);
    currentLogsOnDisk.push(entryToAppend);
    this.logs = currentLogsOnDisk;
    return entryToAppend;
  }

  private _updateLogFile(entryToAppend: LogEntry): Promise<LogEntry | null> {
    try {
      return Promise.resolve(this._updateLogFileSync(entryToAppend));
    } catch (error) {
      debugLogger.debug('Error appending to log file:', error);
      return Promise.reject(error as Error);
    }
  }

  private async _readLogFile(): Promise<LogEntry[]> {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during read attempt.');
    }
    try {
      const fileContent = await fs.readFile(this.logFilePath, 'utf-8');
      const trimmed = fileContent.trim();
      if (trimmed.length === 0) {
        return [];
      }
      // Legacy format: a single pretty-printed JSON array (pre-JSONL).
      // Read-only tolerance so existing on-disk files keep working; new
      // writes always append JSONL lines.
      const legacy = this._parseLegacyJsonArray(trimmed);
      if (legacy !== null) {
        return legacy;
      }
      // JSONL format: one JSON object per line.
      try {
        return this._parseJsonl(trimmed);
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          debugLogger.debug(
            `Invalid JSON line in log file ${this.logFilePath}. Backing up and starting fresh.`,
            parseError,
          );
          await this._backupCorruptedLogFile('malformed_line');
          return [];
        }
        throw parseError;
      }
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
    this.llxprtDir = llxprtDir;
    this.logFilePath = path.join(llxprtDir, LOG_FILE_NAME);

    try {
      await fs.mkdir(llxprtDir, { recursive: true });
      this.logs = await this._readLogFile();
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

  private _checkpointPath(tag: string): string {
    if (tag.length === 0) {
      throw new Error('No checkpoint tag specified.');
    }
    if (!this.llxprtDir) {
      throw new Error('Checkpoint file path not set.');
    }
    // Encode the tag to handle all special characters safely.
    const encodedTag = encodeTagName(tag);
    return path.join(this.llxprtDir, `checkpoint-${encodedTag}.json`);
  }

  private async _getCheckpointPath(tag: string): Promise<string> {
    // 1. Check for the new encoded path first.
    const newPath = this._checkpointPath(tag);
    try {
      await fs.access(newPath);
      return newPath; // Found it, use the new path.
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        throw error; // A real error occurred, rethrow it.
      }
      // It was not found, so we'll check the old path next.
    }

    // 2. Fallback for backward compatibility: check for the old raw path.
    const oldPath = path.join(this.llxprtDir!, `checkpoint-${tag}.json`);
    try {
      await fs.access(oldPath);
      return oldPath; // Found it, use the old path.
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        throw error; // A real error occurred, rethrow it.
      }
    }

    // 3. If neither path exists, return the new encoded path as the canonical one.
    return newPath;
  }

  async saveCheckpoint(
    conversation: CheckpointContent[],
    tag: string,
    context?: object,
  ): Promise<void> {
    if (!this.initialized) {
      debugLogger.error(
        'Logger not initialized or checkpoint file path not set. Cannot save a checkpoint.',
      );
      return;
    }
    // Always save with the new encoded path.
    const path = this._checkpointPath(tag);
    try {
      const data = JSON.stringify({ history: conversation, context }, null, 2);
      await fs.writeFile(path, data, 'utf-8');
    } catch (error) {
      debugLogger.error('Error writing to checkpoint file:', error);
    }
  }

  async loadCheckpoint(
    tag: string,
    emojiFilter?: EmojiFilter,
  ): Promise<{
    history: CheckpointContent[];
    context?: object;
  }> {
    if (!this.initialized) {
      debugLogger.error(
        'Logger not initialized or checkpoint file path not set. Cannot load checkpoint.',
      );
      return { history: [] };
    }

    const path = await this._getCheckpointPath(tag);
    try {
      const fileContent = await fs.readFile(path, 'utf-8');
      let parsedContent = JSON.parse(fileContent);
      if (Array.isArray(parsedContent)) {
        // Backwards compatibility for old format
        parsedContent = { history: parsedContent as CheckpointContent[] };
      }

      // Apply emoji filtering if provided
      if (emojiFilter) {
        const filteredHistory = parsedContent.history.map(
          (item: CheckpointContent) => {
            const filteredItem = { ...item };
            if (Array.isArray(filteredItem.parts)) {
              filteredItem.parts = filteredItem.parts.map(
                (part: CheckpointPart) => filterPartText(part, emojiFilter),
              );
            }
            return filteredItem;
          },
        );
        parsedContent.history = filteredHistory;
      }

      return parsedContent as {
        history: CheckpointContent[];
        context?: object;
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        // This is okay, it just means the checkpoint doesn't exist in either format.
        return { history: [] };
      }
      debugLogger.error(
        `Failed to read or parse checkpoint file ${path}:`,
        error,
      );
      return { history: [] };
    }
  }

  async deleteCheckpoint(tag: string): Promise<boolean> {
    if (!this.initialized || !this.llxprtDir) {
      debugLogger.error(
        'Logger not initialized or checkpoint file path not set. Cannot delete checkpoint.',
      );
      return false;
    }

    let deletedSomething = false;

    // 1. Attempt to delete the new encoded path.
    const newPath = this._checkpointPath(tag);
    try {
      await fs.unlink(newPath);
      deletedSomething = true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        debugLogger.error(
          `Failed to delete checkpoint file ${newPath}:`,
          error,
        );
        throw error; // Rethrow unexpected errors
      }
      // It's okay if it doesn't exist.
    }

    // 2. Attempt to delete the old raw path for backward compatibility.
    const oldPath = path.join(this.llxprtDir, `checkpoint-${tag}.json`);
    if (newPath !== oldPath) {
      try {
        await fs.unlink(oldPath);
        deletedSomething = true;
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== 'ENOENT') {
          debugLogger.error(
            `Failed to delete checkpoint file ${oldPath}:`,
            error,
          );
          throw error; // Rethrow unexpected errors
        }
        // It's okay if it doesn't exist.
      }
    }

    return deletedSomething;
  }

  async checkpointExists(tag: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error(
        'Logger not initialized. Cannot check for checkpoint existence.',
      );
    }
    let filePath: string | undefined;
    try {
      filePath = await this._getCheckpointPath(tag);
      // We need to check for existence again, because _getCheckpointPath
      // returns a canonical path even if it doesn't exist yet.
      await fs.access(filePath);
      return true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return false; // It truly doesn't exist in either format.
      }
      // A different error occurred.
      debugLogger.error(
        `Failed to check checkpoint existence for ${
          filePath ?? `path for tag "${tag}"`
        }:`,
        error,
      );
      throw error;
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

function filterPartText(
  part: CheckpointPart,
  emojiFilter: EmojiFilter,
): CheckpointPart {
  if (!part.text) {
    return part;
  }
  const filterResult = emojiFilter.filterText(part.text);
  if (typeof filterResult.filtered !== 'string') {
    return part;
  }
  return { ...part, text: filterResult.filtered };
}
