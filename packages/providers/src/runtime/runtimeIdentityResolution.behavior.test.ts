/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  resolveActiveRuntimeIdentity,
  upsertRuntimeEntry,
  disposeCliRuntime,
  resetCliRuntimeRegistryForTesting,
  setDefaultCliRuntimeId,
  getDefaultCliRuntimeId,
  clearDefaultCliRuntimeId,
  resetDefaultCliRuntimeIdForTesting,
} from './runtimeRegistry.js';
import { runWithRuntimeScope } from './runtimeContextFactory.js';

/**
 * Behavioral tests for strict runtime identity resolution (issue #2300).
 *
 * Runtime identity must be explicit and deterministic:
 * - ALS scope when registered wins.
 * - Otherwise an explicit default CLI runtime id, if set and registered.
 * - Otherwise throw a clear error.
 *
 * No legacy-singleton phantom fallback, no first-registered guessing.
 */
describe('strict runtime identity resolution (issue #2300)', () => {
  beforeEach(() => {
    resetCliRuntimeRegistryForTesting();
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
  });

  describe('resolveActiveRuntimeIdentity with no runtime', () => {
    it('throws when no ALS scope and no default CLI runtime is registered', () => {
      expect(() => resolveActiveRuntimeIdentity()).toThrow(/No active runtime/);
    });

    it('mentions enterRuntimeScope or setCliRuntimeContext in the error', () => {
      expect(() => resolveActiveRuntimeIdentity()).toThrow(
        /enterRuntimeScope|setCliRuntimeContext/,
      );
    });
  });

  describe('resolveActiveRuntimeIdentity ALS priority', () => {
    it('returns the registered ALS scope runtime', () => {
      const runtimeId = 'als-registered-1';
      upsertRuntimeEntry(runtimeId, { metadata: { scoped: true } });

      runWithRuntimeScope({ runtimeId, metadata: { scoped: true } }, () => {
        const identity = resolveActiveRuntimeIdentity();
        expect(identity.runtimeId).toBe(runtimeId);
        expect(identity.metadata).toStrictEqual({ scoped: true });
      });
    });

    it('ALS resolution returns scope metadata when registry metadata differs', () => {
      const runtimeId = 'als-registered-divergent';
      upsertRuntimeEntry(runtimeId, { metadata: { source: 'registry' } });

      runWithRuntimeScope({ runtimeId, metadata: { source: 'scope' } }, () => {
        const identity = resolveActiveRuntimeIdentity();
        expect(identity.runtimeId).toBe(runtimeId);
        expect(identity.metadata).toStrictEqual({ source: 'scope' });
      });
    });

    it('nested ALS scopes resolve to the innermost scope', () => {
      const outer = 'outer-scope';
      const inner = 'inner-scope';
      upsertRuntimeEntry(outer, {});
      upsertRuntimeEntry(inner, {});

      runWithRuntimeScope({ runtimeId: outer, metadata: {} }, () => {
        runWithRuntimeScope({ runtimeId: inner, metadata: {} }, () => {
          const identity = resolveActiveRuntimeIdentity();
          expect(identity.runtimeId).toBe(inner);
        });
        const identity = resolveActiveRuntimeIdentity();
        expect(identity.runtimeId).toBe(outer);
      });
    });
    it('ALS scope with registered runtime wins over default CLI runtime', () => {
      const alsRuntime = 'als-wins';
      const defaultRuntime = 'default-cli';
      upsertRuntimeEntry(alsRuntime, {});
      upsertRuntimeEntry(defaultRuntime, {});
      setDefaultCliRuntimeId(defaultRuntime);

      runWithRuntimeScope({ runtimeId: alsRuntime, metadata: {} }, () => {
        const identity = resolveActiveRuntimeIdentity();
        expect(identity.runtimeId).toBe(alsRuntime);
      });
    });

    it('unregistered ALS does not fall back to Map insertion; returns default if set', () => {
      const firstInserted = 'first-inserted';
      const defaultRuntime = 'default-cli-2';
      upsertRuntimeEntry(firstInserted, {});
      upsertRuntimeEntry(defaultRuntime, { metadata: { source: 'default' } });
      setDefaultCliRuntimeId(defaultRuntime);

      runWithRuntimeScope(
        { runtimeId: 'unregistered-als', metadata: { source: 'stale-als' } },
        () => {
          const identity = resolveActiveRuntimeIdentity();
          expect(identity.runtimeId).toBe(defaultRuntime);
          expect(identity.metadata).toStrictEqual({ source: 'default' });
        },
      );
    });

    it('unregistered ALS with no default throws', () => {
      const firstInserted = 'first-inserted-2';
      upsertRuntimeEntry(firstInserted, {});

      runWithRuntimeScope(
        { runtimeId: 'unregistered-als-2', metadata: {} },
        () => {
          expect(() => resolveActiveRuntimeIdentity()).toThrow(
            /No active runtime/,
          );
        },
      );
    });
  });

  describe('resolveActiveRuntimeIdentity default CLI runtime', () => {
    it('returns the default CLI runtime when set and registered (no ALS)', () => {
      const defaultRuntime = 'default-cli-3';
      upsertRuntimeEntry(defaultRuntime, { metadata: { source: 'cli' } });
      setDefaultCliRuntimeId(defaultRuntime);

      const identity = resolveActiveRuntimeIdentity();
      expect(identity.runtimeId).toBe(defaultRuntime);
    });

    it('throws when default is set but not registered', () => {
      setDefaultCliRuntimeId('not-registered-default');

      expect(() => resolveActiveRuntimeIdentity()).toThrow(/No active runtime/);
    });
  });

  describe('default CLI runtime pointer management', () => {
    it('setDefaultCliRuntimeId sets the pointer', () => {
      setDefaultCliRuntimeId('ptr-1');
      expect(getDefaultCliRuntimeId()).toBe('ptr-1');
    });

    it('resetDefaultCliRuntimeIdForTesting clears any pointer', () => {
      setDefaultCliRuntimeId('ptr-2');
      resetDefaultCliRuntimeIdForTesting();
      expect(getDefaultCliRuntimeId()).toBeUndefined();
    });

    it('clearDefaultCliRuntimeId with matching argument clears the pointer', () => {
      setDefaultCliRuntimeId('ptr-3');
      clearDefaultCliRuntimeId('ptr-3');
      expect(getDefaultCliRuntimeId()).toBeUndefined();
    });

    it('clearDefaultCliRuntimeId with non-matching argument does NOT clear', () => {
      setDefaultCliRuntimeId('ptr-4');
      clearDefaultCliRuntimeId('different');
      expect(getDefaultCliRuntimeId()).toBe('ptr-4');
    });

    it('clearDefaultCliRuntimeId when no default is set is a no-op', () => {
      expect(() => clearDefaultCliRuntimeId('ptr-noop')).not.toThrow();
      expect(getDefaultCliRuntimeId()).toBeUndefined();
    });

    it('resetCliRuntimeRegistryForTesting clears the default pointer', () => {
      setDefaultCliRuntimeId('ptr-5');
      resetCliRuntimeRegistryForTesting();
      expect(getDefaultCliRuntimeId()).toBeUndefined();
    });
  });

  describe('disposeCliRuntime clears default only if disposing current default', () => {
    it('clears default when disposing the current default', () => {
      const runtimeId = 'dispose-default';
      upsertRuntimeEntry(runtimeId, {});
      setDefaultCliRuntimeId(runtimeId);

      disposeCliRuntime(runtimeId);
      expect(getDefaultCliRuntimeId()).toBeUndefined();
    });

    it('does not clear default when disposing a non-default runtime', () => {
      const other = 'dispose-other';
      const def = 'default-stays';
      upsertRuntimeEntry(other, {});
      upsertRuntimeEntry(def, {});
      setDefaultCliRuntimeId(def);

      disposeCliRuntime(other);
      expect(getDefaultCliRuntimeId()).toBe(def);
    });

    it('disposing a never-registered runtime id is a safe no-op', () => {
      const def = 'default-survives';
      upsertRuntimeEntry(def, {});
      setDefaultCliRuntimeId(def);

      expect(() => disposeCliRuntime('never-registered')).not.toThrow();
      expect(getDefaultCliRuntimeId()).toBe(def);
    });

    it('clears default when disposing a default that was set but never registered', () => {
      setDefaultCliRuntimeId('unregistered-default');
      disposeCliRuntime('unregistered-default');
      expect(getDefaultCliRuntimeId()).toBeUndefined();
    });
  });
});
