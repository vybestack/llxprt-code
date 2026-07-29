/**
 * @license
 * Copyright 2025 Google LLC
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
// Set a test-specific config home before any Storage call so
// getGlobalLogDir resolves inside the sandbox, not the real user dir.
const ORIGINAL_CONFIG_HOME = process.env['LLXPRT_CONFIG_HOME'];
const ORIGINAL_LOG_HOME = process.env['LLXPRT_LOG_HOME'];
const TEST_CONFIG_HOME = path.join(
  os.tmpdir(),
  `llxprt-logger-test-${process.pid}`,
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

async function cleanupLogAndCheckpointFiles() {
  try {
    await fs.rm(TEST_LLXPRT_DIR, { recursive: true, force: true });
  } catch {
    // Directory may not exist - cleanup is best-effort
  }
}

async function readLogFile(): Promise<LogEntry[]> {
  try {
    const content = await fs.readFile(TEST_LOG_FILE_PATH, 'utf-8');
    return JSON.parse(content) as LogEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

vi.mock('../utils/session.js', () => ({
  sessionId: 'test-session-id',
}));

describe('Logger', () => {
  let logger: Logger;
  const testSessionId = 'test-session-id';

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));
    // Clean up before the test
    await cleanupLogAndCheckpointFiles();
    // Ensure the directory exists for the test
    await fs.mkdir(TEST_LLXPRT_DIR, { recursive: true });
    logger = new Logger(testSessionId, new Storage(process.cwd()));
    await logger.initialize();
  });

  afterEach(async () => {
    logger.close();
    // Clean up after the test
    await cleanupLogAndCheckpointFiles();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Final cleanup
    await cleanupLogAndCheckpointFiles();
    await fs
      .rm(TEST_CONFIG_HOME, { recursive: true, force: true })
      .catch(() => {});
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

  describe('initialize', () => {
    it('should create .llxprt directory and an empty log file if none exist', async () => {
      const dirExists = await fs
        .access(TEST_LLXPRT_DIR)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);

      const fileExists = await fs
        .access(TEST_LOG_FILE_PATH)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      const logContent = await readLogFile();
      expect(logContent).toStrictEqual([]);
    });

    it('should load existing logs and set correct messageId for the current session', async () => {
      const currentSessionId = 'session-123';
      const anotherSessionId = 'session-456';
      const existingLogs: LogEntry[] = [
        {
          sessionId: currentSessionId,
          messageId: 0,
          timestamp: new Date('2025-01-01T10:00:05.000Z').toISOString(),
          type: MessageSenderType.USER,
          message: 'Msg1',
        },
        {
          sessionId: anotherSessionId,
          messageId: 5,
          timestamp: new Date('2025-01-01T09:00:00.000Z').toISOString(),
          type: MessageSenderType.USER,
          message: 'OldMsg',
        },
        {
          sessionId: currentSessionId,
          messageId: 1,
          timestamp: new Date('2025-01-01T10:00:10.000Z').toISOString(),
          type: MessageSenderType.USER,
          message: 'Msg2',
        },
      ];
      await fs.writeFile(
        TEST_LOG_FILE_PATH,
        JSON.stringify(existingLogs, null, 2),
      );
      const newLogger = new Logger(
        currentSessionId,
        new Storage(process.cwd()),
      );
      await newLogger.initialize();
      expect(newLogger['messageId']).toBe(2);
      expect(newLogger['logs']).toStrictEqual(existingLogs);
      newLogger.close();
    });

    it('should set messageId to 0 for a new session if log file exists but has no logs for current session', async () => {
      const existingLogs: LogEntry[] = [
        {
          sessionId: 'some-other-session',
          messageId: 5,
          timestamp: new Date().toISOString(),
          type: MessageSenderType.USER,
          message: 'OldMsg',
        },
      ];
      await fs.writeFile(
        TEST_LOG_FILE_PATH,
        JSON.stringify(existingLogs, null, 2),
      );
      const newLogger = new Logger('a-new-session', new Storage(process.cwd()));
      await newLogger.initialize();
      expect(newLogger['messageId']).toBe(0);
      newLogger.close();
    });

    it('should be idempotent', async () => {
      await logger.logMessage(MessageSenderType.USER, 'test message');
      const initialMessageId = logger['messageId'];
      const initialLogCount = logger['logs'].length;

      await logger.initialize(); // Second call should not change state

      expect(logger['messageId']).toBe(initialMessageId);
      expect(logger['logs'].length).toBe(initialLogCount);
      const logsFromFile = await readLogFile();
      expect(logsFromFile.length).toBe(1);
    });

    it('should handle invalid JSON in log file by backing it up and starting fresh', async () => {
      await fs.writeFile(TEST_LOG_FILE_PATH, 'invalid json');
      const consoleDebugSpy = vi
        .spyOn(debugLogger, 'debug')
        .mockImplementation(() => {});

      const newLogger = new Logger(testSessionId, new Storage(process.cwd()));
      await newLogger.initialize();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid JSON in log file'),
        expect.any(SyntaxError),
      );
      const logContent = await readLogFile();
      expect(logContent).toStrictEqual([]);
      const dirContents = await fs.readdir(TEST_LLXPRT_DIR);
      expect(
        dirContents.some(
          (f) =>
            f.startsWith(LOG_FILE_NAME + '.invalid_json') && f.endsWith('.bak'),
        ),
      ).toBe(true);
      newLogger.close();
    });

    it('should handle non-array JSON in log file by backing it up and starting fresh', async () => {
      await fs.writeFile(
        TEST_LOG_FILE_PATH,
        JSON.stringify({ not: 'an array' }),
      );
      const consoleDebugSpy = vi
        .spyOn(debugLogger, 'debug')
        .mockImplementation(() => {});

      const newLogger = new Logger(testSessionId, new Storage(process.cwd()));
      await newLogger.initialize();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        `Log file at ${TEST_LOG_FILE_PATH} is not a valid JSON array. Starting with empty logs.`,
      );
      const logContent = await readLogFile();
      expect(logContent).toStrictEqual([]);
      const dirContents = await fs.readdir(TEST_LLXPRT_DIR);
      expect(
        dirContents.some(
          (f) =>
            f.startsWith(LOG_FILE_NAME + '.malformed_array') &&
            f.endsWith('.bak'),
        ),
      ).toBe(true);
      newLogger.close();
    });
  });

  describe('logMessage', () => {
    it('should append a message to the log file and update in-memory logs', async () => {
      await logger.logMessage(MessageSenderType.USER, 'Hello, world!');
      const logsFromFile = await readLogFile();
      expect(logsFromFile.length).toBe(1);
      expect(logsFromFile[0]).toMatchObject({
        sessionId: testSessionId,
        messageId: 0,
        type: MessageSenderType.USER,
        message: 'Hello, world!',
        timestamp: new Date('2025-01-01T12:00:00.000Z').toISOString(),
      });
      expect(logger['logs'].length).toBe(1);
      expect(logger['logs'][0]).toStrictEqual(logsFromFile[0]);
      expect(logger['messageId']).toBe(1);
    });

    it('should correctly increment messageId for subsequent messages in the same session', async () => {
      await logger.logMessage(MessageSenderType.USER, 'First');
      vi.advanceTimersByTime(1000);
      await logger.logMessage(MessageSenderType.USER, 'Second');
      const logs = await readLogFile();
      expect(logs.length).toBe(2);
      expect(logs[0].messageId).toBe(0);
      expect(logs[1].messageId).toBe(1);
      expect(logs[1].timestamp).not.toBe(logs[0].timestamp);
      expect(logger['messageId']).toBe(2);
    });

    it('should handle logger not initialized', async () => {
      const uninitializedLogger = new Logger(
        testSessionId,
        new Storage(process.cwd()),
      );
      uninitializedLogger.close(); // Ensure it's treated as uninitialized
      const consoleDebugSpy = vi
        .spyOn(debugLogger, 'debug')
        .mockImplementation(() => {});
      await uninitializedLogger.logMessage(MessageSenderType.USER, 'test');
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'Logger not initialized or session ID missing. Cannot log message.',
      );
      expect((await readLogFile()).length).toBe(0);
      uninitializedLogger.close();
    });

    it('should simulate concurrent writes from different logger instances to the same file', async () => {
      const concurrentSessionId = 'concurrent-session';
      const logger1 = new Logger(
        concurrentSessionId,
        new Storage(process.cwd()),
      );
      await logger1.initialize();

      const logger2 = new Logger(
        concurrentSessionId,
        new Storage(process.cwd()),
      );
      await logger2.initialize();
      expect(logger2['sessionId']).toStrictEqual(logger1['sessionId']);

      await logger1.logMessage(MessageSenderType.USER, 'L1M1');
      vi.advanceTimersByTime(10);
      await logger2.logMessage(MessageSenderType.USER, 'L2M1');
      vi.advanceTimersByTime(10);
      await logger1.logMessage(MessageSenderType.USER, 'L1M2');
      vi.advanceTimersByTime(10);
      await logger2.logMessage(MessageSenderType.USER, 'L2M2');

      const logsFromFile = await readLogFile();
      expect(logsFromFile.length).toBe(4);
      const messageIdsInFile = logsFromFile
        .map((log) => log.messageId)
        .sort((a, b) => a - b);
      expect(messageIdsInFile).toStrictEqual([0, 1, 2, 3]);

      const messagesInFile = logsFromFile
        .sort((a, b) => a.messageId - b.messageId)
        .map((l) => l.message);
      expect(messagesInFile).toStrictEqual(['L1M1', 'L2M1', 'L1M2', 'L2M2']);

      // Check internal state (next messageId each logger would use for that session)
      expect(logger1['messageId']).toBe(3);
      expect(logger2['messageId']).toBe(4);

      logger1.close();
      logger2.close();
    });

    it('should not throw, not increment messageId, and log error if writing to file fails', async () => {
      vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Disk full'));
      const consoleDebugSpy = vi
        .spyOn(debugLogger, 'debug')
        .mockImplementation(() => {});
      const initialMessageId = logger['messageId'];
      const initialLogCount = logger['logs'].length;

      await logger.logMessage(MessageSenderType.USER, 'test fail write');

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'Error writing to log file:',
        expect.any(Error),
      );
      expect(logger['messageId']).toBe(initialMessageId); // Not incremented
      expect(logger['logs'].length).toBe(initialLogCount); // Log not added to in-memory cache
    });
  });

  describe('getPreviousUserMessages', () => {
    it('should retrieve all user messages from logs, sorted newest first', async () => {
      const loggerSort = new Logger('session-1', new Storage(process.cwd()));
      await loggerSort.initialize();
      await loggerSort.logMessage(MessageSenderType.USER, 'S1M0_ts100000');
      vi.advanceTimersByTime(1000);
      await loggerSort.logMessage(MessageSenderType.USER, 'S1M1_ts101000');
      vi.advanceTimersByTime(1000);
      // Switch to a different session to log
      const loggerSort2 = new Logger('session-2', new Storage(process.cwd()));
      await loggerSort2.initialize();
      await loggerSort2.logMessage(MessageSenderType.USER, 'S2M0_ts102000');
      vi.advanceTimersByTime(1000);
      await loggerSort2.logMessage(
        'model' as MessageSenderType,
        'S2_Model_ts103000',
      );
      vi.advanceTimersByTime(1000);
      await loggerSort2.logMessage(MessageSenderType.USER, 'S2M1_ts104000');
      loggerSort.close();
      loggerSort2.close();

      const finalLogger = new Logger(
        'final-session',
        new Storage(process.cwd()),
      );
      await finalLogger.initialize();

      const messages = await finalLogger.getPreviousUserMessages();
      expect(messages).toStrictEqual([
        'S2M1_ts104000',
        'S2M0_ts102000',
        'S1M1_ts101000',
        'S1M0_ts100000',
      ]);
      finalLogger.close();
    });

    it('should return empty array if no user messages exist', async () => {
      await logger.logMessage('system' as MessageSenderType, 'System boot');
      const messages = await logger.getPreviousUserMessages();
      expect(messages).toStrictEqual([]);
    });

    it('should return empty array if logger not initialized', async () => {
      const uninitializedLogger = new Logger(
        testSessionId,
        new Storage(process.cwd()),
      );
      uninitializedLogger.close();
      const messages = await uninitializedLogger.getPreviousUserMessages();
      expect(messages).toStrictEqual([]);
      uninitializedLogger.close();
    });
  });

  describe('close', () => {
    it('should reset logger state', async () => {
      await logger.logMessage(MessageSenderType.USER, 'A message');
      logger.close();
      const consoleDebugSpy = vi
        .spyOn(debugLogger, 'debug')
        .mockImplementation(() => {});
      await logger.logMessage(MessageSenderType.USER, 'Another message');
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'Logger not initialized or session ID missing. Cannot log message.',
      );
      const messages = await logger.getPreviousUserMessages();
      expect(messages).toStrictEqual([]);
      expect(logger['initialized']).toBe(false);
      expect(logger['logFilePath']).toBeUndefined();
      expect(logger['logs']).toStrictEqual([]);
      expect(logger['sessionId']).toBeUndefined();
      expect(logger['messageId']).toBe(0);
    });
  });
});
