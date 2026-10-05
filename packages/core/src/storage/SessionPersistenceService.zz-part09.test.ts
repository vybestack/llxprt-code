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

    it('should return session with UI history when present', async () => {
      readdirMock().mockResolvedValue([
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

      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.loadMostRecent();

      expect(result?.uiHistory).toStrictEqual(uiHistory);
    });

    it('should handle readdir failure gracefully', async () => {
      readdirMock().mockRejectedValue(new Error('Permission denied'));

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should handle readFile failure gracefully', async () => {
      readdirMock().mockResolvedValue([
        'persisted-session-2026-01-03T00-00-00-000Z.json',
      ] as unknown as []);
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockRejectedValue(new Error('File not found'));

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });
  });
});
