/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { cleanupExpiredSessions } from './sessionCleanup.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { SESSION_FILE_PREFIX } from '@vybestack/llxprt-code-storage';
import type { Settings } from '../config/settings.js';
import * as fs from 'node:fs/promises';
import { type SessionInfo, getAllSessionFiles } from './sessionUtils.js';

vi.mock('fs/promises');
vi.mock('./sessionUtils.js', () => ({
  getAllSessionFiles: vi.fn(),
}));

import {
  createMockConfig,
  createTestSessions,
} from './sessionCleanup-test-helpers.js';

const mockFs = vi.mocked(fs);
const mockGetAllSessionFiles = vi.mocked(getAllSessionFiles);

describe('Session Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const sessions = createTestSessions();
    mockGetAllSessionFiles.mockResolvedValue(
      sessions.map((session) => ({
        fileName: session.fileName,
        sessionInfo: session,
      })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cleanupExpiredSessions', () => {
    it('should return early when cleanup is disabled', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: { enabled: false },
      };

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(true);
      expect(result.scanned).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should return early when sessionRetention is not configured', async () => {
      const config = createMockConfig();
      const settings: Settings = {};

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(true);
      expect(result.scanned).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it('should handle invalid maxAge configuration', async () => {
      const config = createMockConfig({
        getDebugMode: vi.fn().mockReturnValue(true),
      });
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: 'invalid-format',
        },
      };

      const errorSpy = vi
        .spyOn(DebugLogger.prototype, 'error')
        .mockImplementation(() => {});

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(true);
      expect(result.scanned).toBe(0);
      expect(result.deleted).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Session cleanup disabled: Error: Invalid retention period format',
        ),
      );

      errorSpy.mockRestore();
    });

    it('should delete sessions older than maxAge', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '10d', // 10 days
        },
      };

      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(4);
      expect(result.deleted).toBe(2); // Should delete the 2-week-old and 1-month-old sessions
      expect(result.skipped).toBe(2); // Current session + recent session should be skipped
      expect(result.failed).toBe(0);
    });

    it('should never delete current session', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '1d', // Very short retention
        },
      };

      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(config, settings);

      // Should delete all sessions except the current one
      expect(result.disabled).toBe(false);
      expect(result.deleted).toBe(3);

      // Verify that unlink was never called with the current session file
      const unlinkCalls = mockFs.unlink.mock.calls;
      const currentSessionPath = path.join(
        '/tmp/test-project',
        'chats',
        `${SESSION_FILE_PREFIX}2025-01-20T10-30-00-current12.json`,
      );
      expect(
        unlinkCalls.find((call) => call[0] === currentSessionPath),
      ).toBeUndefined();
    });

    it('should handle count-based retention', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxCount: 2, // Keep only 2 most recent sessions
        },
      };

      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(4);
      expect(result.deleted).toBe(2); // Should delete 2 oldest sessions (after skipping the current one)
      expect(result.skipped).toBe(2); // Current session + 1 recent session should be kept
    });

    it('should handle file system errors gracefully', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '1d',
        },
      };

      // Mock file operations to succeed for access and readFile but fail for unlink
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(4);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBeGreaterThan(0);
    });

    it('should handle empty sessions directory', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '30d',
        },
      };

      mockGetAllSessionFiles.mockResolvedValue([]);

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should handle global errors gracefully', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '30d',
        },
      };

      const errorSpy = vi
        .spyOn(DebugLogger.prototype, 'error')
        .mockImplementation(() => {});

      // Mock getSessionFiles to throw an error
      mockGetAllSessionFiles.mockRejectedValue(
        new Error('Directory access failed'),
      );

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(false);
      expect(result.failed).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        'Session cleanup failed: Directory access failed',
      );

      errorSpy.mockRestore();
    });

    it('should respect minRetention configuration', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '12h', // Less than 1 day minimum
          minRetention: '1d',
        },
      };

      const result = await cleanupExpiredSessions(config, settings);

      // Should disable cleanup due to minRetention violation
      expect(result.disabled).toBe(true);
      expect(result.scanned).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it('should log debug information when enabled', async () => {
      const config = createMockConfig({
        getDebugMode: vi.fn().mockReturnValue(true),
      });
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '10d',
        },
      };

      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      const debugSpy = vi
        .spyOn(DebugLogger.prototype, 'debug')
        .mockImplementation(() => {});

      await cleanupExpiredSessions(config, settings);

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session cleanup: deleted'),
      );
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted expired session:'),
      );

      debugSpy.mockRestore();
    });
  });

  describe('Specific cleanup scenarios', () => {
    it('should delete sessions that exceed the cutoff date', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '7d', // Keep sessions for 7 days
        },
      };

      // Create sessions with specific dates
      const now = new Date();
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

      const testSessions: SessionInfo[] = [
        {
          id: 'current',
          fileName: `${SESSION_FILE_PREFIX}current.json`,
          lastUpdated: now.toISOString(),
          isCurrentSession: true,
        },
        {
          id: 'session5d',
          fileName: `${SESSION_FILE_PREFIX}5d.json`,
          lastUpdated: fiveDaysAgo.toISOString(),
          isCurrentSession: false,
        },
        {
          id: 'session8d',
          fileName: `${SESSION_FILE_PREFIX}8d.json`,
          lastUpdated: eightDaysAgo.toISOString(),
          isCurrentSession: false,
        },
        {
          id: 'session15d',
          fileName: `${SESSION_FILE_PREFIX}15d.json`,
          lastUpdated: fifteenDaysAgo.toISOString(),
          isCurrentSession: false,
        },
      ];

      mockGetAllSessionFiles.mockResolvedValue(
        testSessions.map((session) => ({
          fileName: session.fileName,
          sessionInfo: session,
        })),
      );

      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(config, settings);

      // Should delete sessions older than 7 days (8d and 15d sessions)
      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(4);
      expect(result.deleted).toBe(2);
      expect(result.skipped).toBe(2); // Current + 5d session

      // Verify which files were deleted
      const unlinkCalls = mockFs.unlink.mock.calls.map((call) => call[0]);
      expect(unlinkCalls).toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}8d.json`,
        ),
      );
      expect(unlinkCalls).toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}15d.json`,
        ),
      );
      expect(unlinkCalls).not.toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}5d.json`,
        ),
      );
    });

    it('should NOT delete sessions within the cutoff date', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '14d', // Keep sessions for 14 days
        },
      };

      // Create sessions all within the retention period
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirteenDaysAgo = new Date(
        now.getTime() - 13 * 24 * 60 * 60 * 1000,
      );

      const testSessions: SessionInfo[] = [
        {
          id: 'current',
          fileName: `${SESSION_FILE_PREFIX}current.json`,
          lastUpdated: now.toISOString(),
          isCurrentSession: true,
        },
        {
          id: 'session1d',
          fileName: `${SESSION_FILE_PREFIX}1d.json`,
          lastUpdated: oneDayAgo.toISOString(),
          isCurrentSession: false,
        },
        {
          id: 'session7d',
          fileName: `${SESSION_FILE_PREFIX}7d.json`,
          lastUpdated: sevenDaysAgo.toISOString(),
          isCurrentSession: false,
        },
        {
          id: 'session13d',
          fileName: `${SESSION_FILE_PREFIX}13d.json`,
          lastUpdated: thirteenDaysAgo.toISOString(),
          isCurrentSession: false,
        },
      ];

      mockGetAllSessionFiles.mockResolvedValue(
        testSessions.map((session) => ({
          fileName: session.fileName,
          sessionInfo: session,
        })),
      );

      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(config, settings);

      // Should NOT delete any sessions as all are within 14 days
      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(4);
      expect(result.deleted).toBe(0);
      expect(result.skipped).toBe(4);
      expect(result.failed).toBe(0);

      // Verify no files were deleted
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    it('should keep N most recent deletable sessions', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxCount: 3, // Keep only 3 most recent sessions
        },
      };

      // Create 6 sessions with different timestamps
      const now = new Date();
      const sessions: SessionInfo[] = [
        {
          id: 'current',
          fileName: `${SESSION_FILE_PREFIX}current.json`,
          lastUpdated: now.toISOString(),
          isCurrentSession: true,
        },
      ];

      // Add 5 more sessions with decreasing timestamps
      for (let i = 1; i <= 5; i++) {
        const daysAgo = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        sessions.push({
          id: `session${i}`,
          fileName: `${SESSION_FILE_PREFIX}${i}d.json`,
          lastUpdated: daysAgo.toISOString(),
          isCurrentSession: false,
        });
      }

      mockGetAllSessionFiles.mockResolvedValue(
        sessions.map((session) => ({
          fileName: session.fileName,
          sessionInfo: session,
        })),
      );

      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(config, settings);

      // Should keep current + 2 most recent (1d and 2d), delete 3d, 4d, 5d
      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(6);
      expect(result.deleted).toBe(3);
      expect(result.skipped).toBe(3);

      // Verify which files were deleted (should be the 3 oldest)
      const unlinkCalls = mockFs.unlink.mock.calls.map((call) => call[0]);
      expect(unlinkCalls).toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}3d.json`,
        ),
      );
      expect(unlinkCalls).toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}4d.json`,
        ),
      );
      expect(unlinkCalls).toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}5d.json`,
        ),
      );

      // Verify which files were NOT deleted
      expect(unlinkCalls).not.toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}current.json`,
        ),
      );
      expect(unlinkCalls).not.toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}1d.json`,
        ),
      );
      expect(unlinkCalls).not.toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}2d.json`,
        ),
      );
    });

    it('should handle combined maxAge and maxCount retention (most restrictive wins)', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '10d', // Keep sessions for 10 days
          maxCount: 2, // But also keep only 2 most recent
        },
      };

      // Create sessions where maxCount is more restrictive
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twelveDaysAgo = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000);

      const testSessions: SessionInfo[] = [
        {
          id: 'current',
          fileName: `${SESSION_FILE_PREFIX}current.json`,
          lastUpdated: now.toISOString(),
          isCurrentSession: true,
        },
        {
          id: 'session3d',
          fileName: `${SESSION_FILE_PREFIX}3d.json`,
          lastUpdated: threeDaysAgo.toISOString(),
          isCurrentSession: false,
        },
        {
          id: 'session5d',
          fileName: `${SESSION_FILE_PREFIX}5d.json`,
          lastUpdated: fiveDaysAgo.toISOString(),
          isCurrentSession: false,
        },
        {
          id: 'session7d',
          fileName: `${SESSION_FILE_PREFIX}7d.json`,
          lastUpdated: sevenDaysAgo.toISOString(),
          isCurrentSession: false,
        },
        {
          id: 'session12d',
          fileName: `${SESSION_FILE_PREFIX}12d.json`,
          lastUpdated: twelveDaysAgo.toISOString(),
          isCurrentSession: false,
        },
      ];

      mockGetAllSessionFiles.mockResolvedValue(
        testSessions.map((session) => ({
          fileName: session.fileName,
          sessionInfo: session,
        })),
      );

      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: 'test',
          messages: [],
          startTime: '2025-01-01T00:00:00Z',
          lastUpdated: '2025-01-01T00:00:00Z',
        }),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(config, settings);

      // Should delete:
      // - session12d (exceeds maxAge of 10d)
      // - session7d and session5d (exceed maxCount of 2, keeping current + 3d)
      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(5);
      expect(result.deleted).toBe(3);
      expect(result.skipped).toBe(2); // Current + 3d session

      // Verify which files were deleted
      const unlinkCalls = mockFs.unlink.mock.calls.map((call) => call[0]);
      expect(unlinkCalls).toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}5d.json`,
        ),
      );
      expect(unlinkCalls).toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}7d.json`,
        ),
      );
      expect(unlinkCalls).toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}12d.json`,
        ),
      );

      // Verify which files were NOT deleted
      expect(unlinkCalls).not.toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}current.json`,
        ),
      );
      expect(unlinkCalls).not.toContain(
        path.join(
          '/tmp/test-project',
          'chats',
          `${SESSION_FILE_PREFIX}3d.json`,
        ),
      );
    });
  });
});
