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
import { SessionPersistenceService } from './SessionPersistenceService.js';
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

    it('should reject session with unknown version', async () => {
      readdirMock().mockResolvedValue([
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

      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should handle corrupted JSON gracefully and backup', async () => {
      readdirMock().mockResolvedValue([
        'persisted-session-2026-01-03T00-00-00-000Z.json',
      ] as unknown as []);
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue('{ invalid json }}}');
      (
        fs.promises.rename as Mock<typeof fs.promises.rename>
      ).mockResolvedValue();

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
      // Should backup the corrupted file
      expect(fs.promises.rename).toHaveBeenCalledWith(
        expect.stringContaining('persisted-session'),
        expect.stringContaining('.corrupted-'),
      );
    });
  });
});
