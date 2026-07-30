/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest';
import type { LogEntry } from './logger.js';
import { Logger, MessageSenderType } from './logger.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { debugLogger } from '../utils/debugLogger.js';
import crypto from 'node:crypto';

const TMP_DIR_NAME = 'tmp';
const LOG_FILE_NAME = 'logs.json';

const ORIGINAL_CONFIG_HOME = process.env['LLXPRT_CONFIG_HOME'];
const ORIGINAL_LOG_HOME = process.env['LLXPRT_LOG_HOME'];
const TEST_CONFIG_HOME = path.join(
  os.tmpdir(),
  `llxprt-logger-jsonl-test-${process.pid}`,
);
process.env['LLXPRT_CONFIG_HOME'] = TEST_CONFIG_HOME;
process.env['LLXPRT_LOG_HOME'] = TEST_CONFIG_HOME;

const projectDir = process.cwd();
const hash = crypto.createHash('sha256').update(projectDir).digest('hex');
const TEST_LLXPRT_DIR = path.join(
  Storage.getGlobalLogDir(),
  TMP_DIR_NAME,
  hash,
);
const TEST_LOG_FILE_PATH = path.join(TEST_LLXPRT_DIR, LOG_FILE_NAME);

async function cleanupLogFiles() {
  try {
    await fs.rm(TEST_LLXPRT_DIR, { recursive: true, force: true });
  } catch {
    // Directory may not exist — cleanup is best-effort.
  }
}

