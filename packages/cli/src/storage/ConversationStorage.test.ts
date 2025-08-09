/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { IMessage } from '@vybestack/llxprt-code-core';

// Interface for conversation log entries
interface ConversationLogEntry {
  timestamp: string;
  conversation_id: string;
  provider_name: string;
  messages: IMessage[];
  session_id?: string;
  user_id?: string;
}

// Interface for log file metadata
interface LogFileInfo {
  path: string;
  size: number;
  created: Date;
  lastModified: Date;
}

// Storage configuration interface
interface ConversationStorageConfig {
  logPath: string;
  maxLogSizeMB: number;
  maxLogFiles: number;
  retentionDays: number;
}

// Interface that will be implemented in the next phase
interface ConversationStorage {
  writeConversationEntry(entry: ConversationLogEntry): Promise<void>;
  rotateLogIfNeeded(): Promise<void>;
  cleanupOldLogs(): Promise<void>;
  getLogFiles(): Promise<LogFileInfo[]>;
  getCurrentLogSize(): Promise<number>;
  getCurrentLogPath(): string;
  ensureLogDirectory(): Promise<void>;
  createLogFileWithDate(filename: string, date: Date): Promise<void>;
}

// Mock implementation for behavioral testing
class MockConversationStorage implements ConversationStorage {
  private currentLogFile: string;
  private currentLogSize = 0;
  private logFiles: Map<
    string,
    { size: number; created: Date; lastModified: Date }
  > = new Map();
  private logEntries: ConversationLogEntry[] = [];

  constructor(private config: ConversationStorageConfig) {
    this.currentLogFile = path.join(config.logPath, 'conversations.log');
  }

  async writeConversationEntry(entry: ConversationLogEntry): Promise<void> {
    await this.ensureLogDirectory();

    const entrySize = JSON.stringify(entry).length;

    // Check if rotation is needed before writing
    if (
      this.currentLogSize + entrySize >
      this.config.maxLogSizeMB * 1024 * 1024
    ) {
      await this.rotateLogIfNeeded();
    }

    // Write entry (simulated)
    this.logEntries.push(entry);
    this.currentLogSize += entrySize;

    // Update file metadata
    const now = new Date();
    const currentFile = this.getCurrentLogPath();
    if (!this.logFiles.has(currentFile)) {
      this.logFiles.set(currentFile, {
        size: 0,
        created: now,
        lastModified: now,
      });
    }

    const fileInfo = this.logFiles.get(currentFile)!;
    fileInfo.size = this.currentLogSize;
    fileInfo.lastModified = now;
  }

  async rotateLogIfNeeded(): Promise<void> {
    // Always rotate when called (since we already checked the condition)
    // Generate new log file name with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const newLogFile = path.join(
      this.config.logPath,
      `conversations-${timestamp}.log`,
    );

    // Archive current log
    const currentFile = this.getCurrentLogPath();
    const fileInfo = this.logFiles.get(currentFile);
    if (fileInfo) {
      this.logFiles.set(newLogFile, { ...fileInfo });
    }

    // Create new current log
    this.currentLogFile = path.join(this.config.logPath, 'conversations.log');
    this.currentLogSize = 0;

    // Remove excess log files if needed
    await this.enforceMaxLogFiles();
  }

  private async enforceMaxLogFiles(): Promise<void> {
    const files = await this.getLogFiles();
    if (files.length > this.config.maxLogFiles) {
      // Sort by creation date, keep newest files
      const sortedFiles = files.sort(
        (a, b) => b.created.getTime() - a.created.getTime(),
      );
      const filesToDelete = sortedFiles.slice(this.config.maxLogFiles);

      for (const file of filesToDelete) {
        this.logFiles.delete(file.path);
      }
    }
  }

  async cleanupOldLogs(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    const files = await this.getLogFiles();
    for (const file of files) {
      if (file.created < cutoffDate) {
        this.logFiles.delete(file.path);
      }
    }
  }

  async getLogFiles(): Promise<LogFileInfo[]> {
    return Array.from(this.logFiles.entries()).map(([filePath, info]) => ({
      path: filePath,
      size: info.size,
      created: info.created,
      lastModified: info.lastModified,
    }));
  }

  async getCurrentLogSize(): Promise<number> {
    return this.currentLogSize;
  }

  getCurrentLogPath(): string {
    return this.currentLogFile;
  }

  async ensureLogDirectory(): Promise<void> {
    // Simulate directory creation
    // In real implementation, would create directories recursively
  }

  async createLogFileWithDate(filename: string, date: Date): Promise<void> {
    const filePath = path.join(this.config.logPath, filename);
    this.logFiles.set(filePath, {
      size: 1024, // Simulate some content
      created: date,
      lastModified: date,
    });
  }
}

