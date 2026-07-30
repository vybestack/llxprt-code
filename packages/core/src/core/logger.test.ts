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
import {
  Logger,
  MessageSenderType,
  encodeTagName,
  decodeTagName,
} from './logger.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CheckpointContent } from './logger.js';
import { debugLogger } from '../utils/debugLogger.js';

import crypto from 'node:crypto';

const TMP_DIR_NAME = 'tmp';
const LOG_FILE_NAME = 'logs.json';
const CHECKPOINT_FILE_NAME = 'checkpoint.json';

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
const TEST_CHECKPOINT_FILE_PATH = path.join(
  TEST_LLXPRT_DIR,
  CHECKPOINT_FILE_NAME,
);

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
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return [];
    }
    // Legacy format: a single pretty-printed JSON array.
    if (trimmed.startsWith('[')) {
      return JSON.parse(trimmed) as LogEntry[];
    }
    // JSONL format: one JSON object per line. Skip lines that fail to
    // parse, mirroring the production parser's resilience behavior.
    const entries: LogEntry[] = [];
    for (const line of trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip unparseable lines (partial corruption test case).
      }
    }
    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** Serialize an array of LogEntry objects to the JSONL on-disk format. */
function toJsonl(entries: LogEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
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
    await logger.close();
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
    it('should create .llxprt directory if none exist and not create an empty log file', async () => {
      const dirExists = await fs
        .access(TEST_LLXPRT_DIR)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);

      // JSONL: no empty log file is created until the first message is logged.
      const fileExists = await fs
        .access(TEST_LOG_FILE_PATH)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);

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
      await fs.writeFile(TEST_LOG_FILE_PATH, toJsonl(existingLogs));
      const newLogger = new Logger(
        currentSessionId,
        new Storage(process.cwd()),
      );
      await newLogger.initialize();
      expect(newLogger['messageId']).toBe(2);
      expect(newLogger['logs']).toStrictEqual(existingLogs);
      await newLogger.close();
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
      await fs.writeFile(TEST_LOG_FILE_PATH, toJsonl(existingLogs));
      const newLogger = new Logger('a-new-session', new Storage(process.cwd()));
      await newLogger.initialize();
      expect(newLogger['messageId']).toBe(0);
      await newLogger.close();
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
      await uninitializedLogger.close(); // Ensure it's treated as uninitialized
      const consoleDebugSpy = vi
        .spyOn(debugLogger, 'debug')
        .mockImplementation(() => {});
      await uninitializedLogger.logMessage(MessageSenderType.USER, 'test');
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'Logger not initialized or session ID missing. Cannot log message.',
      );
      expect((await readLogFile()).length).toBe(0);
      await uninitializedLogger.close();
    });

    it('should not re-read the log file on the steady-state write path (O(1) append)', async () => {
      // Seed the file with one entry for the test session before init.
      const seed: LogEntry = {
        sessionId: testSessionId,
        messageId: 0,
        timestamp: new Date('2025-01-01T11:00:00.000Z').toISOString(),
        type: MessageSenderType.USER,
        message: 'seed',
      };
      await fs.writeFile(TEST_LOG_FILE_PATH, toJsonl([seed]));

      const steadyLogger = new Logger(
        testSessionId,
        new Storage(process.cwd()),
      );
      await steadyLogger.initialize();
      expect(steadyLogger['messageId']).toBe(1);

      // First write establishes steady state.
      await steadyLogger.logMessage(MessageSenderType.USER, 'first');
      expect(steadyLogger['messageId']).toBe(2);

      // Externally append a much higher messageId directly to the file. A
      // write path that re-reads the whole file would jump to id 101; a
      // cache-based O(1) path must keep incrementing from the in-memory
      // cache (id 2).
      const external: LogEntry = {
        sessionId: testSessionId,
        messageId: 100,
        timestamp: new Date('2025-01-01T11:30:00.000Z').toISOString(),
        type: MessageSenderType.USER,
        message: 'external',
      };
      await fs.appendFile(TEST_LOG_FILE_PATH, JSON.stringify(external) + '\n');

      await steadyLogger.logMessage(MessageSenderType.USER, 'second');

      const logs = await readLogFile();
      const second = logs.find((entry) => entry.message === 'second');
      expect(second?.messageId).toBe(2);
      await steadyLogger.close();
    });

    it('must not perform any file read during steady-state logMessage', async () => {
      await logger.logMessage(MessageSenderType.USER, 'warmup');
      const readFileSpy = vi.spyOn(fs, 'readFile');
      await logger.logMessage(MessageSenderType.USER, 'steady-state');
      expect(readFileSpy).not.toHaveBeenCalled();
      readFileSpy.mockRestore();
    });
  });

  describe('legacy migration', () => {
    it('migrates a legacy JSON-array log to JSONL reading the file exactly once', async () => {
      const legacyEntries: LogEntry[] = [
        {
          sessionId: testSessionId,
          messageId: 0,
          timestamp: new Date('2025-01-01T10:00:00.000Z').toISOString(),
          type: MessageSenderType.USER,
          message: 'legacy-0',
        },
        {
          sessionId: testSessionId,
          messageId: 1,
          timestamp: new Date('2025-01-01T10:00:01.000Z').toISOString(),
          type: MessageSenderType.USER,
          message: 'legacy-1',
        },
      ];
      // Write a legacy pretty-printed JSON array (pre-JSONL on-disk format).
      await fs.writeFile(
        TEST_LOG_FILE_PATH,
        JSON.stringify(legacyEntries, null, 2),
      );

      const readFileSpy = vi.spyOn(fs, 'readFile');
      const legacyLogger = new Logger(
        testSessionId,
        new Storage(process.cwd()),
      );
      await legacyLogger.initialize();
      await legacyLogger.logMessage(MessageSenderType.USER, 'after-migration');
      // Exactly one file read across initialization and all writes: the
      // initial load. Migration and the append never re-read the file.
      expect(readFileSpy).toHaveBeenCalledTimes(1);
      readFileSpy.mockRestore();

      // In-memory cache reflects the migrated entries.
      expect(legacyLogger['logs']).toStrictEqual([
        ...legacyEntries,
        expect.objectContaining({
          sessionId: testSessionId,
          messageId: 2,
          message: 'after-migration',
        }),
      ]);
      expect(legacyLogger['messageId']).toBe(3);

      // The on-disk file is now JSONL, migrated from the single read.
      const onDisk = await fs.readFile(TEST_LOG_FILE_PATH, 'utf-8');
      expect(onDisk.trim().startsWith('[')).toBe(false);
      const diskEntries = await readLogFile();
      expect(diskEntries.length).toBe(3);
      expect(diskEntries[2]).toMatchObject({
        sessionId: testSessionId,
        messageId: 2,
        message: 'after-migration',
      });
      await legacyLogger.close();
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
      await loggerSort.close();
      await loggerSort2.close();

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
      await finalLogger.close();
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
      await uninitializedLogger.close();
      const messages = await uninitializedLogger.getPreviousUserMessages();
      expect(messages).toStrictEqual([]);
      await uninitializedLogger.close();
    });
  });

  describe('saveCheckpoint', () => {
    const conversation: CheckpointContent[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi there' }] },
    ];

    it.each([
      {
        tag: 'test-tag',
        encodedTag: 'test-tag',
      },
      {
        tag: '你好世界',
        encodedTag: '%E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C',
      },
      {
        tag: 'japanese-ひらがなひらがな形声',
        encodedTag:
          'japanese-%E3%81%B2%E3%82%89%E3%81%8C%E3%81%AA%E3%81%B2%E3%82%89%E3%81%8C%E3%81%AA%E5%BD%A2%E5%A3%B0',
      },
      {
        tag: '../../secret',
        encodedTag: '..%2F..%2Fsecret',
      },
    ])('should save a checkpoint', async ({ tag, encodedTag }) => {
      await logger.saveCheckpoint(conversation, tag);
      const taggedFilePath = path.join(
        TEST_LLXPRT_DIR,
        `checkpoint-${encodedTag}.json`,
      );
      const fileContent = await fs.readFile(taggedFilePath, 'utf-8');
      expect(JSON.parse(fileContent)).toStrictEqual({ history: conversation });
    });

    it('should not throw if logger is not initialized', async () => {
      const uninitializedLogger = new Logger(
        testSessionId,
        new Storage(process.cwd()),
      );
      await uninitializedLogger.close();
      const consoleErrorSpy = vi
        .spyOn(debugLogger, 'error')
        .mockImplementation(() => {});

      await expect(
        uninitializedLogger.saveCheckpoint(conversation, 'tag'),
      ).resolves.not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Logger not initialized or checkpoint file path not set. Cannot save a checkpoint.',
      );
    });
  });

  describe('loadCheckpoint', () => {
    const conversation: CheckpointContent[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi there' }] },
    ];

    beforeEach(async () => {
      await fs.writeFile(
        TEST_CHECKPOINT_FILE_PATH,
        JSON.stringify(conversation, null, 2),
      );
    });

    it.each([
      {
        tag: 'test-tag',
        encodedTag: 'test-tag',
      },
      {
        tag: '你好世界',
        encodedTag: '%E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C',
      },
      {
        tag: 'japanese-ひらがなひらがな形声',
        encodedTag:
          'japanese-%E3%81%B2%E3%82%89%E3%81%8C%E3%81%AA%E3%81%B2%E3%82%89%E3%81%8C%E3%81%AA%E5%BD%A2%E5%A3%B0',
      },
      {
        tag: '../../secret',
        encodedTag: '..%2F..%2Fsecret',
      },
    ])('should load from a checkpoint', async ({ tag, encodedTag }) => {
      const taggedConversation = [
        ...conversation,
        { role: 'user', parts: [{ text: 'hello' }] },
      ];
      const taggedFilePath = path.join(
        TEST_LLXPRT_DIR,
        `checkpoint-${encodedTag}.json`,
      );
      await fs.writeFile(
        taggedFilePath,
        JSON.stringify(taggedConversation, null, 2),
      );

      const loaded = await logger.loadCheckpoint(tag);
      expect(loaded).toStrictEqual({ history: taggedConversation });
      expect(encodeTagName(tag)).toBe(encodedTag);
      expect(decodeTagName(encodedTag)).toBe(tag);
    });

    it('should return an empty array if a tagged checkpoint file does not exist', async () => {
      const loaded = await logger.loadCheckpoint('non-existent-tag');
      expect(loaded).toStrictEqual({ history: [] });
    });

    it('should return an empty array if the checkpoint file does not exist', async () => {
      await fs.unlink(TEST_CHECKPOINT_FILE_PATH); // Ensure it's gone
      const loaded = await logger.loadCheckpoint('missing');
      expect(loaded).toStrictEqual({ history: [] });
    });

    it('should return an empty array if the file contains invalid JSON', async () => {
      const tag = 'invalid-json-tag';
      const encodedTag = 'invalid-json-tag';
      const taggedFilePath = path.join(
        TEST_LLXPRT_DIR,
        `checkpoint-${encodedTag}.json`,
      );
      await fs.writeFile(taggedFilePath, 'invalid json');
      const consoleErrorSpy = vi
        .spyOn(debugLogger, 'error')
        .mockImplementation(() => {});
      const loadedCheckpoint = await logger.loadCheckpoint(tag);
      expect(loadedCheckpoint).toStrictEqual({ history: [] });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read or parse checkpoint file'),
        expect.any(Error),
      );
    });

    it('should return an empty array if logger is not initialized', async () => {
      const uninitializedLogger = new Logger(
        testSessionId,
        new Storage(process.cwd()),
      );
      await uninitializedLogger.close();
      const consoleErrorSpy = vi
        .spyOn(debugLogger, 'error')
        .mockImplementation(() => {});
      const loadedCheckpoint = await uninitializedLogger.loadCheckpoint('tag');
      expect(loadedCheckpoint).toStrictEqual({ history: [] });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Logger not initialized or checkpoint file path not set. Cannot load checkpoint.',
      );
    });
  });

  describe('deleteCheckpoint', () => {
    const conversation: CheckpointContent[] = [
      { role: 'user', parts: [{ text: 'Content to be deleted' }] },
    ];
    const tag = 'delete-me';
    const encodedTag = 'delete-me';
    let taggedFilePath: string;

    beforeEach(async () => {
      taggedFilePath = path.join(
        TEST_LLXPRT_DIR,
        `checkpoint-${encodedTag}.json`,
      );
      // Create a file to be deleted
      await fs.writeFile(taggedFilePath, JSON.stringify(conversation));
    });

    it('should delete the specified checkpoint file and return true', async () => {
      const result = await logger.deleteCheckpoint(tag);
      expect(result).toBe(true);

      // Verify the file is actually gone
      await expect(fs.access(taggedFilePath)).rejects.toThrow(/ENOENT/);
    });

    it('should delete both new and old checkpoint files if they exist', async () => {
      const oldTag = 'delete-me(old)';
      const oldStylePath = path.join(
        TEST_LLXPRT_DIR,
        `checkpoint-${oldTag}.json`,
      );
      const newStylePath = logger['_checkpointPath'](oldTag);

      // Create both files
      await fs.writeFile(oldStylePath, '{}');
      await fs.writeFile(newStylePath, '{}');

      // Verify both files exist before deletion
      expect(existsSync(oldStylePath)).toBe(true);
      expect(existsSync(newStylePath)).toBe(true);

      const result = await logger.deleteCheckpoint(oldTag);
      expect(result).toBe(true);

      // Verify both are gone
      expect(existsSync(oldStylePath)).toBe(false);
      expect(existsSync(newStylePath)).toBe(false);
    });

    it('should return false if the checkpoint file does not exist', async () => {
      const result = await logger.deleteCheckpoint('non-existent-tag');
      expect(result).toBe(false);
    });

    it('should re-throw an error if file deletion fails for reasons other than not existing', async () => {
      // Simulate a different error (e.g., permission denied)
      vi.spyOn(fs, 'unlink').mockRejectedValueOnce(
        Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        }),
      );
      const consoleErrorSpy = vi
        .spyOn(debugLogger, 'error')
        .mockImplementation(() => {});

      await expect(logger.deleteCheckpoint(tag)).rejects.toThrow(
        'EACCES: permission denied',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to delete checkpoint file ${taggedFilePath}:`,
        expect.any(Error),
      );
    });

    it('should return false if logger is not initialized', async () => {
      const uninitializedLogger = new Logger(
        testSessionId,
        new Storage(process.cwd()),
      );
      await uninitializedLogger.close();
      const consoleErrorSpy = vi
        .spyOn(debugLogger, 'error')
        .mockImplementation(() => {});

      const result = await uninitializedLogger.deleteCheckpoint(tag);
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Logger not initialized or checkpoint file path not set. Cannot delete checkpoint.',
      );
    });
  });

  describe('checkpointExists', () => {
    const tag = 'exists-test';
    const encodedTag = 'exists-test';
    let taggedFilePath: string;

    beforeEach(() => {
      taggedFilePath = path.join(
        TEST_LLXPRT_DIR,
        `checkpoint-${encodedTag}.json`,
      );
    });

    it('should return true if the checkpoint file exists', async () => {
      await fs.writeFile(taggedFilePath, '{}');
      const exists = await logger.checkpointExists(tag);
      expect(exists).toBe(true);
    });

    it('should return false if the checkpoint file does not exist', async () => {
      const exists = await logger.checkpointExists('non-existent-tag');
      expect(exists).toBe(false);
    });

    it('should throw an error if logger is not initialized', async () => {
      const uninitializedLogger = new Logger(
        testSessionId,
        new Storage(process.cwd()),
      );
      await uninitializedLogger.close();

      await expect(uninitializedLogger.checkpointExists(tag)).rejects.toThrow(
        'Logger not initialized. Cannot check for checkpoint existence.',
      );
    });

    it('should re-throw an error if fs.access fails for reasons other than not existing', async () => {
      vi.spyOn(fs, 'access').mockRejectedValueOnce(
        Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        }),
      );
      const consoleErrorSpy = vi
        .spyOn(debugLogger, 'error')
        .mockImplementation(() => {});

      await expect(logger.checkpointExists(tag)).rejects.toThrow(
        'EACCES: permission denied',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to check checkpoint existence for path for tag "${tag}":`,
        expect.any(Error),
      );
    });
  });

  describe('Backward compatibility', () => {
    const conversation: CheckpointContent[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi there' }] },
    ];
    it('should load from a checkpoint with a raw special character tag', async () => {
      const taggedConversation = [
        ...conversation,
        { role: 'user', parts: [{ text: 'hello' }] },
      ];
      const tag = 'special(char)';
      const taggedFilePath = path.join(
        TEST_LLXPRT_DIR,
        `checkpoint-${tag}.json`,
      );
      await fs.writeFile(
        taggedFilePath,
        JSON.stringify(taggedConversation, null, 2),
      );

      const loaded = await logger.loadCheckpoint(tag);
      expect(loaded).toStrictEqual({ history: taggedConversation });
    });
  });

  describe('close', () => {
    it('should reset logger state', async () => {
      await logger.logMessage(MessageSenderType.USER, 'A message');
      await logger.close();
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

    it('should reset _needsNewlineCheck on close so a reused instance re-checks the trailing newline', async () => {
      await logger.logMessage(MessageSenderType.USER, 'A message');
      // A successful JSONL append clears the trailing-newline check.
      expect(logger['_needsNewlineCheck']).toBe(false);
      await logger.close();
      // close() must reset ALL mutable instance state, otherwise a reused
      // instance would silently skip the trailing-newline safety check.
      expect(logger['_needsNewlineCheck']).toBe(true);
      expect(logger['llxprtDir']).toBeUndefined();
    });
  });
});
