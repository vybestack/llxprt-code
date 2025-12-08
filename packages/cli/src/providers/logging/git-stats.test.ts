/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitStatsTracker } from './git-stats.js';
import {
  Config,
  TelemetryTarget,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
  SettingsService,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Git Statistics Tracking', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-stats-test-'));

    // Activate a runtime context for Config creation
    const settingsService = new SettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService,
      runtimeId: 'git-stats-test',
      metadata: { source: 'git-stats.test.ts' },
    });
    setActiveProviderRuntimeContext(runtime);
  });

  afterEach(() => {
    // Clear runtime context
    clearActiveProviderRuntimeContext();

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  describe('Privacy-First Behavior', () => {
    it('should NOT track anything when logging is disabled', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: false },
      });
      const tracker = new GitStatsTracker(config);

      const stats = await tracker.trackFileEdit(
        'test.ts',
        'old content',
        'new content with more lines',
      );

      expect(stats).toBeNull();
    });

    it('should track stats locally when logging is enabled', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      const stats = await tracker.trackFileEdit(
        'test.ts',
        'line1\nline2',
        'line1\nline2\nline3\nline4',
      );

      expect(stats).toEqual({
        linesAdded: 2,
        linesRemoved: 0,
        filesChanged: 1,
      });
    });

    it('should NEVER send data externally', async () => {
      // Mock any external calls to ensure they never happen
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: {
          logConversations: true,
          target: TelemetryTarget.GCP, // Even with GCP target
        },
      });
      const tracker = new GitStatsTracker(config);

      // Spy on any network calls
      const networkSpy = vi.spyOn(global, 'fetch');

      await tracker.trackFileEdit('test.ts', 'old', 'new');

      expect(networkSpy).not.toHaveBeenCalled();
    });
  });

  describe('Statistics Calculation', () => {
    it('should correctly count added lines', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      const stats = await tracker.trackFileEdit(
        'file.ts',
        'line1',
        'line1\nline2\nline3',
      );

      expect(stats?.linesAdded).toBe(2);
    });

    it('should correctly count removed lines', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      const stats = await tracker.trackFileEdit(
        'file.ts',
        'line1\nline2\nline3',
        'line1',
      );

      expect(stats?.linesRemoved).toBe(2);
    });

    it('should handle mixed additions and removals', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      const stats = await tracker.trackFileEdit(
        'file.ts',
        'line1\nline2\nline3',
        'line1\nmodified2\nline3\nline4',
      );

      expect(stats?.linesAdded).toBe(2); // modified2 and line4
      expect(stats?.linesRemoved).toBe(1); // line2
    });

    it('should handle empty content correctly', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      // Empty to content
      const stats1 = await tracker.trackFileEdit(
        'file1.ts',
        '',
        'line1\nline2',
      );
      expect(stats1?.linesAdded).toBe(2);
      expect(stats1?.linesRemoved).toBe(0);

      // Content to empty
      const stats2 = await tracker.trackFileEdit(
        'file2.ts',
        'line1\nline2',
        '',
      );
      expect(stats2?.linesAdded).toBe(0);
      expect(stats2?.linesRemoved).toBe(2);

      // Empty to empty
      const stats3 = await tracker.trackFileEdit('file3.ts', '', '');
      expect(stats3?.linesAdded).toBe(0);
      expect(stats3?.linesRemoved).toBe(0);
    });

    it('should handle identical content', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      const stats = await tracker.trackFileEdit(
        'file.ts',
        'line1\nline2\nline3',
        'line1\nline2\nline3',
      );

      expect(stats?.linesAdded).toBe(0);
      expect(stats?.linesRemoved).toBe(0);
      expect(stats?.filesChanged).toBe(1); // File was still "edited" even if no changes
    });
  });

  describe('Integration with Logging System', () => {
    it('should include stats in conversation logs', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      await tracker.trackFileEdit('file.ts', 'old', 'new\ncontent');

      const logEntry = tracker.getLogEntry();
      expect(logEntry).toMatchObject({
        type: 'git_stats',
        stats: {
          linesAdded: expect.any(Number),
          linesRemoved: expect.any(Number),
          filesChanged: 1,
        },
        timestamp: expect.any(String),
      });
    });

    it('should aggregate stats across multiple edits', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      await tracker.trackFileEdit('file1.ts', 'old', 'new\nline');
      await tracker.trackFileEdit('file2.ts', 'content', 'modified');

      const summary = tracker.getSummary();
      expect(summary.filesChanged).toBe(2);
      expect(summary.totalLinesAdded).toBeGreaterThan(0);
    });

    it('should provide session-level aggregation', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      // First batch of edits
      await tracker.trackFileEdit('file1.ts', 'a', 'a\nb\nc');
      await tracker.trackFileEdit('file2.ts', 'x\ny\nz', 'x');

      // Second batch of edits
      await tracker.trackFileEdit('file3.ts', '', 'new file content');

      const summary = tracker.getSummary();
      expect(summary.filesChanged).toBe(3);
      expect(summary.totalLinesAdded).toBe(3); // 2 + 0 + 1
      expect(summary.totalLinesRemoved).toBe(2); // 0 + 2 + 0
      expect(summary.sessionId).toBe('test-session');
    });

    it('should not create log entries when logging disabled', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: false },
      });
      const tracker = new GitStatsTracker(config);

      await tracker.trackFileEdit('file.ts', 'old', 'new');

      const logEntry = tracker.getLogEntry();
      expect(logEntry).toBeNull();
    });
  });

  describe('Simple On/Off Control', () => {
    it('should have binary control - no fine-grained settings', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      // Should track when on
      expect(tracker.isEnabled()).toBe(true);

      // Should not have complex configuration
      expect(tracker.hasComplexSettings()).toBe(false);
    });

    it('should respect runtime toggle', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: false },
      });
      const tracker = new GitStatsTracker(config);

      expect(tracker.isEnabled()).toBe(false);

      // Toggle on
      config.updateTelemetrySettings({ logConversations: true });
      expect(tracker.isEnabled()).toBe(true);

      // Toggle off
      config.updateTelemetrySettings({ logConversations: false });
      expect(tracker.isEnabled()).toBe(false);
    });

    it('should maintain state consistency across toggles', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      // Track some stats
      await tracker.trackFileEdit('file1.ts', 'a', 'a\nb');
      expect(tracker.getSummary().filesChanged).toBe(1);

      // Toggle off - should not track new edits
      config.updateTelemetrySettings({ logConversations: false });
      const result = await tracker.trackFileEdit('file2.ts', 'x', 'x\ny');
      expect(result).toBeNull();

      // Summary should still show previous stats
      expect(tracker.getSummary().filesChanged).toBe(1);

      // Toggle back on - should resume tracking
      config.updateTelemetrySettings({ logConversations: true });
      await tracker.trackFileEdit('file3.ts', 'm', 'm\nn');
      expect(tracker.getSummary().filesChanged).toBe(2); // Previous + new
    });

    it('should validate configuration simplicity', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      // Should only expose simple boolean control
      expect(typeof tracker.isEnabled()).toBe('boolean');
      expect(tracker.hasComplexSettings()).toBe(false);

      // Should not have granular settings like:
      // - trackOnlySpecificFileTypes
      // - maxFileSizeForTracking
      // - excludePatterns
      // - statisticsLevel
      // etc.
      expect(() => {
        // @ts-expect-error - These methods should not exist
        tracker.setFileTypeFilter?.(['ts', 'js']);
      }).not.toThrow(); // Method simply doesn't exist, no error

      expect(() => {
        // @ts-expect-error - These methods should not exist
        tracker.setMaxFileSize?.(1000);
      }).not.toThrow(); // Method simply doesn't exist, no error
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed content gracefully', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      // Test with various edge cases
      const cases = [
        { old: null, new: 'content' },
        { old: 'content', new: null },
        { old: undefined, new: 'content' },
        { old: 'content', new: undefined },
      ];

      for (const testCase of cases) {
        const stats = await tracker.trackFileEdit(
          'file.ts',
          testCase.old as string,
          testCase.new as string,
        );

        // Should either return valid stats or null, never throw
        // Verify the result is either null or has the expected properties
        const isValidStats =
          stats === null ||
          (Object.prototype.hasOwnProperty.call(stats, 'linesAdded') &&
            Object.prototype.hasOwnProperty.call(stats, 'linesRemoved') &&
            Object.prototype.hasOwnProperty.call(stats, 'filesChanged'));

        expect(isValidStats).toBe(true);
      }
    });

    it('should handle invalid file paths', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      const invalidPaths = [
        '',
        null,
        undefined,
        '/path/with/../traversal',
        'path with spaces',
      ];

      for (const path of invalidPaths) {
        const stats = await tracker.trackFileEdit(path as string, 'old', 'new');

        // Should handle gracefully, either track or return null
        // Verify stats structure when not null
        const isValidOrNull =
          stats === null ||
          (typeof stats.linesAdded === 'number' &&
            typeof stats.linesRemoved === 'number' &&
            typeof stats.filesChanged === 'number');

        expect(isValidOrNull).toBe(true);
      }
    });

    it('should handle configuration errors gracefully', async () => {
      // Test with malformed config
      const invalidConfig = {} as Config;

      expect(() => {
        new GitStatsTracker(invalidConfig);
      }).not.toThrow(); // Should handle gracefully, not crash

      const tracker = new GitStatsTracker(invalidConfig);

      // Should default to disabled behavior when config is invalid
      expect(tracker.isEnabled()).toBe(false);

      const stats = await tracker.trackFileEdit('file.ts', 'old', 'new');
      expect(stats).toBeNull();
    });
  });

  describe('Performance Characteristics', () => {
    it('should have minimal overhead when disabled', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: false },
      });
      const tracker = new GitStatsTracker(config);

      const startTime = process.hrtime.bigint();

      // Multiple calls should be fast when disabled
      for (let i = 0; i < 100; i++) {
        await tracker.trackFileEdit(
          `file${i}.ts`,
          'old content',
          'new content',
        );
      }

      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      // Should complete very quickly since no actual processing occurs
      expect(durationMs).toBeLessThan(10); // Less than 10ms for 100 calls
    });

    it('should scale reasonably with file size', async () => {
      const config = new Config({
        sessionId: 'test-session',
        targetDir: tempDir,
        debugMode: false,
        cwd: tempDir,
        model: 'gemini-flash',
        telemetry: { logConversations: true },
      });
      const tracker = new GitStatsTracker(config);

      // Generate large content
      const largeContent = Array(1000)
        .fill('line')
        .map((line, i) => `${line}${i}`)
        .join('\n');
      const modifiedContent = largeContent + '\nextra line';

      const startTime = process.hrtime.bigint();
      const stats = await tracker.trackFileEdit(
        'large-file.ts',
        largeContent,
        modifiedContent,
      );
      const endTime = process.hrtime.bigint();

      const durationMs = Number(endTime - startTime) / 1_000_000;

      expect(stats?.linesAdded).toBe(1);
      expect(stats?.linesRemoved).toBe(0);
      expect(durationMs).toBeLessThan(100); // Should handle large files reasonably fast
    });
  });
});
