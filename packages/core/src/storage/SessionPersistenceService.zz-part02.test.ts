/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import { SessionPersistenceService } from './SessionPersistenceService.js';
import {
  createSessionPersistenceFixture,
  configureSaveMocks,
} from './SessionPersistenceService.test-helpers.js';

describe('SessionPersistenceService', () => {
  let service: SessionPersistenceService;

  beforeEach(() => {
    service = createSessionPersistenceFixture().service;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('save()', () => {
    beforeEach(() => {
      configureSaveMocks();
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
  });
});