async function readLogFile(): Promise<LogEntry[]> {
  try {
    const content = await fs.readFile(TEST_LOG_FILE_PATH, 'utf-8');
    const trimmed = content.trim();
    if (trimmed.length === 0) return [];
    const entries: LogEntry[] = [];
    for (const line of trimmed.split('\n').map((l) => l.trim())) {
      if (line.length === 0) continue;
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip unparseable lines — mirrors production resilient parsing.
      }
    }
    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function hasMalformedBackup(dirContents: string[]): boolean {
  return dirContents.some(
    (f) =>
      f.startsWith(LOG_FILE_NAME + '.malformed_line') && f.endsWith('.bak'),
  );
}

describe('Logger JSONL format', () => {
  let logger: Logger;
  const testSessionId = 'test-session-id';

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));
    await cleanupLogFiles();
    await fs.mkdir(TEST_LLXPRT_DIR, { recursive: true });
    logger = new Logger(testSessionId, new Storage(process.cwd()));
    await logger.initialize();
  });

  afterEach(async () => {
    await logger.close();
    await cleanupLogFiles();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (ORIGINAL_CONFIG_HOME !== undefined) {
      process.env['LLXPRT_CONFIG_HOME'] = ORIGINAL_CONFIG_HOME;
    } else {
      delete process.env['LLXPRT_CONFIG_HOME'];
    }
    if (ORIGINAL_LOG_HOME !== undefined) {
      process.env['LLXPRT_LOG_HOME'] = ORIGINAL_LOG_HOME;
    } else {
      delete process.env['LLXPRT_LOG_HOME'];
    }
  });

  it('should handle fully-corrupted JSONL by backing it up and starting fresh', async () => {
    const corruptedContent = 'this is not valid json\nalso not json\n';
    await fs.writeFile(TEST_LOG_FILE_PATH, corruptedContent);
    vi.spyOn(debugLogger, 'debug').mockImplementation(() => {});

    const newLogger = new Logger(testSessionId, new Storage(process.cwd()));
    await newLogger.initialize();

    const logContent = await readLogFile();
    expect(logContent).toStrictEqual([]);
    const dirContents = await fs.readdir(TEST_LLXPRT_DIR);
    expect(hasMalformedBackup(dirContents)).toBe(true);

    // Verify the backup contains the original corrupted data.
    const backupName = dirContents.find(
      (f) =>
        f.startsWith(LOG_FILE_NAME + '.malformed_line') && f.endsWith('.bak'),
    );
    expect(backupName).toBeDefined();
    const backupContent = await fs.readFile(
      path.join(TEST_LLXPRT_DIR, backupName!),
      'utf-8',
    );
    expect(backupContent).toBe(corruptedContent);

    await newLogger.close();
  });

  it('should self-heal a totally-corrupted file when a valid record is appended before the next load', async () => {
    const nl = String.fromCharCode(10);
    const corruptedContent = ['totally broken', 'also broken'].join(nl) + nl;
    await fs.writeFile(TEST_LOG_FILE_PATH, corruptedContent);
    vi.spyOn(debugLogger, 'debug').mockImplementation(() => {});

    // First load: total corruption is backed up and the cache is empty. The
    // active file is intentionally left in place (backup is a copy).
    const first = new Logger(testSessionId, new Storage(process.cwd()));
    await first.initialize();
    expect(first['logs']).toStrictEqual([]);
    // A valid record is appended onto the still-corrupted active file.
    await first.logMessage(MessageSenderType.USER, 'valid-after-corruption');
    await first.close();

    // Second load: the file now holds corrupted lines plus one valid line,
    // which is treated as partial corruption — the valid record survives and
    // the active file is rewritten clean.
    const second = new Logger(testSessionId, new Storage(process.cwd()));
    await second.initialize();
    const healed = second['logs'];
    expect(healed).toHaveLength(1);
    expect(healed[0].message).toBe('valid-after-corruption');
    const onDisk = await readLogFile();
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].message).toBe('valid-after-corruption');
    await second.close();
  });

  it('should preserve valid JSONL entries when some lines are corrupted', async () => {
    const validEntry1: LogEntry = {
      sessionId: 'partial-corruption',
      messageId: 0,
      timestamp: new Date('2025-01-01T10:00:00.000Z').toISOString(),
      type: MessageSenderType.USER,
      message: 'Valid1',
    };
    const validEntry2: LogEntry = {
      sessionId: 'partial-corruption',
      messageId: 1,
      timestamp: new Date('2025-01-01T10:00:05.000Z').toISOString(),
      type: MessageSenderType.USER,
      message: 'Valid2',
    };
    const corruptedContent =
      JSON.stringify(validEntry1) +
      '\n' +
      'THIS LINE IS BROKEN\n' +
      JSON.stringify(validEntry2) +
      '\n';
    await fs.writeFile(TEST_LOG_FILE_PATH, corruptedContent);

    const newLogger = new Logger(
      'partial-corruption',
      new Storage(process.cwd()),
    );
    await newLogger.initialize();

    // Valid entries should be loaded into the in-memory cache.
    const cachedLogs = newLogger['logs'];
    expect(cachedLogs).toHaveLength(2);
    expect(cachedLogs[0].message).toBe('Valid1');
    expect(cachedLogs[1].message).toBe('Valid2');

    // A partial_corruption backup should exist so corrupted lines are
    // recoverable; no malformed_line backup (that's for total corruption).
    const dirContents = await fs.readdir(TEST_LLXPRT_DIR);
    expect(
      dirContents.some(
        (f) =>
          f.startsWith(LOG_FILE_NAME + '.partial_corruption') &&
          f.endsWith('.bak'),
      ),
    ).toBe(true);
    expect(hasMalformedBackup(dirContents)).toBe(false);

    // Verify the backup contains the original corrupted data.
    const backupName = dirContents.find(
      (f) =>
        f.startsWith(LOG_FILE_NAME + '.partial_corruption') &&
        f.endsWith('.bak'),
    );
    expect(backupName).toBeDefined();
    const backupContent = await fs.readFile(
      path.join(TEST_LLXPRT_DIR, backupName!),
      'utf-8',
    );
    expect(backupContent).toBe(corruptedContent);

    // The active file should have been rewritten with only valid entries.
    const activeContent = await readLogFile();
    expect(activeContent).toHaveLength(2);
    expect(activeContent[0].message).toBe('Valid1');
    expect(activeContent[1].message).toBe('Valid2');

    // Write a new message and verify all entries survive on disk.
    await newLogger.logMessage(MessageSenderType.USER, 'After recovery');
    const afterWrite = await readLogFile();
    expect(afterWrite).toHaveLength(3);
    expect(afterWrite[0].message).toBe('Valid1');
    expect(afterWrite[1].message).toBe('Valid2');
    expect(afterWrite[2].message).toBe('After recovery');

    // Reopen a fresh logger and verify entries persist.
    await newLogger.close();
    const reopened = new Logger(
      'partial-corruption',
      new Storage(process.cwd()),
    );
    await reopened.initialize();
    const reopenedLogs = reopened['logs'];
    expect(reopenedLogs).toHaveLength(3);
    expect(reopenedLogs[2].message).toBe('After recovery');
    await reopened.close();
  });

  it('should migrate a legacy pretty-printed JSON array to JSONL during initialization', async () => {
    const currentSessionId = 'session-legacy';
    const existingLogs: LogEntry[] = [
      {
        sessionId: currentSessionId,
        messageId: 0,
        timestamp: new Date('2025-01-01T10:00:00.000Z').toISOString(),
        type: MessageSenderType.USER,
        message: 'Legacy1',
      },
      {
        sessionId: currentSessionId,
        messageId: 1,
        timestamp: new Date('2025-01-01T10:00:05.000Z').toISOString(),
        type: MessageSenderType.USER,
        message: 'Legacy2',
      },
    ];
    await fs.writeFile(
      TEST_LOG_FILE_PATH,
      JSON.stringify(existingLogs, null, 2),
      'utf-8',
    );

    const newLogger = new Logger(currentSessionId, new Storage(process.cwd()));
    await newLogger.initialize();
    expect(newLogger['messageId']).toBe(2);

    await newLogger.logMessage(MessageSenderType.USER, 'New1');
    await newLogger.logMessage(MessageSenderType.USER, 'New2');

    const logsFromFile = await readLogFile();
    expect(logsFromFile).toHaveLength(4);
    expect(logsFromFile[0].message).toBe('Legacy1');
    expect(logsFromFile[1].message).toBe('Legacy2');
    expect(logsFromFile[2].message).toBe('New1');
    expect(logsFromFile[3].message).toBe('New2');

    const rawContent = await fs.readFile(TEST_LOG_FILE_PATH, 'utf-8');
    expect(rawContent.trim().startsWith('[')).toBe(false);
    expect(rawContent.trim().split('\n').filter(Boolean)).toHaveLength(4);

    const dirContents = await fs.readdir(TEST_LLXPRT_DIR);
    expect(hasMalformedBackup(dirContents)).toBe(false);

    await newLogger.close();
  });

  it('should migrate the legacy empty array "[]" to JSONL during initialization', async () => {
    await fs.writeFile(TEST_LOG_FILE_PATH, '[]', 'utf-8');

    const newLogger = new Logger(testSessionId, new Storage(process.cwd()));
    await newLogger.initialize();
    expect(newLogger['messageId']).toBe(0);

    await newLogger.logMessage(MessageSenderType.USER, 'First');
    await newLogger.logMessage(MessageSenderType.USER, 'Second');

    const logsFromFile = await readLogFile();
    expect(logsFromFile).toHaveLength(2);
    expect(logsFromFile[0].message).toBe('First');
    expect(logsFromFile[1].message).toBe('Second');

    const rawContent = await fs.readFile(TEST_LOG_FILE_PATH, 'utf-8');
    expect(rawContent.trim().startsWith('[')).toBe(false);

    await newLogger.close();
  });

  it('should prepend a newline when appending to a file without trailing LF', async () => {
    const existingEntry: LogEntry = {
      sessionId: testSessionId,
      messageId: 0,
      timestamp: new Date('2025-01-01T11:00:00.000Z').toISOString(),
      type: MessageSenderType.USER,
      message: 'No trailing newline',
    };
    await fs.writeFile(
      TEST_LOG_FILE_PATH,
      JSON.stringify(existingEntry),
      'utf-8',
    );

    const newLogger = new Logger(testSessionId, new Storage(process.cwd()));
    await newLogger.initialize();
    await newLogger.logMessage(MessageSenderType.USER, 'After append');
    await newLogger.close();

    const logsFromFile = await readLogFile();
    expect(logsFromFile.length).toBe(2);
    expect(logsFromFile[0].message).toBe('No trailing newline');
    expect(logsFromFile[1].message).toBe('After append');
  });

  it('keeps independent messageId counters per logger instance and appends sequentially to the same file', async () => {
    const concurrentSessionId = 'concurrent-session';
    const logger1 = new Logger(concurrentSessionId, new Storage(process.cwd()));
    await logger1.initialize();

    const logger2 = new Logger(concurrentSessionId, new Storage(process.cwd()));
    await logger2.initialize();

    await logger1.logMessage(MessageSenderType.USER, 'L1M1');
    vi.advanceTimersByTime(10);
    await logger2.logMessage(MessageSenderType.USER, 'L2M1');
    vi.advanceTimersByTime(10);
    await logger1.logMessage(MessageSenderType.USER, 'L1M2');
    vi.advanceTimersByTime(10);
    await logger2.logMessage(MessageSenderType.USER, 'L2M2');

    const logsFromFile = await readLogFile();
    expect(logsFromFile.length).toBe(4);
    // Appends are physically serialized in call order — no interleaving or
    // corruption. messageIds come from each instance's in-memory counter
    // (the O(1) write path does not re-read the file), so each instance
    // numbers its own messages 0,1 independently rather than coordinating.
    expect(logsFromFile.map((log) => log.message)).toStrictEqual([
      'L1M1',
      'L2M1',
      'L1M2',
      'L2M2',
    ]);
    expect(logsFromFile.map((log) => log.messageId)).toStrictEqual([
      0, 0, 1, 1,
    ]);

    await logger1.close();
    await logger2.close();
  });

  it('should serialize concurrent same-instance writes so each gets a unique messageId', async () => {
    const messages = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
    await Promise.all(
      messages.map((m) => logger.logMessage(MessageSenderType.USER, m)),
    );

    const logsFromFile = await readLogFile();
    expect(logsFromFile).toHaveLength(8);
    // Each concurrent write gets a unique, sequential messageId (writes are
    // serialized per instance), and records are appended in invocation order.
    expect(logsFromFile.map((log) => log.messageId)).toStrictEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(logsFromFile.map((log) => log.message)).toStrictEqual(messages);
    expect(logger['messageId']).toBe(8);
  });

  it('close() drains in-flight writes so a concurrent logMessage still reaches disk', async () => {
    // Race a write against close(). Because close() awaits the write queue,
    // the in-flight append must complete and persist before the instance is
    // torn down. With a non-draining (synchronous) close(), the resumed
    // _appendEntry would see a cleared logFilePath and the write would be lost.
    await Promise.all([
      logger.logMessage(MessageSenderType.USER, 'raced write'),
      logger.close(),
    ]);
    const onDisk = await readLogFile();
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].message).toBe('raced write');
  });
  // The append-failure path is exercised by stubbing fs.appendFile (an
  // infrastructure mock), which is portable across platforms — unlike chmod,
  // which is ineffective as root and advisory on Windows.
  it('should not throw, not increment messageId, and log error if appending to file fails', async () => {
    const debugSpy = vi
      .spyOn(debugLogger, 'debug')
      .mockImplementation(() => {});

    // Log a setup message so the file exists and the steady state is entered.
    await logger.logMessage(MessageSenderType.USER, 'setup message');
    const setupMessageId = logger['messageId'];
    const setupLogCount = logger['logs'].length;

    // Inject a deterministic append failure by stubbing the async fs append.
    // The setup write above is required — it sets _needsNewlineCheck to false
    // so _ensureTrailingNewline is skipped, ensuring only the entry append is
    // stubbed and the failure path is unambiguous.
    const appendSpy = vi
      .spyOn(fs, 'appendFile')
      .mockRejectedValue(new Error('Injected append failure'));

    // The failing write must not throw out of logMessage.
    await logger.logMessage(MessageSenderType.USER, 'test fail write');

    appendSpy.mockRestore();

    // messageId must NOT advance because the write failed.
    expect(logger['messageId']).toBe(setupMessageId);
    // The in-memory cache must NOT include the failed entry.
    expect(logger['logs'].length).toBe(setupLogCount);
    // The failed message must not be persisted.
    const persisted = await readLogFile();
    expect(persisted.some((e) => e.message === 'test fail write')).toBe(false);
    // The persistence error must be logged rather than silently swallowed.
    expect(debugSpy).toHaveBeenCalledWith(
      'Error appending to log file:',
      expect.any(Error),
    );
    debugSpy.mockRestore();
  });
});
