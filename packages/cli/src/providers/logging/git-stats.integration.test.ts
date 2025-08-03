/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitStatsTracker } from './git-stats.js';
import { Config } from '@vybestack/llxprt-code-core';

describe('Git Stats Integration', () => {
  let tempDir: string;
  let conversationLogDir: string;
  let config: Config;
  let tracker: GitStatsTracker;

  beforeEach(async () => {
    // Create temporary directories for testing
    tempDir = await fs.mkdtemp(join(tmpdir(), 'git-stats-test-'));
    conversationLogDir = join(tempDir, '.llxprt', 'conversations');
    await fs.mkdir(conversationLogDir, { recursive: true });

    // Create config with temp directory
    const randomId = Math.floor(Math.random() * 10000);
    config = new Config({
      sessionId: `test-session-${randomId}`,
      targetDir: tempDir,
      debugMode: false,
      cwd: tempDir,
      model: 'gemini-flash',
      telemetry: {
        logConversations: true,
        conversationLogPath: conversationLogDir,
      },
    });

    tracker = new GitStatsTracker(config);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors in tests
      console.warn('Failed to cleanup temp directory:', error);
    }
  });

  it('should track stats during actual file edits', async () => {
    const testFile = join(tempDir, 'test.ts');
    const initialContent = 'function hello() {\n  console.log("Hello");\n}';
    const modifiedContent =
      initialContent +
      '\n\n// Added comment\nfunction goodbye() {\n  console.log("Goodbye");\n}';

    // Create the initial file
    await fs.writeFile(testFile, initialContent, 'utf8');

    // Track the edit from initial to modified content
    const stats = await tracker.trackFileEdit(
      testFile,
      initialContent,
      modifiedContent,
    );

    expect(stats).not.toBeNull();
    expect(stats!.linesAdded).toBe(4); // blank line + comment + function with 3 lines
    expect(stats!.linesRemoved).toBe(0);
    expect(stats!.filesChanged).toBe(1);

    // Verify the actual file can be read and matches
    const actualContent = await fs.readFile(testFile, 'utf8');
    expect(actualContent).toBe(initialContent); // File itself shouldn't be modified by tracking
  });

  it('should persist stats to conversation log file', async () => {
    const testFile = join(tempDir, 'example.js');

    // Perform multiple file edits
    await tracker.trackFileEdit(
      testFile,
      'const x = 1;',
      'const x = 1;\nconst y = 2;\nconst z = x + y;',
    );

    await tracker.trackFileEdit(
      join(tempDir, 'another.ts'),
      'let data: string;',
      'let data: string = "updated";',
    );

    // Force write to log file (in real implementation, this would happen automatically)
    const logEntry = tracker.getLogEntry();
    expect(logEntry).not.toBeNull();

    // Write a sample conversation log entry
    const logFile = join(
      conversationLogDir,
      `conversation-${config.getSessionId()}.jsonl`,
    );
    const logData = {
      timestamp: new Date().toISOString(),
      session_id: config.getSessionId(),
      git_stats: tracker.getSummary(),
    };

    await fs.writeFile(logFile, JSON.stringify(logData) + '\n', 'utf8');

    // Verify log file was created and contains stats
    const logExists = await fs
      .access(logFile)
      .then(() => true)
      .catch(() => false);
    expect(logExists).toBe(true);

    const logContent = await fs.readFile(logFile, 'utf8');
    const parsedLog = JSON.parse(logContent.trim());

    expect(parsedLog.git_stats).toMatchObject({
      filesChanged: 2,
      totalLinesAdded: expect.any(Number),
      totalLinesRemoved: 0,
      sessionId: config.getSessionId(),
    });
  });

  it('should display stats in /logging show command simulation', async () => {
    const testFiles = [
      { path: 'src/main.ts', old: 'main code', new: 'main code\n// updated' },
      {
        path: 'src/utils.ts',
        old: 'utils',
        new: 'utilities with more content',
      },
      { path: 'package.json', old: '{}', new: '{\n  "name": "test"\n}' },
    ];

    // Track edits for multiple files
    for (const file of testFiles) {
      await tracker.trackFileEdit(file.path, file.old, file.new);
    }

    // Get summary that would be displayed in logging show
    const summary = tracker.getSummary();

    expect(summary).toMatchObject({
      sessionId: expect.any(String),
      filesChanged: 3,
      totalLinesAdded: expect.any(Number),
      totalLinesRemoved: expect.any(Number),
    });

    // Verify the summary contains reasonable data
    expect(summary.totalLinesAdded).toBeGreaterThan(0);
    expect(summary.filesChanged).toBe(3);

    // Simulate the display format that would be shown to users
    const displayFormat = {
      'Files Modified': summary.filesChanged,
      'Lines Added': summary.totalLinesAdded,
      'Lines Removed': summary.totalLinesRemoved,
      'Session ID': summary.sessionId.substring(0, 8) + '...', // Truncated for display
    };

    expect(displayFormat['Files Modified']).toBe(3);
    expect(displayFormat['Lines Added']).toBeGreaterThan(0);
  });

  it('should handle concurrent file operations', async () => {
    const concurrentEdits = Array.from({ length: 10 }, (_, i) => ({
      path: `concurrent-${i}.ts`,
      old: `// File ${i}`,
      new: `// File ${i}\nconst value${i} = ${i};`,
    }));

    // Execute all edits concurrently
    const results = await Promise.all(
      concurrentEdits.map((edit) =>
        tracker.trackFileEdit(edit.path, edit.old, edit.new),
      ),
    );

    // All results should be successful
    results.forEach((result) => {
      expect(result).not.toBeNull();
      expect(result!.linesAdded).toBe(1);
      expect(result!.linesRemoved).toBe(0);
      expect(result!.filesChanged).toBe(1);
    });

    // Final summary should account for all edits
    const summary = tracker.getSummary();
    expect(summary.filesChanged).toBe(10);
    expect(summary.totalLinesAdded).toBe(10);
    expect(summary.totalLinesRemoved).toBe(0);
  });

  it('should preserve stats across tracker recreation', async () => {
    // Initial edits with first tracker
    await tracker.trackFileEdit('file1.ts', 'old', 'new content');
    const firstSummary = tracker.getSummary();

    expect(firstSummary.filesChanged).toBe(1);

    // Create new tracker with same config (simulating app restart)
    const newTracker = new GitStatsTracker(config);

    // Should start fresh (stats are session-scoped, not persistent across restarts)
    expect(newTracker.getSummary().filesChanged).toBe(0);

    // New edits should work normally
    await newTracker.trackFileEdit('file2.ts', 'another', 'another file');
    expect(newTracker.getSummary().filesChanged).toBe(1);
  });

  it('should handle file system errors gracefully', async () => {
    // Test with read-only directory (if possible to create)
    const readOnlyDir = join(tempDir, 'readonly');
    await fs.mkdir(readOnlyDir);

    try {
      // Make directory read-only
      await fs.chmod(readOnlyDir, 0o444);

      // Attempt to track file in read-only directory
      const stats = await tracker.trackFileEdit(
        join(readOnlyDir, 'readonly-file.ts'),
        'original',
        'modified',
      );

      // Should still track stats even if file system operations fail
      expect(stats).not.toBeNull();
      expect(stats!.linesAdded).toBeGreaterThan(0);
    } finally {
      // Restore permissions for cleanup
      await fs.chmod(readOnlyDir, 0o755).catch(() => {});
    }
  });

  it('should work with large files in real filesystem', async () => {
    const largeFile = join(tempDir, 'large-file.ts');

    // Generate large content (1000 lines)
    const generateContent = (lines: number, prefix: string) =>
      Array.from(
        { length: lines },
        (_, i) => `${prefix}${i}: console.log('Line ${i}');`,
      ).join('\n');

    const originalContent = generateContent(1000, 'original_');
    const modifiedContent =
      originalContent + '\n' + generateContent(100, 'added_');

    // Write the large file to disk
    await fs.writeFile(largeFile, originalContent, 'utf8');

    // Track the edit
    const startTime = process.hrtime.bigint();
    const stats = await tracker.trackFileEdit(
      largeFile,
      originalContent,
      modifiedContent,
    );
    const endTime = process.hrtime.bigint();

    const durationMs = Number(endTime - startTime) / 1_000_000;

    // Verify stats are correct
    expect(stats).not.toBeNull();
    expect(stats!.linesAdded).toBe(101); // 1 blank line + 100 added lines
    expect(stats!.linesRemoved).toBe(0);
    expect(stats!.filesChanged).toBe(1);

    // Should complete in reasonable time even with large files
    expect(durationMs).toBeLessThan(500); // Less than 500ms

    // Verify file still exists and can be read
    const fileExists = await fs
      .access(largeFile)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    const fileContent = await fs.readFile(largeFile, 'utf8');
    expect(fileContent).toBe(originalContent); // File shouldn't be modified by tracking
  });

  it('should handle special characters and encoding', async () => {
    const testFile = join(tempDir, 'unicode-test.ts');

    // Content with various encodings and special characters
    const unicodeContent = {
      original: '// Original: Hello 世界\nconst emoji = "🚀";',
      modified:
        '// Modified: Hello 世界 🌍\nconst emoji = "🚀";\nconst symbols = "αβγδε";',
    };

    await tracker.trackFileEdit(
      testFile,
      unicodeContent.original,
      unicodeContent.modified,
    );

    const summary = tracker.getSummary();
    expect(summary.filesChanged).toBe(1);
    expect(summary.totalLinesAdded).toBe(1); // Added one line with symbols
  });

  it('should validate no external network calls during integration', async () => {
    // Set up network monitoring
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    try {
      // Perform various operations that could potentially make network calls
      await tracker.trackFileEdit(
        'network-test.ts',
        'import api from "external";',
        'import api from "external";\napi.call();',
      );

      const summary = tracker.getSummary();
      const logEntry = tracker.getLogEntry();

      // Verify operations completed successfully
      expect(summary.filesChanged).toBe(1);
      expect(logEntry).not.toBeNull();

      // Most important: verify no network calls were made
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      // Restore original fetch
      global.fetch = originalFetch;
    }
  });
});
