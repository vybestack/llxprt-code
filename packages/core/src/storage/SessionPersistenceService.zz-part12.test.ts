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
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  createSessionPersistenceFixture,
  speakerForIndex,
} from './SessionPersistenceService.test-helpers.js';

describe('SessionPersistenceService', () => {
  let service: SessionPersistenceService;

  beforeEach(() => {
    service = createSessionPersistenceFixture().service;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('edge cases', () => {
    it('should handle empty history array', async () => {
      (fs.promises.mkdir as Mock<typeof fs.promises.mkdir>).mockResolvedValue(
        undefined,
      );
      (
        fs.promises.writeFile as Mock<typeof fs.promises.writeFile>
      ).mockResolvedValue();
      (
        fs.promises.rename as Mock<typeof fs.promises.rename>
      ).mockResolvedValue();

      await expect(
        service.save([], undefined, undefined),
      ).resolves.toBeUndefined();
    });

    it('should handle large history arrays', async () => {
      (fs.promises.mkdir as Mock<typeof fs.promises.mkdir>).mockResolvedValue(
        undefined,
      );
      (
        fs.promises.writeFile as Mock<typeof fs.promises.writeFile>
      ).mockResolvedValue();
      (
        fs.promises.rename as Mock<typeof fs.promises.rename>
      ).mockResolvedValue();

      const largeHistory = Array.from({ length: 1000 }, (_, i) => ({
        speaker: speakerForIndex(i),
        blocks: [{ type: 'text', text: `Message ${i}` }],
      }));

      await service.save(
        largeHistory as unknown as Array<
          import('../services/history/IContent.js').IContent
        >,
        undefined,
        undefined,
      );
      expect(
        fs.promises.writeFile as Mock<typeof fs.promises.writeFile>,
      ).toHaveBeenCalled();
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
