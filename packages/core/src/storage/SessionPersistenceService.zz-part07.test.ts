/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import {
  SessionPersistenceService,
  type PersistedSession,
} from './SessionPersistenceService.js';
import {
  readdirMock,
  createSessionPersistenceFixture,
} from './SessionPersistenceService.test-helpers.js';

describe('SessionPersistenceService', () => {
  const mockProjectRoot = '/test/project';
  const mockSessionId = 'test-session-123';
  let service: SessionPersistenceService;

  beforeEach(() => {
    service = createSessionPersistenceFixture().service;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadMostRecent()', () => {
    const getProjectHash = () =>
      crypto.createHash('sha256').update(mockProjectRoot).digest('hex');

    it('should load the most recent session file (sorted by filename)', async () => {
      readdirMock().mockResolvedValue([
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

      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.loadMostRecent();

      expect(result).toMatchObject(mockSession);
      expect(typeof result?.mediaOwnership.release).toBe('function');
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining('2026-01-03'),
        'utf-8',
      );
    });

    it('should reject session with wrong project hash', async () => {
      readdirMock().mockResolvedValue([
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

      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });
  });
});
