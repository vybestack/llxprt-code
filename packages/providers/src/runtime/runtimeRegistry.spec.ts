/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  runtimeRegistry,
  resolveActiveRuntimeIdentity,
  upsertRuntimeEntry,
  requireRuntimeEntry,
  disposeCliRuntime,
  disposeCliRuntimeRegistration,
  resetCliRuntimeRegistryForTesting,
  setDefaultCliRuntimeId,
  getDefaultCliRuntimeId,
  clearDefaultCliRuntimeId,
} from './runtimeRegistry.js';
import { peekActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core';
import { resolveProviderFilePolicy } from '../providerFilePolicy.js';

/**
 * Test suite for runtime registry lifecycle
 *
 * Tests behavioral contracts for:
 * - Baseline state after reset (strict: no legacy-singleton fallback)
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
    it('should throw when no runtime is registered after reset (strict resolution)', () => {
      expect(() => resolveActiveRuntimeIdentity()).toThrow(/No active runtime/);
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
      expect(entry.runtimeKind).toBe('cli-interactive');
      expect(entry.metadata).toStrictEqual({ testKey: 'testValue' });
      expect(entry.config).toBeNull();
      expect(entry.providerManager).toBeNull();
      expect(entry.settingsService).toBeNull();
    });

    it('preserves explicit runtimeKind metadata on update', () => {
      const runtimeId = 'test-runtime-kind';
      upsertRuntimeEntry(runtimeId, {
        runtimeKind: 'agent',
        metadata: { source: 'test' },
      });
      upsertRuntimeEntry(runtimeId, { metadata: { updated: true } });

      const entry = requireRuntimeEntry(runtimeId);
      expect(entry.runtimeKind).toBe('agent');
      expect(entry.metadata).toStrictEqual({ source: 'test', updated: true });
    });

    it('supports explicit subagent runtime kind metadata', () => {
      const runtimeId = 'test-subagent-runtime-kind';
      upsertRuntimeEntry(runtimeId, {
        runtimeKind: 'subagent',
        metadata: { source: 'test' },
      });

      expect(requireRuntimeEntry(runtimeId).runtimeKind).toBe('subagent');
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
      expect(() => requireRuntimeEntry('nonexistent-runtime')).toThrow(
        /runtime registration/,
      );
    });

    it('should include runtime registration in error message', () => {
      expect(() => requireRuntimeEntry('nonexistent-runtime-2')).toThrow(
        /runtime registration/,
      );
    });

    it('should include hint about setCliRuntimeContext in error message', () => {
      expect(() => requireRuntimeEntry('nonexistent-runtime-3')).toThrow(
        /setCliRuntimeContext/,
      );
    });
  });

  describe('disposal', () => {
    it('refuses direct deregistration while its provider-file lifecycle retains a file', async () => {
      const runtimeId = 'test-direct-deregister-provider-files';
      const entry = upsertRuntimeEntry(runtimeId, {});
      const retained = await entry.providerFileLifecycle.retain({
        cacheKey: 'direct-deregister-content',
        fileId: 'direct-deregister-file',
        bytes: 10,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'direct-deregister-credential',
        },
        policy: resolveProviderFilePolicy({
          configuredMode: 'session',
          configuredRetentionMs: 60_000,
          configuredDeletion: 'delete',
          providerFileReferences: true,
          zeroDataRetention: 'incompatible-while-retained',
          zeroDataRetentionRequired: false,
        }),
        scopeId: runtimeId,
        deleteRemote: async () => undefined,
      });

      expect(() => disposeCliRuntimeRegistration(runtimeId)).toThrow(
        'provider-file lifecycle',
      );
      expect(runtimeRegistry.has(runtimeId)).toBe(true);
      await retained.lease.release();
      await entry.providerFileLifecycle.cleanupScope('session', runtimeId);
    });

    it('awaits session provider-file deletion and returns its result', async () => {
      const runtimeId = 'test-dispose-provider-files';
      let deletedFileId: string | undefined;
      const entry = upsertRuntimeEntry(runtimeId, {});
      const retained = await entry.providerFileLifecycle.retain({
        cacheKey: 'runtime-disposal-content',
        fileId: 'runtime-disposal-file',
        bytes: 10,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'runtime-disposal-credential',
        },
        policy: resolveProviderFilePolicy({
          configuredMode: 'session',
          configuredRetentionMs: 60_000,
          configuredDeletion: 'delete',
          providerFileReferences: true,
          zeroDataRetention: 'incompatible-while-retained',
          zeroDataRetentionRequired: false,
        }),
        scopeId: runtimeId,
        deleteRemote: async (fileId) => {
          await Promise.resolve();
          deletedFileId = fileId;
        },
      });
      await retained.lease.release();

      await disposeCliRuntime(runtimeId);

      expect(deletedFileId).toBe('runtime-disposal-file');
      expect(runtimeRegistry.has(runtimeId)).toBe(false);
    });

    it('reports failed file identity and keeps its lifecycle registered for retry', async () => {
      const runtimeId = 'test-dispose-provider-files-failure';
      const entry = upsertRuntimeEntry(runtimeId, {});
      const retained = await entry.providerFileLifecycle.retain({
        cacheKey: 'runtime-failed-content',
        fileId: 'runtime-failed-file',
        bytes: 10,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'runtime-disposal-credential',
        },
        policy: resolveProviderFilePolicy({
          configuredMode: 'session',
          configuredRetentionMs: 60_000,
          configuredDeletion: 'delete',
          providerFileReferences: true,
          zeroDataRetention: 'incompatible-while-retained',
          zeroDataRetentionRequired: false,
        }),
        scopeId: runtimeId,
        deleteRemote: async () => {
          throw new Error('provider deletion unavailable');
        },
      });
      await retained.lease.release();

      const disposal = disposeCliRuntime(runtimeId);

      await expect(disposal).rejects.toThrow(runtimeId);
      await expect(disposal).rejects.toThrow('runtime-failed-file');
      expect(runtimeRegistry.has(runtimeId)).toBe(true);
      expect(
        requireRuntimeEntry(runtimeId).providerFileLifecycle.snapshot()
          .deletionFailures,
      ).toHaveLength(1);
    });

    it('waits for the last lease to delete a deferred file before unregistering', async () => {
      const runtimeId = 'test-dispose-provider-files-deferred';
      const entry = upsertRuntimeEntry(runtimeId, {});
      const deleted: string[] = [];
      const retained = await entry.providerFileLifecycle.retain({
        cacheKey: 'runtime-deferred-content',
        fileId: 'runtime-deferred-file',
        bytes: 10,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'runtime-disposal-credential',
        },
        policy: resolveProviderFilePolicy({
          configuredMode: 'session',
          configuredRetentionMs: 60_000,
          configuredDeletion: 'delete',
          providerFileReferences: true,
          zeroDataRetention: 'incompatible-while-retained',
          zeroDataRetentionRequired: false,
        }),
        scopeId: runtimeId,
        deleteRemote: async (fileId) => {
          deleted.push(fileId);
        },
      });

      const disposal = disposeCliRuntime(runtimeId);
      await retained.lease.release();
      await disposal;

      expect(deleted).toStrictEqual(['runtime-deferred-file']);
      expect(runtimeRegistry.has(runtimeId)).toBe(false);
    });

    it('allows runtime disposal while explicitly retained workspace files remain remote', async () => {
      const runtimeId = 'runtime-workspace-retention';
      const entry = upsertRuntimeEntry(runtimeId, {});
      const deleted: string[] = [];
      const retained = await entry.providerFileLifecycle.retain({
        cacheKey: 'workspace-content',
        fileId: 'workspace-file',
        bytes: 10,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'workspace-credential',
        },
        policy: resolveProviderFilePolicy({
          configuredMode: 'workspace',
          configuredRetentionMs: 60_000,
          configuredDeletion: 'retain',
          providerFileReferences: true,
          zeroDataRetention: 'incompatible-while-retained',
          zeroDataRetentionRequired: false,
        }),
        scopeId: '/workspace/a',
        deleteRemote: async (fileId) => {
          deleted.push(fileId);
        },
      });
      await retained.lease.release();

      await disposeCliRuntime(runtimeId);

      expect({
        registered: runtimeRegistry.has(runtimeId),
        deleted,
      }).toStrictEqual({
        registered: false,
        deleted: [],
      });
    });

    it('creates isolated provider-file lifecycle state for each runtime', async () => {
      const first = upsertRuntimeEntry('runtime-lifecycle-a', {});
      const second = upsertRuntimeEntry('runtime-lifecycle-b', {});
      const retained = await first.providerFileLifecycle.retain({
        cacheKey: 'shared-content',
        fileId: 'runtime-a-file',
        bytes: 10,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'shared-credential',
        },
        policy: resolveProviderFilePolicy({
          configuredMode: 'session',
          configuredRetentionMs: 60_000,
          configuredDeletion: 'delete',
          providerFileReferences: true,
          zeroDataRetention: 'incompatible-while-retained',
          zeroDataRetentionRequired: false,
        }),
        scopeId: 'runtime-lifecycle-a',
        deleteRemote: async () => undefined,
      });

      expect(first.providerFileLifecycle.snapshot().retainedFiles).toBe(1);
      expect(second.providerFileLifecycle.snapshot().retainedFiles).toBe(0);
      await retained.lease.release();
    });

    it('should remove entry from registry', async () => {
      const runtimeId = 'test-dispose-1';
      upsertRuntimeEntry(runtimeId, {});

      await disposeCliRuntime(runtimeId);

      expect(runtimeRegistry.has(runtimeId)).toBe(false);
    });

    it('should throw when accessing disposed entry', async () => {
      const runtimeId = 'test-dispose-2';
      upsertRuntimeEntry(runtimeId, {});
      await disposeCliRuntime(runtimeId);

      expect(() => requireRuntimeEntry(runtimeId)).toThrow(
        /runtime registration/,
      );
    });

    it('should clear active context if runtimeId matches', async () => {
      const runtimeId = 'test-dispose-3';
      upsertRuntimeEntry(runtimeId, {});
      await disposeCliRuntime(runtimeId);

      // After disposal, the active context should be cleared
      const activeContext = peekActiveProviderRuntimeContext();
      expect(activeContext).toBeNull();
    });
  });

  describe('resolveActiveRuntimeIdentity', () => {
    it('should throw when no scope, context, or default CLI runtime exists', () => {
      expect(() => resolveActiveRuntimeIdentity()).toThrow(/No active runtime/);
    });

    it('should return the default CLI runtime when set and registered', () => {
      const registeredId = 'default-cli-runtime-1';
      upsertRuntimeEntry(registeredId, {});
      setDefaultCliRuntimeId(registeredId);

      const identity = resolveActiveRuntimeIdentity();
      expect(identity.runtimeId).toBe(registeredId);
    });

    it('should throw when default CLI runtime is set but not registered', () => {
      setDefaultCliRuntimeId('not-registered');
      expect(() => resolveActiveRuntimeIdentity()).toThrow(/No active runtime/);
    });

    it('should throw when runtimes are registered but no default is set', () => {
      upsertRuntimeEntry('registered-but-not-default', {});
      expect(() => resolveActiveRuntimeIdentity()).toThrow(/No active runtime/);
    });
  });

  describe('default CLI runtime pointer', () => {
    it('should expose the default CLI runtime pointer', () => {
      setDefaultCliRuntimeId('ptr-a');
      expect(getDefaultCliRuntimeId()).toBe('ptr-a');
    });

    it('clearDefaultCliRuntimeId clears only matching pointer', () => {
      setDefaultCliRuntimeId('ptr-b');
      clearDefaultCliRuntimeId('different');
      expect(getDefaultCliRuntimeId()).toBe('ptr-b');

      clearDefaultCliRuntimeId('ptr-b');
      expect(getDefaultCliRuntimeId()).toBeUndefined();
    });
  });
});
