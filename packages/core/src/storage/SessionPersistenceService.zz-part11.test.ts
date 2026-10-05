/**
 * @license
 * Copyright 2026 Vybestack LLC
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

  describe('project hash consistency', () => {
    it('should generate consistent hash for same project', () => {
      const service1 = new SessionPersistenceService(storage, 'session1');
      const service2 = new SessionPersistenceService(storage, 'session2');

      // Access private method via any
      const hash1 = (
        service1 as unknown as { getProjectHash(): string }
      ).getProjectHash();
      const hash2 = (
        service2 as unknown as { getProjectHash(): string }
      ).getProjectHash();

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different projects', () => {
      const storage1 = new Storage('/project1');
      const storage2 = new Storage('/project2');

      const service1 = new SessionPersistenceService(storage1, 'session');
      const service2 = new SessionPersistenceService(storage2, 'session');

      const hash1 = (
        service1 as unknown as { getProjectHash(): string }
      ).getProjectHash();
      const hash2 = (
        service2 as unknown as { getProjectHash(): string }
      ).getProjectHash();

      expect(hash1).not.toBe(hash2);
    });

    it('should generate SHA-256 hex hash (64 chars)', () => {
      const hash = (
        service as unknown as { getProjectHash(): string }
      ).getProjectHash();

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
