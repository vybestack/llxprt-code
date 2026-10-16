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
import * as fs from 'node:fs';
import { SessionPersistenceService } from './SessionPersistenceService.js';
import {
  createSessionPersistenceFixture,
  configureSaveMocks,
  persistedTimestamps,
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

    it('should preserve createdAt across multiple saves', async () => {
      let firstCreatedAt: string | null = null;
      let secondCreatedAt: string | null = null;

      (fs.promises.writeFile as Mock<typeof fs.promises.writeFile>)
        .mockImplementationOnce(async (_path, content) => {
          firstCreatedAt = persistedTimestamps(content).createdAt;
        })
        .mockImplementationOnce(async (_path, content) => {
          secondCreatedAt = persistedTimestamps(content).createdAt;
        });

      await service.save([], undefined, []);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.save([], undefined, []);

      expect(firstCreatedAt).toBe(secondCreatedAt);
    });

    it('should update updatedAt on each save', async () => {
      let firstUpdatedAt: string | null = null;
      let secondUpdatedAt: string | null = null;

      (fs.promises.writeFile as Mock<typeof fs.promises.writeFile>)
        .mockImplementationOnce(async (_path, content) => {
          firstUpdatedAt = persistedTimestamps(content).updatedAt;
        })
        .mockImplementationOnce(async (_path, content) => {
          secondUpdatedAt = persistedTimestamps(content).updatedAt;
        });

      await service.save([], undefined, []);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.save([], undefined, []);

      expect(firstUpdatedAt).not.toBe(secondUpdatedAt);
    });

    it('should throw on mkdir failure', async () => {
      (fs.promises.mkdir as Mock<typeof fs.promises.mkdir>).mockRejectedValue(
        new Error('Permission denied'),
      );

      await expect(service.save([], undefined, [])).rejects.toThrow(
        'Permission denied',
      );
    });
  });
});
