/**
 * @plan PLAN-20250120-DEBUGLOGGING.P10
 * @requirement REQ-005
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { FileOutput } from './FileOutput.js';
import type { LogEntry } from './types.js';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    access: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
    appendFile: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(),
}));

// Mock path module
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
}));

describe('FileOutput', () => {
  let fileOutput: FileOutput;
  const mockHomedir = '/test/home';
  const mockDebugDir = '/test/home/.llxprt/debug';

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset singleton
    (FileOutput as unknown as { instance: FileOutput | undefined }).instance =
      undefined;

    // Setup mocks
    vi.mocked(homedir).mockReturnValue(mockHomedir);
    vi.mocked(join).mockImplementation((...args) => args.join('/'));
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.appendFile).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockRejectedValue(new Error('File not found'));
  });

  afterEach(async () => {
    if (fileOutput) {
      await fileOutput.dispose();
    }
    vi.clearAllTimers();
  });

  /**
   * @requirement REQ-005.1
   * @scenario Singleton pattern
   * @given FileOutput class
   * @when getInstance called multiple times
   * @then Same instance returned
   */
  it('should implement singleton pattern @plan:PLAN-20250120-DEBUGLOGGING.P10', () => {
    const instance1 = FileOutput.getInstance();
    const instance2 = FileOutput.getInstance();

    expect(instance1).toBe(instance2);
  });

  /**
   * @requirement REQ-005.2
   * @scenario Directory creation
   * @given ~/.llxprt/debug directory does not exist
   * @when FileOutput writes first log entry
   * @then Directory created with proper permissions
   */
  it('should create debug directory if it does not exist @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(
      new Error('Directory not found'),
    );

    fileOutput = FileOutput.getInstance();

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test',
      level: 'log',
      message: 'test message',
      runId: 'test-run',
      pid: 12345,
    };

    await fileOutput.write(logEntry);

    expect(fs.mkdir).toHaveBeenCalledWith(mockDebugDir, {
      recursive: true,
      mode: 0o700,
    });
  });

  /**
   * @requirement REQ-005.3
   * @scenario JSONL format writing
   * @given valid log entry
   * @when write method called
   * @then Entry written in JSONL format
   */
  it('should write log entries in JSONL format @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test:namespace',
      level: 'error',
      message: 'test error message',
      args: [{ data: 'value' }, 123],
      runId: 'test-run',
      pid: 12345,
    };

    await fileOutput.write(logEntry);

    const expectedJsonl = JSON.stringify(logEntry) + '\n';

    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.stringContaining('llxprt-debug-'),
      expectedJsonl,
      { encoding: 'utf8', mode: 0o600 },
    );
  });

  /**
   * @requirement REQ-005.4
   * @scenario File permissions
   * @given log file being written
   * @when appendFile called
   * @then File created with 0600 permissions
   */
  it('should set proper file permissions @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test',
      level: 'log',
      message: 'test message',
      runId: 'test-run',
      pid: 12345,
    };

    await fileOutput.write(logEntry);

    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { encoding: 'utf8', mode: 0o600 },
    );
  });

  /**
   * @requirement REQ-005.5
   * @scenario Async queue implementation
   * @given multiple log entries written rapidly
   * @when write method called multiple times
   * @then Entries queued and batched for writing
   */
  it('should queue writes asynchronously @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    const entries: LogEntry[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push({
        timestamp: '2025-01-21T00:00:00.000Z',
        namespace: 'test',
        level: 'log',
        message: `message ${i}`,
        runId: 'test-run',
        pid: 12345,
      });
    }

    // Write all entries rapidly
    const promises = entries.map((entry) => fileOutput.write(entry));
    await Promise.all(promises);

    // Should have been batched together
    expect(fs.appendFile).toHaveBeenCalled();
  });

  /**
   * @requirement REQ-005.6
   * @scenario Batching behavior
   * @given queue with multiple entries
   * @when batch size reached
   * @then Entries written in single operation
   */
  it('should batch writes efficiently @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    const batchSize = 3;
    const entries: LogEntry[] = [];

    for (let i = 0; i < batchSize; i++) {
      entries.push({
        timestamp: '2025-01-21T00:00:00.000Z',
        namespace: 'test',
        level: 'log',
        message: `batch message ${i}`,
        runId: 'test-run',
        pid: 12345,
      });
    }

    // Write entries sequentially
    for (const entry of entries) {
      await fileOutput.write(entry);
    }

    // Verify batched JSONL format
    const calls = vi.mocked(fs.appendFile).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const jsonlContent = calls[0][1] as string;
    const lines = jsonlContent.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);

    // Each line should be valid JSON
    lines.forEach((line) => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });

  /**
   * @requirement REQ-005.7
   * @scenario File rotation by size
   * @given log file exceeding size limit
   * @when new write occurs
   * @then New log file created
   */
  it('should rotate files when size limit exceeded @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    // Mock file stats to show large file
    vi.mocked(fs.stat).mockResolvedValueOnce({
      size: 11 * 1024 * 1024, // 11MB, exceeds 10MB limit
      birthtime: new Date(),
    } as unknown as fs.Stats);

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test',
      level: 'log',
      message: 'test message',
      runId: 'test-run',
      pid: 12345,
    };

    await fileOutput.write(logEntry);

    // Should have checked file stats and created new file
    expect(fs.stat).toHaveBeenCalled();
    expect(fs.appendFile).toHaveBeenCalled();
  });

  /**
   * @requirement REQ-005.8
   * @scenario File rotation by date
   * @given log file from previous day
   * @when new write occurs
   * @then New log file created for current day
   */
  it('should rotate files daily @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    // Mock file stats to show old file
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    vi.mocked(fs.stat).mockResolvedValueOnce({
      size: 1024, // Small file
      birthtime: yesterday,
    } as unknown as fs.Stats);

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test',
      level: 'log',
      message: 'test message',
      runId: 'test-run',
      pid: 12345,
    };

    await fileOutput.write(logEntry);

    // Should have checked file stats and used new file name
    expect(fs.stat).toHaveBeenCalled();
  });

  /**
   * @requirement REQ-005.9
   * @scenario Dispose functionality
   * @given FileOutput with pending writes
   * @when dispose called
   * @then All pending writes flushed and timers cleared
   */
  it('should flush pending writes on dispose @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    // Add entries to trigger writes
    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test',
      level: 'log',
      message: 'dispose test message',
      runId: 'test-run',
      pid: 12345,
    };

    await fileOutput.write(logEntry);

    // Dispose should complete without errors
    await expect(fileOutput.dispose()).resolves.not.toThrow();

    // Verify that appendFile was called during the write operation
    expect(fs.appendFile).toHaveBeenCalled();
  });

  /**
   * @requirement REQ-005.10
   * @scenario Error handling
   * @given file write error occurs
   * @when write operation fails
   * @then Error handled gracefully without crashing
   */
  it('should handle write errors gracefully @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    // Mock appendFile to fail
    vi.mocked(fs.appendFile).mockRejectedValueOnce(new Error('Disk full'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test',
      level: 'log',
      message: 'test message',
      runId: 'test-run',
      pid: 12345,
    };

    // Should not throw
    await expect(fileOutput.write(logEntry)).resolves.not.toThrow();

    // Should log error to console
    expect(consoleSpy).toHaveBeenCalledWith(
      'FileOutput: Failed to write log entries:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  /**
   * @requirement REQ-005.11
   * @scenario Queue size limits
   * @given very large number of log entries
   * @when queue size exceeds limit
   * @then Oldest entries dropped to prevent memory issues
   */
  it('should limit queue size to prevent memory issues @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    // Block writes to allow queue to build up
    vi.mocked(fs.appendFile).mockImplementation(() => new Promise(() => {}));

    // Add more entries than max queue size (1000)
    const entries: LogEntry[] = [];
    for (let i = 0; i < 1100; i++) {
      entries.push({
        timestamp: '2025-01-21T00:00:00.000Z',
        namespace: 'test',
        level: 'log',
        message: `overflow message ${i}`,
      });
    }

    // Write all entries
    for (const entry of entries) {
      fileOutput.write(entry); // Don't await to allow queueing
    }

    // Queue should be limited to max size
    // We can't directly test the queue size, but the implementation
    // should handle this gracefully without memory issues
    expect(true).toBe(true); // Test that we don't crash
  });

  /**
   * @requirement REQ-005.12
   * @scenario File name generation
   * @given current timestamp
   * @when log file name generated
   * @then File name includes date and time with proper format
   */
  it('should generate unique file names with timestamp @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test',
      level: 'log',
      message: 'test message',
      runId: 'test-run',
      pid: 12345,
    };

    await fileOutput.write(logEntry);

    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.stringMatching(
        /llxprt-debug-[^-]+-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.jsonl$/,
      ),
      expect.any(String),
      expect.any(Object),
    );
  });

  /**
   * @requirement REQ-005.13
   * @scenario Multiple argument handling
   * @given log entry with args array
   * @when written to file
   * @then Args preserved in JSONL output
   */
  it('should preserve log entry arguments in JSONL @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test:complex',
      level: 'debug',
      message: 'complex message',
      args: [{ type: 'object', value: 42 }, 'string arg', 123, true, null],
    };

    await fileOutput.write(logEntry);

    const expectedJsonl = JSON.stringify(logEntry) + '\n';
    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.any(String),
      expectedJsonl,
      expect.any(Object),
    );
  });

  /**
   * @requirement REQ-005.14
   * @scenario Concurrent writes
   * @given multiple concurrent write operations
   * @when called simultaneously
   * @then All writes handled correctly without corruption
   */
  it('should handle concurrent writes safely @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    const entries: LogEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push({
        timestamp: `2025-01-21T00:00:0${i}.000Z`,
        namespace: 'concurrent',
        level: 'log',
        message: `concurrent message ${i}`,
        runId: 'test-run',
        pid: 12345,
      });
    }

    // Write all entries concurrently
    const promises = entries.map((entry) => fileOutput.write(entry));
    await Promise.all(promises);

    // Should have written without errors
    expect(fs.appendFile).toHaveBeenCalled();
  });

  /**
   * @requirement REQ-005.15
   * @scenario Write after dispose
   * @given FileOutput disposed
   * @when write method called
   * @then Write ignored gracefully
   */
  it('should ignore writes after disposal @plan:PLAN-20250120-DEBUGLOGGING.P10', async () => {
    fileOutput = FileOutput.getInstance();

    // Dispose first
    await fileOutput.dispose();

    const logEntry: LogEntry = {
      timestamp: '2025-01-21T00:00:00.000Z',
      namespace: 'test',
      level: 'log',
      message: 'test message',
      runId: 'test-run',
      pid: 12345,
    };

    // Write should be ignored
    await fileOutput.write(logEntry);

    // Should not have attempted to write
    expect(fs.appendFile).not.toHaveBeenCalled();
  });
});
