/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';

// Mock fs before importing the module under test
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
      readdir: vi.fn(),
      readFile: vi.fn(),
      access: vi.fn(),
    },
  };
});

import * as fs from 'node:fs';
import {
  SessionPersistenceService,
  type PersistedSession,
} from './SessionPersistenceService.js';
import { Storage } from '../config/storage.js';

describe('SessionPersistenceService', () => {
  const mockProjectRoot = '/test/project';
  const mockSessionId = 'test-session-123';
  let storage: Storage;
  let service: SessionPersistenceService;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new Storage(mockProjectRoot);
    service = new SessionPersistenceService(storage, mockSessionId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create chats directory path based on storage', () => {
      const chatsDir = service.getChatsDir();
      expect(chatsDir).toContain('chats');
      expect(chatsDir).toContain(storage.getProjectTempDir());
    });

    it('should create session file path with timestamp', () => {
      const sessionPath = service.getSessionFilePath();
      expect(sessionPath).toContain('persisted-session-');
      expect(sessionPath.endsWith('.json')).toBe(true);
    });

    it('should create unique timestamps for different instances', async () => {
      const service1 = new SessionPersistenceService(storage, 'session1');
      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));
      const service2 = new SessionPersistenceService(storage, 'session2');

      expect(service1.getSessionFilePath()).not.toBe(
        service2.getSessionFilePath(),
      );
    });
  });

  describe('save()', () => {
    beforeEach(() => {
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.promises.writeFile).mockResolvedValue();
      vi.mocked(fs.promises.rename).mockResolvedValue();
    });

    it('should create chats directory if not exists', async () => {
      await service.save([], undefined, []);

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('chats'),
        { recursive: true },
      );
    });

    it('should write to temp file then rename (atomic write)', async () => {
      await service.save([], undefined, []);

      // Should write to .tmp file first
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        expect.any(String),
        'utf-8',
      );

      // Then rename to final path
      expect(fs.promises.rename).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        expect.stringMatching(/\.json$/),
      );
    });

    it('should include all required fields in saved session', async () => {
      let savedContent = '';
      vi.mocked(fs.promises.writeFile).mockImplementation(
        async (_path, content) => {
          savedContent = content as string;
        },
      );

      const history = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ];
      const metadata = { provider: 'test', model: 'test-model' };
      const uiHistory = [{ id: 1, type: 'user', text: 'hello' }];

      await service.save(
        history as unknown as Array<
          import('../services/history/IContent.js').IContent
        >,
        metadata,
        uiHistory,
      );

      const parsed = JSON.parse(savedContent) as PersistedSession;
      expect(parsed.version).toBe(1);
      expect(parsed.sessionId).toBe(mockSessionId);
      expect(parsed.projectHash).toBeDefined();
      expect(parsed.projectHash.length).toBe(64); // SHA-256 hex length
      expect(parsed.createdAt).toBeDefined();
      expect(parsed.updatedAt).toBeDefined();
      expect(parsed.history).toEqual(history);
      expect(parsed.uiHistory).toEqual(uiHistory);
      expect(parsed.metadata).toEqual(metadata);
    });

    it('should preserve createdAt across multiple saves', async () => {
      let firstCreatedAt: string | null = null;
      let secondCreatedAt: string | null = null;

      vi.mocked(fs.promises.writeFile).mockImplementation(
        async (_path, content) => {
          const parsed = JSON.parse(content as string) as PersistedSession;
          if (!firstCreatedAt) {
            firstCreatedAt = parsed.createdAt;
          } else {
            secondCreatedAt = parsed.createdAt;
          }
        },
      );

      await service.save([], undefined, []);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.save([], undefined, []);

      expect(firstCreatedAt).toBe(secondCreatedAt);
    });

    it('should update updatedAt on each save', async () => {
      let firstUpdatedAt: string | null = null;
      let secondUpdatedAt: string | null = null;

      vi.mocked(fs.promises.writeFile).mockImplementation(
        async (_path, content) => {
          const parsed = JSON.parse(content as string) as PersistedSession;
          if (!firstUpdatedAt) {
            firstUpdatedAt = parsed.updatedAt;
          } else {
            secondUpdatedAt = parsed.updatedAt;
          }
        },
      );

      await service.save([], undefined, []);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.save([], undefined, []);

      expect(firstUpdatedAt).not.toBe(secondUpdatedAt);
    });

    it('should throw on mkdir failure', async () => {
      vi.mocked(fs.promises.mkdir).mockRejectedValue(
        new Error('Permission denied'),
      );

      await expect(service.save([], undefined, [])).rejects.toThrow(
        'Permission denied',
      );
    });

    it('should throw on write failure', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValue(
        new Error('Disk full'),
      );

      await expect(service.save([], undefined, [])).rejects.toThrow(
        'Disk full',
      );
    });

    it('should throw on rename failure', async () => {
      vi.mocked(fs.promises.rename).mockRejectedValue(new Error('IO error'));

      await expect(service.save([], undefined, [])).rejects.toThrow('IO error');
    });
  });

  describe('loadMostRecent()', () => {
    const getProjectHash = () =>
      crypto.createHash('sha256').update(mockProjectRoot).digest('hex');

    it('should return null if chats directory does not exist', async () => {
      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.mocked(fs.promises.readdir).mockRejectedValue(enoentError);

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should return null if no session files exist', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([] as unknown as []);

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should ignore non-session files', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        'other-file.json',
        'persisted-session-backup.json.bak',
        'readme.md',
      ] as unknown as []);

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should load the most recent session file (sorted by filename)', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        'persisted-session-2026-01-01T00-00-00-000Z.json',
        'persisted-session-2026-01-03T00-00-00-000Z.json', // Most recent
        'persisted-session-2026-01-02T00-00-00-000Z.json',
      ] as unknown as []);

      const mockSession: PersistedSession = {
        version: 1,
        sessionId: mockSessionId,
        projectHash: getProjectHash(),
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        history: [],
      };

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify(mockSession),
      );

      const result = await service.loadMostRecent();

      expect(result).toEqual(mockSession);
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining('2026-01-03'),
        'utf-8',
      );
    });

    it('should reject session with wrong project hash', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        'persisted-session-2026-01-03T00-00-00-000Z.json',
      ] as unknown as []);

      const mockSession: PersistedSession = {
        version: 1,
        sessionId: mockSessionId,
        projectHash: 'wrong-hash-from-different-project',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        history: [],
      };

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify(mockSession),
      );

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should reject session with unknown version', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        'persisted-session-2026-01-03T00-00-00-000Z.json',
      ] as unknown as []);

      const mockSession = {
        version: 99, // Future version
        sessionId: mockSessionId,
        projectHash: getProjectHash(),
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        history: [],
      };

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify(mockSession),
      );

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should handle corrupted JSON gracefully and backup', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        'persisted-session-2026-01-03T00-00-00-000Z.json',
      ] as unknown as []);
      vi.mocked(fs.promises.readFile).mockResolvedValue('{ invalid json }}}');
      vi.mocked(fs.promises.rename).mockResolvedValue();

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
      // Should backup the corrupted file
      expect(fs.promises.rename).toHaveBeenCalledWith(
        expect.stringContaining('persisted-session'),
        expect.stringContaining('.corrupted-'),
      );
    });

    it('should return session with UI history when present', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        'persisted-session-2026-01-03T00-00-00-000Z.json',
      ] as unknown as []);

      const uiHistory = [
        { id: 1, type: 'user', text: 'hello' },
        { id: 2, type: 'gemini', text: 'hi there' },
      ];

      const mockSession: PersistedSession = {
        version: 1,
        sessionId: mockSessionId,
        projectHash: getProjectHash(),
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        history: [],
        uiHistory,
      };

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify(mockSession),
      );

      const result = await service.loadMostRecent();

      expect(result?.uiHistory).toEqual(uiHistory);
    });

    it('should handle readdir failure gracefully', async () => {
      vi.mocked(fs.promises.readdir).mockRejectedValue(
        new Error('Permission denied'),
      );

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should handle readFile failure gracefully', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        'persisted-session-2026-01-03T00-00-00-000Z.json',
      ] as unknown as []);
      vi.mocked(fs.promises.readFile).mockRejectedValue(
        new Error('File not found'),
      );

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });
  });

  describe('formatSessionTime()', () => {
    it('should format session time from updatedAt', () => {
      const session: PersistedSession = {
        version: 1,
        sessionId: 'test',
        projectHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T12:30:00.000Z',
        history: [],
      };

      const formatted = SessionPersistenceService.formatSessionTime(session);

      // Should contain date components (locale-dependent format)
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should fall back to createdAt if updatedAt is empty', () => {
      const session: PersistedSession = {
        version: 1,
        sessionId: 'test',
        projectHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '',
        history: [],
      };

      const formatted = SessionPersistenceService.formatSessionTime(session);

      // Should still return a formatted string (from createdAt)
      expect(formatted).toBeTruthy();
    });

    it('should handle invalid date gracefully', () => {
      const session: PersistedSession = {
        version: 1,
        sessionId: 'test',
        projectHash: 'hash',
        createdAt: 'invalid-date',
        updatedAt: 'also-invalid',
        history: [],
      };

      // Should not throw
      expect(() =>
        SessionPersistenceService.formatSessionTime(session),
      ).not.toThrow();
    });
  });

  describe('project hash consistency', () => {
    it('should generate consistent hash for same project', () => {
      const service1 = new SessionPersistenceService(storage, 'session1');
      const service2 = new SessionPersistenceService(storage, 'session2');

      // Access private method via any
      const hash1 = (
        service1 as unknown as { getProjectHash(): string }
      ).getProjectHash();
      const hash2 = (
        service2 as unknown as { getProjectHash(): string }
      ).getProjectHash();

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different projects', () => {
      const storage1 = new Storage('/project1');
      const storage2 = new Storage('/project2');

      const service1 = new SessionPersistenceService(storage1, 'session');
      const service2 = new SessionPersistenceService(storage2, 'session');

      const hash1 = (
        service1 as unknown as { getProjectHash(): string }
      ).getProjectHash();
      const hash2 = (
        service2 as unknown as { getProjectHash(): string }
      ).getProjectHash();

      expect(hash1).not.toBe(hash2);
    });

    it('should generate SHA-256 hex hash (64 chars)', () => {
      const hash = (
        service as unknown as { getProjectHash(): string }
      ).getProjectHash();

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('edge cases', () => {
    it('should handle empty history array', async () => {
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.promises.writeFile).mockResolvedValue();
      vi.mocked(fs.promises.rename).mockResolvedValue();

      await expect(
        service.save([], undefined, undefined),
      ).resolves.not.toThrow();
    });

    it('should handle large history arrays', async () => {
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.promises.writeFile).mockResolvedValue();
      vi.mocked(fs.promises.rename).mockResolvedValue();

      const largeHistory = Array.from({ length: 1000 }, (_, i) => ({
        speaker: i % 2 === 0 ? 'human' : 'model',
        blocks: [{ type: 'text', text: `Message ${i}` }],
      }));

      await expect(
        service.save(
          largeHistory as unknown as Array<
            import('../services/history/IContent.js').IContent
          >,
          undefined,
          undefined,
        ),
      ).resolves.not.toThrow();
    });

    it('should handle special characters in project path', () => {
      const specialStorage = new Storage(
        '/path/with spaces/and-dashes/and_underscores',
      );
      const specialService = new SessionPersistenceService(
        specialStorage,
        'session',
      );

      expect(() => specialService.getChatsDir()).not.toThrow();
      expect(() => specialService.getSessionFilePath()).not.toThrow();
    });
  });
});
