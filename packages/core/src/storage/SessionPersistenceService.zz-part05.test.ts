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

    it('should throw on write failure', async () => {
      (
        fs.promises.writeFile as Mock<typeof fs.promises.writeFile>
      ).mockRejectedValue(new Error('Disk full'));

      await expect(service.save([], undefined, [])).rejects.toThrow(
        'Disk full',
      );
    });

    it('should throw on rename failure', async () => {
      (fs.promises.rename as Mock<typeof fs.promises.rename>).mockRejectedValue(
        new Error('IO error'),
      );

      await expect(service.save([], undefined, [])).rejects.toThrow('IO error');
    });
  });
});
