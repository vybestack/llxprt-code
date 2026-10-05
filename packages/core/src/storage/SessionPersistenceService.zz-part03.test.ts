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
import {
  SessionPersistenceService,
  type PersistedSession,
} from './SessionPersistenceService.js';
import type { IContent } from '../services/history/IContent.js';
import {
  createSessionPersistenceFixture,
  configureSaveMocks,
} from './SessionPersistenceService.test-helpers.js';

describe('SessionPersistenceService', () => {
  const mockSessionId = 'test-session-123';
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

    it('should include all required fields in saved session', async () => {
      let savedContent = '';
      (
        fs.promises.writeFile as Mock<typeof fs.promises.writeFile>
      ).mockImplementation(async (_path, content) => {
        savedContent = content as string;
      });

      const history: IContent[] = [
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
      expect(parsed.history).toStrictEqual(history);
      expect(parsed.uiHistory).toStrictEqual(uiHistory);
      expect(parsed.metadata).toStrictEqual(metadata);
    });
  });
});
