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
  unlinkSync,
  copyFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { ensureDir } from '../utils/paths.js';
import type { EmojiFilter } from '../filters/EmojiFilter.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { debugLogger } from '../utils/debugLogger.js';

const LOG_FILE_NAME = 'logs.json';
const BACKUP_RETENTION_DAYS = 30;

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
  private _formatMigrated = false; // True once legacy format check/migration has run
  private _needsNewlineCheck = true; // Set false after any successful JSONL write

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

  /**
   * Parse JSONL content, preserving valid entries even when some lines are
   * corrupted. Throws when every line fails to parse, signaling total
   * corruption so the caller can back up the file and start fresh.
   *
   * Returns `{ entries, skipped }` so the caller can back up the file when
   * partial corruption is detected.
   */
  private _parseJsonl(trimmed: string): {
    entries: LogEntry[];
    skipped: number;
  } {
    const allLines = trimmed.split('\n').map((line) => line.trim());
    const entries: LogEntry[] = [];
    let skipped = 0;
    let firstSkippedLine = -1;
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].length === 0) continue;
      const result = this._tryParseJsonlLine(allLines[i]);
      if (result.valid) {
        entries.push(result.entry);
      } else {
        skipped++;
        if (firstSkippedLine === -1) firstSkippedLine = i + 1;
      }
    }
    if (skipped > 0) {
      debugLogger.debug(
        `Skipped ${skipped} unparseable/invalid JSONL line(s) in log file` +
          (firstSkippedLine > -1 ? ` (first at line ${firstSkippedLine})` : ''),
      );
    }
    if (entries.length === 0 && allLines.some((l) => l.length > 0)) {
      throw new SyntaxError('All JSONL lines failed to parse');
    }
    return { entries, skipped };
  }

  private _tryParseJsonlLine(
    line: string,
  ): { valid: true; entry: LogEntry } | { valid: false } {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isValidLogEntry(parsed)) {
        return { valid: true, entry: parsed };
      }
    } catch {
      // Fall through to invalid.
    }
    return { valid: false };
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
      return this._parseLogContentSync(fileContent.trim());
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return [];
      }
      debugLogger.debug(
        `Failed to read or parse log file ${this.logFilePath}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Shared post-read parsing logic used by both the sync and async read
   * paths. Handles the legacy JSON-array format, JSONL, and corruption
   * recovery. On total corruption (all lines fail to parse) it backs up the
   * file via the provided function and returns an empty array.
   */
  private _parseLogContentSync(trimmed: string): LogEntry[] {
    if (trimmed.length === 0) {
      return [];
    }
    const legacy = this._parseLegacyJsonArray(trimmed);
    if (legacy !== null) {
      return legacy;
    }
    try {
      const { entries, skipped } = this._parseJsonl(trimmed);
      if (skipped > 0) {
        this._recoverPartialCorruptionSync(entries, skipped);
      }
      return entries;
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        debugLogger.debug(
          `Invalid JSON line in log file ${this.logFilePath}. Backing up and starting fresh.`,
          parseError,
        );
        const backedUp = this._backupCorruptedLogFileSync('malformed_line');
        if (!backedUp) {
          debugLogger.debug(
            'Backup of corrupted log file failed — preserving original file on disk and returning empty cache.',
          );
        }
        return [];
      }
      throw parseError;
    }
  }

  private _recoverPartialCorruptionSync(
    entries: LogEntry[],
    skipped: number,
  ): void {
    if (!this.logFilePath) return;
    debugLogger.debug(
      `Backing up log file with ${skipped} corrupted line(s), then rewriting with valid entries.`,
    );
    const backedUp = this._backupCorruptedLogFileSync('partial_corruption');
    if (!backedUp) return;
    try {
      this._writeJsonlAtomicSync(entries);
    } catch (writeError) {
      debugLogger.debug(
        'Failed atomic rewrite during partial corruption recovery:',
        writeError,
      );
    }
  }

  private _writeJsonlAtomicSync(entries: LogEntry[]): void {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during write attempt.');
    }
    const tmpPath = `${this.logFilePath}.migration.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmpPath, this._toJsonl(entries), 'utf-8');
      renameSync(tmpPath, this.logFilePath);
    } catch (error) {
      // Clean up the orphaned temp file so it doesn't accumulate on disk.
      try {
        unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failure.
      }
      throw error;
    }
  }

  private _appendJsonlSync(entry: LogEntry): void {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during append attempt.');
    }
    this._ensureTrailingNewline();
    appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
    this._needsNewlineCheck = false;
  }

  /**
   * Ensure the file ends with a newline before appending. Without this,
   * appending to a file whose last line lacks a trailing LF (common after
   * crashes or manual edits) would concatenate two records onto one line.
   * Skipped in the steady state (after a successful JSONL write) since
   * every write always terminates with a newline.
   */
  private _ensureTrailingNewline(): void {
    if (!this.logFilePath || !this._needsNewlineCheck) return;
    try {
      const stat = statSync(this.logFilePath);
      if (stat.size === 0) {
        this._needsNewlineCheck = false;
        return;
      }
      const fd = openSync(this.logFilePath, 'r');
      try {
        const buf = Buffer.alloc(1);
        readSync(fd, buf, 0, 1, stat.size - 1);
        if (buf[0] !== 0x0a) {
          appendFileSync(this.logFilePath, '\n', 'utf-8');
        }
        this._needsNewlineCheck = false;
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist yet — nothing to terminate.
    }
  }

  /**
   * Copy the current log file to a timestamped backup (does NOT remove the
   * original). Using copy instead of rename ensures the active file survives
   * backup so callers can safely rewrite it with recovered entries.
   */
  private _backupCorruptedLogFileSync(reason: string): boolean {
    if (!this.logFilePath) return false;
    const backupPath = `${this.logFilePath}.${reason}.${process.pid}.${Date.now()}.bak`;
    try {
      copyFileSync(this.logFilePath, backupPath);
      debugLogger.debug(`Backed up log file to ${backupPath}`);
      return true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      // ENOENT means the file was already gone — nothing to back up.
      if (nodeError.code === 'ENOENT') {
        return true;
      }
      debugLogger.debug(`Failed to back up log file to ${backupPath}:`, error);
      return false;
    }
  }

  private _isLegacyFormat(): boolean {
    if (!this.logFilePath) {
      return false;
    }
    try {
      const content = readFileSync(this.logFilePath, 'utf-8');
      return content.trim().startsWith('[');
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      // ENOENT means the file doesn't exist yet — genuinely non-legacy.
      if (nodeError.code === 'ENOENT') {
        return false;
      }
      // Non-ENOENT errors (EACCES, EIO, etc.) are transient/recoverable —
      // rethrow so the caller does NOT cache the format as migrated.
      throw error;
    }
  }

  private _migrateLegacyToJsonl(): void {
    if (!this.logFilePath) {
      return;
    }
    let rawContent: string;
    try {
      rawContent = readFileSync(this.logFilePath, 'utf-8');
    } catch (error) {
      debugLogger.debug('Failed to read legacy log file for migration:', error);
      return;
    }
    const trimmed = rawContent.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('[')) {
      return;
    }
    // Always back up the original legacy file before rewriting. Using copy
    // (not rename) ensures the active file survives even if the JSONL write
    // fails below — the caller can then retry on the next write.
    const backedUp = this._backupCorruptedLogFileSync('pre_migration');
    if (!backedUp) {
      debugLogger.debug(
        'Failed to back up legacy file before migration — skipping migration to preserve data.',
      );
      return;
    }
    const entries = this._parseLegacyJsonArray(trimmed);
    if (entries === null) {
      // Content starts with '[' but is not a valid JSON array — corrupted.
      // The backup was already created above; rewrite as empty JSONL.
      debugLogger.debug(
        'Legacy file starts with [ but is not a valid JSON array — treating as corrupted.',
      );
      this._writeJsonlAtomicSync([]);
      return;
    }
    this._writeJsonlAtomicSync(entries);
  }

  private _updateLogFileSync(entryToAppend: LogEntry): LogEntry | null {
    if (!this.logFilePath) {
      debugLogger.debug('Log file path not set. Cannot persist log entry.');
      throw new Error('Log file path not set during update attempt.');
    }

    if (!this._formatMigrated) {
      if (this._isLegacyFormat()) {
        this._migrateLegacyToJsonl();
        // If migration still failed (e.g. backup failed), don't cache — let
        // the next write attempt retry.
        if (this._isLegacyFormat()) {
          throw new Error('Legacy migration failed; will retry on next write.');
        }
      }
      this._formatMigrated = true;
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
        const { entries, skipped } = this._parseJsonl(trimmed);
        if (skipped > 0) {
          await this._recoverPartialCorruption(entries, skipped);
        }
        return entries;
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
      debugLogger.debug(
        `Failed to read or parse log file ${this.logFilePath}:`,
        error,
      );
      throw error;
    }
  }

  private async _backupCorruptedLogFile(reason: string): Promise<boolean> {
    if (!this.logFilePath) return false;
    const backupPath = `${this.logFilePath}.${reason}.${process.pid}.${Date.now()}.bak`;
    try {
      await fs.copyFile(this.logFilePath, backupPath);
      debugLogger.debug(`Backed up log file to ${backupPath}`);
      return true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return true;
      }
      debugLogger.debug(`Failed to back up log file to ${backupPath}:`, error);
      return false;
    }
  }

  /**
   * Back up a partially-corrupted JSONL file and rewrite the active file with
   * only the valid entries, ensuring the next write appends to a clean file.
   * Uses temp-file + rename for atomicity, matching the sync path.
   */
  private async _recoverPartialCorruption(
    entries: LogEntry[],
    skipped: number,
  ): Promise<void> {
    debugLogger.debug(
      `Backing up log file with ${skipped} corrupted line(s), then rewriting with valid entries.`,
    );
    const backedUp = await this._backupCorruptedLogFile('partial_corruption');
    if (backedUp && this.logFilePath) {
      const tmpPath = `${this.logFilePath}.recovery.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(tmpPath, this._toJsonl(entries), 'utf-8');
        await fs.rename(tmpPath, this.logFilePath);
      } catch (error) {
        debugLogger.debug(
          'Failed atomic rewrite during partial corruption recovery:',
          error,
        );
        try {
          await fs.unlink(tmpPath);
        } catch {
          // Ignore — temp file pruning handles stale files.
        }
      }
    }
  }

  private async _pruneOldBackups(): Promise<void> {
    if (!this.logFilePath) return;
    const dir = path.dirname(this.logFilePath);
    const baseName = path.basename(this.logFilePath);
    const cutoffMs = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    const staleFiles = entries.filter((entry) => {
      if (!entry.startsWith(baseName)) {
        return false;
      }
      // Old corruption backups: logs.json.<reason>.<timestamp>.bak
      if (entry.endsWith('.bak')) {
        const match = entry.match(/\.(\d+)\.bak$/);
        return match !== null && Number(match[1]) < cutoffMs;
      }
      // Orphaned migration temp files: logs.json.migration.<pid>.<ts>.tmp
      if (entry.endsWith('.tmp')) {
        const match = entry.match(/\.(\d+)\.tmp$/);
        return match !== null && Number(match[1]) < cutoffMs;
      }
      return false;
    });
    for (const file of staleFiles) {
      try {
        await fs.unlink(path.join(dir, file));
        debugLogger.debug(`Pruned old log file ${file}`);
      } catch {
        // Deletion is best-effort; a locked or already-removed file is fine.
      }
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
    } catch (err) {
      debugLogger.error('Failed to create llxprt directory:', err);
      this.initialized = false;
      return;
    }

    // Pruning is best-effort and never throws — run it outside the
    // critical try/catch so it cannot block initialization.
    await this._pruneOldBackups();

    try {
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
    this._formatMigrated = false;
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
