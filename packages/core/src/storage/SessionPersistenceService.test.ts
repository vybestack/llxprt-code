/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { SessionPersistenceService } from './SessionPersistenceService.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { createSessionPersistenceFixture } from './SessionPersistenceService.test-helpers.js';

describe('SessionPersistenceService', () => {
  let storage: Storage;
  let service: SessionPersistenceService;

  beforeEach(() => {
    ({ storage, service } = createSessionPersistenceFixture());
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
});
