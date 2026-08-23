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
import { delay } from '../utils/delay.js';

const LOG_FILE_NAME = 'logs.json';
const BACKUP_RETENTION_DAYS = 30;
// Advisory inter-process locking via an O_EXCL lockfile (fs.open 'wx'). Keep the
// file-mutating sequences serialized across processes; the lock file is deleted on
// release and recovered when its mtime proves the holder crashed.
const LOCK_FILE_SUFFIX = '.lock';
const LOCK_STALE_MS = 30_000;
const LOCK_BACKOFF_MS = 25;
// Lease refresh while holding: the holder re-stamps its own lock mtime so a long
// critical section (large legacy migration, slow FS) cannot age past the staleness
// threshold and get broken by a waiter.
const LOCK_HEARTBEAT_MS = 10_000;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
// Monotonic per-process counter keeps transition-guard names unique inside one
// millisecond so two mutations in this process can never target the same guard file.
let lockMutationCounter = 0;

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

export class Logger {
  private logFilePath: string | undefined;
  private sessionId: string | undefined;
  private messageId = 0; // Instance-specific counter for the next messageId
  private initialized = false;
  private logs: LogEntry[] = []; // In-memory cache, ideally reflects the last known state of the file
  private _formatMigrated = false; // True once legacy format check/migration has run
  private _diskIsLegacy = false; // True when the on-disk file is still legacy JSON-array at load
  private _needsNewlineCheck = true; // Set false after any successful JSONL write
  // Serializes append operations per instance so concurrent logMessage calls
  // cannot interleave at an await and reuse the same messageId (the old sync
  // write path was implicitly serialized because it never yielded).
  private _writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    sessionId: string,
    private readonly storage: Storage,
  ) {
    this.sessionId = sessionId;
  }

  /**
   * Acquisition deadline for the advisory log-file lock. The
   * `LLXPRT_LOG_LOCK_TIMEOUT_MS` override is deliberately gated to test runs
   * (bun sets NODE_ENV=test): as an undocumented production knob it could
   * silently degrade every contended append, so production always uses the
   * default.
   */
  private _lockTimeoutMs(): number {
    if (process.env['NODE_ENV'] !== 'test') {
      return DEFAULT_LOCK_TIMEOUT_MS;
    }
    const raw = process.env['LLXPRT_LOG_LOCK_TIMEOUT_MS'];
    if (raw !== undefined && raw.trim().length > 0) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return DEFAULT_LOCK_TIMEOUT_MS;
  }

  private _lockFilePath(): string {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during lock operation.');
    }
    return `${this.logFilePath}${LOCK_FILE_SUFFIX}`;
  }

  /**
   * Acquire the per-log-file lock via the O_EXCL pattern (`fs.open 'wx'`).
   * Retries with a small fixed backoff until it either wins the race, recovers a
   * stale lock (via an atomic rename-guard claim, so a stale break can never
   * bare-unlink a successor's live lock), or hits the acquisition deadline.
   * The exclusive descriptor stays open for the whole critical section: it pins
   * the lock file's inode so ownership can later be verified by inode identity
   * without reading any file content.
   */
  private async _acquireLogLock(lockPath: string): Promise<fs.FileHandle> {
    const deadline = Date.now() + this._lockTimeoutMs();
    for (;;) {
      // Deadline first, so no branch below can bypass it: a persistently
      // failing stale-break (e.g. a dangling symlink at the lock path, or a
      // non-writable directory) must time out like any other contention,
      // never hot-loop and wedge the caller's write queue and close().
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for log lock ${lockPath}`);
      }
      const handle = await this._tryAcquireLogLock(lockPath);
      if (handle !== null) {
        return handle;
      }
      await this._tryBreakStaleLock(lockPath);
      // Always back off between attempts — including after a confirmed break —
      // so a persistent failure can never spin hot.
      await delay(LOCK_BACKOFF_MS);
    }
  }

  /**
   * Create the lock file, write a diagnostic payload ({pid, timestamp}), and
   * keep the descriptor open as the ownership proof. Returns the handle when
   * this process now owns the lock, null when another process holds it (EEXIST).
   * If the exclusive create won but finalizing failed, the just-created lock
   * file has no owner and must not be left behind for waiters to trip on.
   */
  private async _tryAcquireLogLock(
    lockPath: string,
  ): Promise<fs.FileHandle | null> {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
        'utf-8',
      );
      return handle;
    } catch (error) {
      if (handle !== undefined) {
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
      }
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'EEXIST') {
        throw error;
      }
      return null;
    }
  }

  /**
   * Try to break a lock whose mtime is past the staleness threshold without ever
   * bare-unlinking the live lock path (POSIX rename overwrites, so a blind unlink
   * could delete a successor's fresh lock). The live name is atomically moved to a
   * unique guard — only one contender can win the rename — then re-verified as
   * stale. A fresh file that was moved by mistake is restored with a hard link
   * (link fails EEXIST rather than overwriting) rather than deleted.
   */
  private async _tryBreakStaleLock(lockPath: string): Promise<boolean> {
    let lockStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      lockStat = await fs.stat(lockPath);
    } catch {
      // The lock vanished between our failed open and this stat — retry the open.
      return true;
    }
    if (Date.now() - lockStat.mtimeMs <= LOCK_STALE_MS) {
      return false;
    }
    const guardPath = this._guardPath(lockPath, 'brk');
    try {
      await fs.rename(lockPath, guardPath);
    } catch {
      // Another waiter claimed the stale lock first — retry the open.
      return true;
    }
    try {
      const guardStat = await fs.stat(guardPath);
      if (Date.now() - guardStat.mtimeMs > LOCK_STALE_MS) {
        await fs.unlink(guardPath).catch(() => {});
        return true;
      }
    } catch {
      // The moved guard file vanished — retry the open.
      return true;
    }
    // The renamed file is younger than the threshold: the holder refreshed it or a
    // successor acquired between our stat and rename. Restore it without clobbering
    // a lock that may have been re-created at the live path in the meantime.
    try {
      await fs.link(guardPath, lockPath);
      await fs.unlink(guardPath);
    } catch {
      debugLogger.debug(
        `Lock replaced while breaking stale lock; inert guard left behind: ${guardPath}`,
      );
    }
    return false;
  }

  /**
   * Run `fn` while this process owns `logFilePath`'s advisory lock and release it
   * in `finally`, so reader/writer sequences cannot interleave with other processes.
   * A heartbeat re-stamps the held descriptor's inode (not the lock path, so a
   * broken holder can never refresh a successor's lock) to keep the lease alive
   * during long critical sections such as a slow legacy migration. Never nested:
   * no code inside the wrapped callbacks acquires again.
   */
  private async _withLogLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockPath = this._lockFilePath();
    const handle = await this._acquireLogLock(lockPath);
    const heartbeat = setInterval(() => {
      const now = new Date();
      // Best-effort lease refresh: futimes on our own descriptor touches only
      // the inode we pinned, even if the lock path has since been taken over.
      void handle.utimes(now, now).catch(() => {});
    }, LOCK_HEARTBEAT_MS);
    heartbeat.unref();
    try {
      return await fn();
    } finally {
      clearInterval(heartbeat);
      await this._releaseLogLock(lockPath, handle);
    }
  }

  /**
   * Release the lock without a bare unlink and without reading any file
   * content (steady-state appends must stay read-free). The live name is moved
   * to a unique guard; the guard's inode is compared against the descriptor we
   * have pinned since acquisition, which proves ownership race-free. Only our
   * own inode is ever unlinked — a mismatched guard (our lock was broken and a
   * successor owns the path) is restored via a hard link, which fails EEXIST
   * rather than clobbering a newer lock.
   */
  private async _releaseLogLock(
    lockPath: string,
    handle: fs.FileHandle,
  ): Promise<void> {
    const guardPath = this._guardPath(lockPath, 'rel');
    try {
      await fs.rename(lockPath, guardPath);
    } catch (error) {
      // ENOENT: the lock was already broken or removed — nothing to release.
      // Any other errno abandons the path on purpose: a blind unlink could
      // delete a successor's live lock. Waiters recover via staleness.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        debugLogger.debug(
          `Failed to claim log lock for release (${(error as NodeJS.ErrnoException).code}); leaving it for stale recovery:`,
          error,
        );
      }
      await handle.close().catch(() => {});
      return;
    }
    try {
      const [guardStat, ownStat] = await Promise.all([
        fs.stat(guardPath),
        handle.stat(),
      ]);
      if (guardStat.ino === ownStat.ino && guardStat.dev === ownStat.dev) {
        await fs.unlink(guardPath).catch((error: unknown) => {
          debugLogger.debug('Failed to remove log lock file:', error);
        });
        return;
      }
      // Not our inode: we were broken mid-hold and renamed away a successor's
      // live lock. Restore it without clobbering a lock that may already have
      // been re-created at the live path.
      await fs.link(guardPath, lockPath);
      await fs.unlink(guardPath);
    } catch {
      debugLogger.debug(
        `Lock replaced during release; inert guard left behind: ${guardPath}`,
      );
    } finally {
      await handle.close().catch(() => {});
    }
  }

  private _guardPath(lockPath: string, kind: 'brk' | 'rel'): string {
    lockMutationCounter++;
    return `${lockPath}.${kind}.${process.pid}.${Date.now()}.${lockMutationCounter}`;
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

  /**
   * Load the log file once during initialization. Returns the parsed entries
   * and whether the on-disk file was in the legacy JSON-array format. This is
   * the ONLY read on the steady-state path: initialization, legacy migration,
   * and corruption recovery all flow through here. The per-message write path
   * never re-reads the file.
   */
  private async _loadFromDisk(): Promise<{
    entries: LogEntry[];
    legacy: boolean;
  }> {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during read attempt.');
    }
    let fileContent: string;
    try {
      fileContent = await fs.readFile(this.logFilePath, 'utf-8');
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return { entries: [], legacy: false };
      }
      debugLogger.debug(`Failed to read log file ${this.logFilePath}:`, error);
      throw error;
    }
    const trimmed = fileContent.trim();
    if (trimmed.length === 0) {
      return { entries: [], legacy: false };
    }
    const legacy = this._parseLegacyJsonArray(trimmed);
    if (legacy !== null) {
      return { entries: legacy, legacy: true };
    }
    const entries = await this._parseAndRecoverJsonl(trimmed);
    return { entries, legacy: false };
  }

  /**
   * Parse JSONL content with corruption recovery — the single shared
   * implementation (no sync/async duplicate). Backs up and starts fresh on
   * total corruption; backs up and rewrites on partial corruption.
   */
  private async _parseAndRecoverJsonl(trimmed: string): Promise<LogEntry[]> {
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
        const backedUp = await this._backupCorruptedLogFile('malformed_line');
        if (!backedUp) {
          // Total corruption has no entries to recover, so returning empty is
          // acceptable; but a failed backup leaves the corrupt file in place,
          // and subsequent appends write onto it until the next full load
          // recovers via partial-corruption handling. Surface that here.
          debugLogger.debug(
            `Backup failed for corrupted log file ${this.logFilePath}; active file left unchanged.`,
          );
        }
        return [];
      }
      throw parseError;
    }
  }

  /**
   * Migrate a legacy on-disk file to JSONL the first time it is encountered.
   * No file read happens here: the entries were already parsed during
   * `_loadFromDisk`, so migration only backs up and rewrites. Sets
   * `_formatMigrated` so subsequent writes skip this entirely.
   */
  private async _ensureJsonlFormat(): Promise<void> {
    if (this._formatMigrated) {
      return;
    }
    if (this._diskIsLegacy) {
      if (this.initialized) {
        // Append-time retry: initialize's eager migration failed and was
        // swallowed, so this.logs may be a stale snapshot — another process
        // may have migrated the file and appended since. Re-read inside this
        // same lock hold so the rewrite below cannot destroy those entries.
        // Never reached in steady state (only while migration is pending) and
        // never during initialize's eager pass (initialized is still false).
        const { entries, legacy } = await this._loadFromDisk();
        this.logs = entries;
        this._diskIsLegacy = legacy;
        if (!legacy) {
          // Another process already migrated the file — nothing to rewrite.
          this._formatMigrated = true;
          return;
        }
      }
      const backedUp = await this._backupCorruptedLogFile('pre_migration');
      if (!backedUp) {
        // Fail fast: never append JSONL onto a still-legacy file, which would
        // produce a hybrid file and lose the legacy entries on the next load.
        // Initialization catches this for a non-fatal retry; the write path
        // propagates it so the message is not persisted to a corrupt file.
        throw new Error(
          'Legacy migration backup failed; will retry on next write.',
        );
      }
      await this._writeJsonlAtomic(this.logs);
      this._diskIsLegacy = false;
    }
    this._formatMigrated = true;
  }

  /**
   * Atomically (temp-file + rename) write the full set of entries as JSONL.
   * Used by legacy migration and corruption recovery.
   */
  private async _writeJsonlAtomic(entries: LogEntry[]): Promise<void> {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during write attempt.');
    }
    const tmpPath = `${this.logFilePath}.migration.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmpPath, this._toJsonl(entries), 'utf-8');
      await fs.rename(tmpPath, this.logFilePath);
    } catch (error) {
      // Clean up the orphaned temp file so it doesn't accumulate on disk.
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup failure.
      }
      throw error;
    }
  }

  private async _appendJsonl(entry: LogEntry): Promise<void> {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during append attempt.');
    }
    await this._ensureTrailingNewline();
    await fs.appendFile(
      this.logFilePath,
      JSON.stringify(entry) + '\n',
      'utf-8',
    );
    this._needsNewlineCheck = false;
  }

  /**
   * Ensure the file ends with a newline before appending. Without this,
   * appending to a file whose last line lacks a trailing LF (common after
   * crashes or manual edits) would concatenate two records onto one line.
   * Skipped in the steady state (after a successful JSONL write) since
   * every write always terminates with a newline.
   */
  private async _ensureTrailingNewline(): Promise<void> {
    if (!this.logFilePath || !this._needsNewlineCheck) return;
    try {
      const stat = await fs.stat(this.logFilePath);
      if (stat.size === 0) {
        this._needsNewlineCheck = false;
        return;
      }
      const handle = await fs.open(this.logFilePath, 'r');
      try {
        const buf = Buffer.alloc(1);
        await handle.read(buf, 0, 1, stat.size - 1);
        if (buf[0] !== 0x0a) {
          await fs.appendFile(this.logFilePath, '\n', 'utf-8');
        }
        this._needsNewlineCheck = false;
      } finally {
        await handle.close();
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
  private async _backupCorruptedLogFile(reason: string): Promise<boolean> {
    if (!this.logFilePath) return false;
    const backupPath = `${this.logFilePath}.${reason}.${process.pid}.${Date.now()}.bak`;
    try {
      await fs.copyFile(this.logFilePath, backupPath);
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

  /**
   * Back up a partially-corrupted JSONL file and rewrite the active file with
   * only the valid entries, ensuring the next write appends to a clean file.
   * Uses temp-file + rename for atomicity.
   */
  private async _recoverPartialCorruption(
    entries: LogEntry[],
    skipped: number,
  ): Promise<void> {
    debugLogger.debug(
      `Backing up log file with ${skipped} corrupted line(s), then rewriting with valid entries.`,
    );
    const backedUp = await this._backupCorruptedLogFile('partial_corruption');
    if (backedUp) {
      try {
        await this._writeJsonlAtomic(entries);
      } catch (error) {
        debugLogger.debug(
          'Failed atomic rewrite during partial corruption recovery:',
          error,
        );
      }
    }
  }

  /**
   * Append a single entry using the in-memory cache for duplicate detection
   * and messageId assignment — no full-file read on the steady-state path
   * (O(1) filesystem append: no full-file read; duplicate detection scans the
   * in-memory cache). Legacy migration runs at most once (lazily on the first
   * write if initialization could not migrate eagerly).
   *
   * Serialized per instance via `_writeQueue` so concurrent logMessage calls
   * cannot interleave at an await and reuse the same messageId.
   */
  private _updateLogFile(entryToAppend: LogEntry): Promise<LogEntry | null> {
    // Chain each append after the previous one settles (success or failure).
    const result = this._writeQueue.then(
      () => this._appendEntry(entryToAppend),
      () => this._appendEntry(entryToAppend),
    );
    // Keep the chain alive regardless of rejection so one failed write cannot
    // permanently break subsequent writes. `result` retains the real outcome.
    this._writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async _appendEntry(
    entryToAppend: LogEntry,
  ): Promise<LogEntry | null> {
    if (!this.logFilePath) {
      throw new Error('Log file path not set during update attempt.');
    }

    // Hold the cross-process lock across the whole mutate sequence (format-ensure,
    // id assignment, duplicate check, newline-fix + append) so it cannot
    // interleave with another process's append or legacy migration rewrite.
    return this._withLogLock(async () => {
      await this._ensureJsonlFormat();

      entryToAppend.messageId = this.messageId;

      const entryExists = this.logs.some(
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
        return null;
      }

      await this._appendJsonl(entryToAppend);
      this.logs.push(entryToAppend);
      return entryToAppend;
    });
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
      // Inert guard files left by lost rename-guard races: they never sit at
      // the live .lock path, but prune them so they cannot accumulate.
      // logs.json.lock.<brk|rel>.<pid>.<ts>.<counter>
      const guardMatch = entry.match(/\.lock\.(?:brk|rel)\.\d+\.(\d+)\.\d+$/);
      if (guardMatch !== null) {
        return Number(guardMatch[1]) < cutoffMs;
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
      await this._withLogLock(async () => {
        const { entries, legacy } = await this._loadFromDisk();
        this.logs = entries;
        this._diskIsLegacy = legacy;
        // Eagerly migrate a legacy file to JSONL so the write path stays O(1)
        // (no read). Migration failure here is non-fatal: writes will retry.
        try {
          await this._ensureJsonlFormat();
        } catch (err) {
          debugLogger.debug(
            'Non-fatal legacy migration failure during init:',
            err,
          );
        }
        const sessionLogs = this.logs.filter(
          (entry) => entry.sessionId === this.sessionId,
        );
        this.messageId =
          sessionLogs.length > 0
            ? Math.max(...sessionLogs.map((entry) => entry.messageId)) + 1
            : 0;
        this.initialized = true;
      });
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

    // messageId is assigned from the in-memory counter inside _updateLogFile;
    // the write path appends directly without re-reading the file.
    const newEntryObject: LogEntry = {
      sessionId: this.sessionId,
      messageId: this.messageId,
      type,
      message,
      timestamp: new Date().toISOString(),
    };

    try {
      const writtenEntry = await this._updateLogFile(newEntryObject);
      if (writtenEntry) {
        // Only advance the next-id counter when an entry was actually
        // written (a duplicate skip or a write failure must not advance it).
        this.messageId = writtenEntry.messageId + 1;
      }
    } catch (error) {
      debugLogger.debug('Error appending to log file:', error);
    }
  }

  async close(): Promise<void> {
    // Drain pending writes until the queue reference stops changing. A single
    // `await this._writeQueue` would miss a write chained onto a newer queue
    // during the await; that write would resume after state is cleared and
    // silently fail. Looping until no new write arrived during an await
    // guarantees every in-flight logMessage settles first.
    let pending = this._writeQueue;
    let stable = false;
    while (!stable) {
      await pending.catch(() => {});
      const next = this._writeQueue;
      if (next === pending) {
        stable = true;
      } else {
        pending = next;
      }
    }
    this.initialized = false;
    this.logFilePath = undefined;
    this.logs = [];
    this.sessionId = undefined;
    this.messageId = 0;
    this._formatMigrated = false;
    this._diskIsLegacy = false;
    this._needsNewlineCheck = true;
    this._writeQueue = Promise.resolve();
  }
}