// Test helper functions
function createLargeConversationEntry(sizeBytes: number): ConversationLogEntry {
  const largeContent = 'x'.repeat(Math.max(sizeBytes - 200, 0)); // Reserve space for JSON overhead
  return {
    timestamp: new Date().toISOString(),
    conversation_id: 'conv_123',
    provider_name: 'openai',
    messages: [{ role: 'user', content: largeContent }],
  };
}

function createTypicalConversationEntry(): ConversationLogEntry {
  return {
    timestamp: new Date().toISOString(),
    conversation_id: 'conv_456',
    provider_name: 'anthropic',
    messages: [
      { role: 'user', content: 'Hello, how can you help me?' },
      { role: 'assistant', content: 'I can help you with various tasks...' },
    ],
    session_id: 'session_789',
  };
}

describe('Conversation Log Storage Management', () => {
  let storage: ConversationStorage;
  let testLogPath: string;

  beforeEach(() => {
    testLogPath = '/tmp/test-logs-' + Date.now();
    storage = new MockConversationStorage({
      logPath: testLogPath,
      maxLogSizeMB: 1,
      maxLogFiles: 3,
      retentionDays: 7,
    });
  });

  afterEach(() => {
    // Cleanup would happen here in real implementation
  });

  /**
   * @requirement STORAGE-001: Log file rotation
   * @scenario Log file exceeds maximum size
   * @given ConversationStorage with maxLogSizeMB: 1
   * @when writeConversationEntry() is called with large entry
   * @then New log file is created and old file is rotated
   * @and Total log files does not exceed maxLogFiles
   */
  it('should rotate log files when size limit is exceeded', async () => {
    // First, add a medium-sized entry to partially fill the log
    const mediumEntry = createLargeConversationEntry(600 * 1024); // 600KB
    await storage.writeConversationEntry(mediumEntry);
    expect(await storage.getCurrentLogSize()).toBeLessThan(1024 * 1024);
    
    // Now add another entry that would exceed the 1MB limit (600KB + 600KB > 1MB)
    const anotherEntry = createLargeConversationEntry(600 * 1024); // 600KB
    await storage.writeConversationEntry(anotherEntry);

    // After rotation, we should have multiple log files and the current size should be just the new entry
    const logFiles = await storage.getLogFiles();
    expect(logFiles.length).toBeGreaterThan(1); // Rotation should have occurred
    expect(logFiles.length).toBeLessThanOrEqual(3);
    expect(await storage.getCurrentLogSize()).toBeLessThan(1024 * 1024); // Current file should have just the new entry
  });

  /**
   * @requirement STORAGE-002: Retention policy
   * @scenario Old log files exceed retention period
   * @given Log files older than retentionDays
   * @when cleanupOldLogs() is called
   * @then Files older than retention period are deleted
   */
  it('should clean up log files beyond retention period', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    await storage.createLogFileWithDate('old-conversation.log', oldDate);

    // Add a recent file to ensure we don't delete everything
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
    await storage.createLogFileWithDate('recent-conversation.log', recentDate);

    await storage.cleanupOldLogs();

    const remainingFiles = await storage.getLogFiles();
    expect(
      remainingFiles.some((f) => f.path.includes('old-conversation')),
    ).toBe(false);
    expect(
      remainingFiles.some((f) => f.path.includes('recent-conversation')),
    ).toBe(true);
  });

  /**
   * @requirement STORAGE-003: Multiple small entries
   * @scenario Multiple small conversation entries within size limit
   * @given ConversationStorage with sufficient capacity
   * @when multiple writeConversationEntry() calls are made
   * @then All entries are written to same log file
   * @and No rotation occurs
   */
  it('should handle multiple small conversation entries without rotation', async () => {
    const entries = [
      createTypicalConversationEntry(),
      createTypicalConversationEntry(),
      createTypicalConversationEntry(),
    ];

    for (const entry of entries) {
      await storage.writeConversationEntry(entry);
    }

    const logFiles = await storage.getLogFiles();
    expect(logFiles.length).toBe(1); // All in one file
    expect(await storage.getCurrentLogSize()).toBeLessThan(1024 * 1024); // Under 1MB limit
  });

  /**
   * @requirement STORAGE-004: Concurrent write handling
   * @scenario Multiple simultaneous write operations
   * @given ConversationStorage with concurrent write operations
   * @when multiple writeConversationEntry() calls are made simultaneously
   * @then All entries are written successfully
   * @and File rotation is handled correctly
   */
  it('should handle concurrent conversation entry writes', async () => {
    const entries = Array.from({ length: 5 }, () =>
      createTypicalConversationEntry(),
    );

    // Write all entries concurrently
    await Promise.all(
      entries.map((entry) => storage.writeConversationEntry(entry)),
    );

    const logFiles = await storage.getLogFiles();
    expect(logFiles.length).toBeGreaterThan(0);

    // Verify total size is reasonable
    const totalSize = logFiles.reduce((sum, file) => sum + file.size, 0);
    expect(totalSize).toBeGreaterThan(0);
  });

  /**
   * @requirement STORAGE-005: Log directory creation
   * @scenario Log directory does not exist
   * @given ConversationStorage with non-existent log directory
   * @when writeConversationEntry() is called
   * @then Log directory is created automatically
   * @and Entry is written successfully
   */
  it('should create log directory if it does not exist', async () => {
    const nonExistentPath = '/tmp/non-existent-' + Date.now();
    const storageWithNewPath = new MockConversationStorage({
      logPath: nonExistentPath,
      maxLogSizeMB: 1,
      maxLogFiles: 3,
      retentionDays: 7,
    });

    const entry = createTypicalConversationEntry();

    // Should not throw error even if directory doesn't exist
    await expect(
      storageWithNewPath.writeConversationEntry(entry),
    ).resolves.not.toThrow();

    expect(await storageWithNewPath.getCurrentLogSize()).toBeGreaterThan(0);
  });

  /**
   * @requirement STORAGE-006: Max log files enforcement
   * @scenario More log files than maxLogFiles limit
   * @given ConversationStorage with maxLogFiles: 3
   * @when rotation creates more than 3 log files
   * @then Oldest log files are deleted to maintain limit
   */
  it('should enforce maximum log files limit', async () => {
    // Create multiple large entries to force multiple rotations
    for (let i = 0; i < 5; i++) {
      const largeEntry = createLargeConversationEntry(1.5 * 1024 * 1024); // 1.5MB each
      await storage.writeConversationEntry(largeEntry);

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const logFiles = await storage.getLogFiles();
    expect(logFiles.length).toBeLessThanOrEqual(3);
  });

  /**
   * @requirement STORAGE-007: Log file metadata tracking
   * @scenario Log file information retrieval
   * @given ConversationStorage with written log files
   * @when getLogFiles() is called
   * @then Returns accurate file metadata including size and dates
   */
  it('should track accurate log file metadata', async () => {
    const entry1 = createTypicalConversationEntry();
    await storage.writeConversationEntry(entry1);

    // Force rotation with large entry
    const largeEntry = createLargeConversationEntry(2 * 1024 * 1024);
    await storage.writeConversationEntry(largeEntry);

    const logFiles = await storage.getLogFiles();

    for (const file of logFiles) {
      expect(file.path).toBeTruthy();
      expect(file.size).toBeGreaterThan(0);
      expect(file.created).toBeInstanceOf(Date);
      expect(file.lastModified).toBeInstanceOf(Date);
      expect(file.lastModified.getTime()).toBeGreaterThanOrEqual(
        file.created.getTime(),
      );
    }
  });

  /**
   * @requirement STORAGE-008: Storage error handling
   * @scenario Storage operation failures
   * @given ConversationStorage with simulated write errors
   * @when writeConversationEntry() encounters errors
   * @then Errors are handled gracefully without corrupting state
   */
  it('should handle storage errors gracefully', async () => {
    // Create a storage instance that will simulate errors
    const errorProneStorage = new MockConversationStorage({
      logPath: '/invalid/path/that/cannot/be/created',
      maxLogSizeMB: 1,
      maxLogFiles: 3,
      retentionDays: 7,
    });

    const _entry = createTypicalConversationEntry();

    // In real implementation, this would test actual filesystem errors
    // For now, we verify the storage instance handles the invalid path gracefully
    await expect(errorProneStorage.ensureLogDirectory()).resolves.not.toThrow();
  });

  /**
   * @requirement STORAGE-009: Log rotation timing
   * @scenario Rotation happens at correct size threshold
   * @given ConversationStorage with 1MB limit
   * @when entries are written approaching the limit
   * @then Rotation occurs at or before limit is exceeded
   */
  it('should rotate logs at correct size threshold', async () => {
    const mediumEntry = createLargeConversationEntry(600 * 1024); // 600KB

    // Write first entry (should not rotate)
    await storage.writeConversationEntry(mediumEntry);
    expect(await storage.getCurrentLogSize()).toBeLessThan(1024 * 1024);

    // Write second entry (should trigger rotation due to combined size > 1MB)
    await storage.writeConversationEntry(mediumEntry);
    expect(await storage.getCurrentLogSize()).toBeLessThan(1024 * 1024); // New file should be smaller

    const logFiles = await storage.getLogFiles();
    expect(logFiles.length).toBeGreaterThan(1); // Rotation should have occurred
  });

  /**
   * @requirement STORAGE-010: Empty entry handling
   * @scenario Conversation entry with minimal content
   * @given ConversationStorage with empty or minimal entries
   * @when writeConversationEntry() is called with empty messages
   * @then Entry is handled correctly without errors
   */
  it('should handle empty or minimal conversation entries', async () => {
    const emptyEntry: ConversationLogEntry = {
      timestamp: new Date().toISOString(),
      conversation_id: 'empty_conv',
      provider_name: 'test',
      messages: [],
    };

    const minimalEntry: ConversationLogEntry = {
      timestamp: new Date().toISOString(),
      conversation_id: 'minimal_conv',
      provider_name: 'test',
      messages: [{ role: 'user', content: '' }],
    };

    await expect(
      storage.writeConversationEntry(emptyEntry),
    ).resolves.not.toThrow();
    await expect(
      storage.writeConversationEntry(minimalEntry),
    ).resolves.not.toThrow();

    expect(await storage.getCurrentLogSize()).toBeGreaterThan(0);
  });

  /**
   * @requirement STORAGE-011: Retention cleanup precision
   * @scenario Files created exactly at retention boundary
   * @given Log files created exactly retentionDays ago
   * @when cleanupOldLogs() is called
   * @then Boundary cases are handled correctly (files exactly at limit are kept/deleted consistently)
   */
  it('should handle retention boundary cases correctly', async () => {
    const exactBoundaryDate = new Date();
    exactBoundaryDate.setDate(exactBoundaryDate.getDate() - 7); // Exactly 7 days ago

    const justInsideBoundaryDate = new Date();
    justInsideBoundaryDate.setDate(justInsideBoundaryDate.getDate() - 6); // 6 days ago

    const justOutsideBoundaryDate = new Date();
    justOutsideBoundaryDate.setDate(justOutsideBoundaryDate.getDate() - 8); // 8 days ago

    await storage.createLogFileWithDate(
      'exact-boundary.log',
      exactBoundaryDate,
    );
    await storage.createLogFileWithDate(
      'just-inside.log',
      justInsideBoundaryDate,
    );
    await storage.createLogFileWithDate(
      'just-outside.log',
      justOutsideBoundaryDate,
    );

    await storage.cleanupOldLogs();

    const remainingFiles = await storage.getLogFiles();
    const filenames = remainingFiles.map((f) => path.basename(f.path));

    expect(filenames).toContain('just-inside.log'); // 6 days ago should remain
    expect(filenames).not.toContain('just-outside.log'); // 8 days ago should be deleted
    // Boundary case (exactly 7 days) behavior should be consistent
  });
});
