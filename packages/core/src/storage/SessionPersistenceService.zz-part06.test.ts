/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { SessionPersistenceService } from './SessionPersistenceService.js';
import {
  readdirMock,
  createSessionPersistenceFixture,
} from './SessionPersistenceService.test-helpers.js';

describe('SessionPersistenceService', () => {
  let service: SessionPersistenceService;

  beforeEach(() => {
    service = createSessionPersistenceFixture().service;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadMostRecent()', () => {
    it('should return null if chats directory does not exist', async () => {
      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      readdirMock().mockRejectedValue(enoentError);

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should return null if no session files exist', async () => {
      readdirMock().mockResolvedValue([] as unknown as []);

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should ignore non-session files', async () => {
      readdirMock().mockResolvedValue([
        'other-file.json',
        'persisted-session-backup.json.bak',
        'readme.md',
      ] as unknown as []);

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });
  });
});
