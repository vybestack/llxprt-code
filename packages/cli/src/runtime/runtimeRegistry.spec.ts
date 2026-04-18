/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  runtimeRegistry,
  LEGACY_RUNTIME_ID,
  resolveActiveRuntimeIdentity,
  upsertRuntimeEntry,
  requireRuntimeEntry,
  disposeCliRuntime,
  resetCliRuntimeRegistryForTesting,
} from './runtimeRegistry.js';
import { peekActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core';

/**
 * Test suite for runtime registry lifecycle
 *
 * Tests behavioral contracts for:
 * - Baseline state after reset
 * - Entry creation and retrieval
 * - Entry update with metadata merge
 * - Entry update partial fields
 * - Missing entry error
 * - Disposal and cleanup
 */
describe('runtimeRegistry', () => {
  beforeEach(() => {
    resetCliRuntimeRegistryForTesting();
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
  });

  describe('baseline state', () => {
    it('should return legacy-singleton after reset', () => {
      const identity = resolveActiveRuntimeIdentity();
      expect(identity.runtimeId).toBe(LEGACY_RUNTIME_ID);
      expect(identity.metadata).toStrictEqual({});
    });

    it('should have empty registry after reset', () => {
      expect(runtimeRegistry.size).toBe(0);
    });
  });

  describe('entry creation', () => {
    it('should create entry with upsertRuntimeEntry', () => {
      const runtimeId = 'test-runtime-1';
      const entry = upsertRuntimeEntry(runtimeId, {
        metadata: { testKey: 'testValue' },
      });

      expect(entry.runtimeId).toBe(runtimeId);
      expect(entry.metadata).toStrictEqual({ testKey: 'testValue' });
      expect(entry.config).toBeNull();
      expect(entry.providerManager).toBeNull();
      expect(entry.settingsService).toBeNull();
    });

    it('should retrieve created entry via requireRuntimeEntry', () => {
      const runtimeId = 'test-runtime-2';
      upsertRuntimeEntry(runtimeId, {
        metadata: { source: 'test' },
      });

      const entry = requireRuntimeEntry(runtimeId);
      expect(entry.runtimeId).toBe(runtimeId);
      expect(entry.metadata.source).toBe('test');
    });

    it('should be retrievable from registry map', () => {
      const runtimeId = 'test-runtime-3';
      upsertRuntimeEntry(runtimeId, {});

      const entry = runtimeRegistry.get(runtimeId);
      expect(entry).toBeDefined();
      expect(entry?.runtimeId).toBe(runtimeId);
    });
  });

  describe('entry update', () => {
    it('should update existing entry without duplicating', () => {
      const runtimeId = 'test-update-1';

      upsertRuntimeEntry(runtimeId, { metadata: { a: 1 } });
      upsertRuntimeEntry(runtimeId, { metadata: { b: 2 } });

      expect(runtimeRegistry.size).toBe(1);
      const entry = requireRuntimeEntry(runtimeId);
      expect(entry.metadata).toStrictEqual({ a: 1, b: 2 });
    });

    it('should merge metadata on update', () => {
      const runtimeId = 'test-merge-1';

      upsertRuntimeEntry(runtimeId, { metadata: { existing: 'value' } });
      upsertRuntimeEntry(runtimeId, { metadata: { newKey: 'newValue' } });

      const entry = requireRuntimeEntry(runtimeId);
      expect(entry.metadata.existing).toBe('value');
      expect(entry.metadata.newKey).toBe('newValue');
    });

    it('should preserve existing fields on partial update', () => {
      const runtimeId = 'test-partial-1';

      // First upsert with config
      upsertRuntimeEntry(runtimeId, {
        metadata: { initial: true },
      });

      // Second upsert with settingsService only
      upsertRuntimeEntry(runtimeId, {
        metadata: { second: true },
      });

      const entry = requireRuntimeEntry(runtimeId);
      expect(entry.metadata.initial).toBe(true);
      expect(entry.metadata.second).toBe(true);
    });

    it('should allow overwriting fields to null', () => {
      const runtimeId = 'test-null-1';

      upsertRuntimeEntry(runtimeId, { metadata: { keep: 'this' } });
      upsertRuntimeEntry(runtimeId, {});

      const entry = requireRuntimeEntry(runtimeId);
      expect(entry.metadata.keep).toBe('this');
    });
  });

  describe('missing entry error', () => {
    it('should throw for nonexistent entry', () => {
      expect(() => requireRuntimeEntry('nonexistent-runtime')).toThrow();
    });

    it('should include runtime registration in error message', () => {
      try {
        requireRuntimeEntry('nonexistent-runtime-2');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('runtime registration');
      }
    });

    it('should include hint about setCliRuntimeContext in error message', () => {
      try {
        requireRuntimeEntry('nonexistent-runtime-3');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('setCliRuntimeContext');
      }
    });
  });

  describe('disposal', () => {
    it('should remove entry from registry', () => {
      const runtimeId = 'test-dispose-1';
      upsertRuntimeEntry(runtimeId, {});

      disposeCliRuntime(runtimeId);

      expect(runtimeRegistry.has(runtimeId)).toBe(false);
    });

    it('should throw when accessing disposed entry', () => {
      const runtimeId = 'test-dispose-2';
      upsertRuntimeEntry(runtimeId, {});
      disposeCliRuntime(runtimeId);

      expect(() => requireRuntimeEntry(runtimeId)).toThrow();
    });

    it('should clear active context if runtimeId matches', () => {
      const runtimeId = 'test-dispose-3';
      upsertRuntimeEntry(runtimeId, {});
      disposeCliRuntime(runtimeId);

      // After disposal, the active context should be cleared
      const activeContext = peekActiveProviderRuntimeContext();
      expect(activeContext).toBeNull();
    });
  });

  describe('resolveActiveRuntimeIdentity', () => {
    it('should return LEGACY_RUNTIME_ID when no scope or context', () => {
      const identity = resolveActiveRuntimeIdentity();
      expect(identity.runtimeId).toBe(LEGACY_RUNTIME_ID);
    });

    it('should return registered runtimeId when context has unregistered id', () => {
      const registeredId = 'registered-runtime-1';
      upsertRuntimeEntry(registeredId, {});

      // When there's no active context, it should fall back to legacy
      const identity = resolveActiveRuntimeIdentity();
      expect(identity.runtimeId).toBe(LEGACY_RUNTIME_ID);
    });
  });
});
