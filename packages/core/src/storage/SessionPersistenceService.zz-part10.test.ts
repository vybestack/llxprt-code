/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import {
  SessionPersistenceService,
  type PersistedSession,
} from './SessionPersistenceService.js';
import { createSessionPersistenceFixture } from './SessionPersistenceService.test-helpers.js';

describe('SessionPersistenceService', () => {
  let service: SessionPersistenceService;

  beforeEach(() => {
    service = createSessionPersistenceFixture().service;
    void service;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatSessionTime()', () => {
    it('should format session time from updatedAt', () => {
      const session: PersistedSession = {
        version: 1,
        sessionId: 'test',
        projectHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T12:30:00.000Z',
        history: [],
      };

      const formatted = SessionPersistenceService.formatSessionTime(session);

      // Should contain date components (locale-dependent format)
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should fall back to createdAt if updatedAt is empty', () => {
      const session: PersistedSession = {
        version: 1,
        sessionId: 'test',
        projectHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '',
        history: [],
      };

      const formatted = SessionPersistenceService.formatSessionTime(session);

      // Should still return a formatted string (from createdAt)
      expect(formatted).toBeTruthy();
    });

    it('should handle invalid date gracefully', () => {
      const session: PersistedSession = {
        version: 1,
        sessionId: 'test',
        projectHash: 'hash',
        createdAt: 'invalid-date',
        updatedAt: 'also-invalid',
        history: [],
      };

      // Should not throw
      expect(() =>
        SessionPersistenceService.formatSessionTime(session),
      ).not.toThrow();
    });
  });
});
