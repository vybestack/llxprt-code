/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue2035
 * Standalone invalidateProviderRuntimeCache tests.
 *
 * Issue #2035: After forceRefreshToken updates the disk token store, the
 * in-memory runtimeScopedStates cache still holds the revoked token. Because
 * each agent/runtime has its own runtimeScopedStates entry, the standalone
 * helper must clear matching entries across ALL runtimes for a provider so
 * that subsequent token resolutions (and other agents) pick up the fresh
 * token from disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  invalidateProviderRuntimeCache,
  runtimeScopedStates,
  storeRuntimeScopedToken,
  type RuntimeScopedState,
} from '../precedence.js';

function createState(runtimeId: string): RuntimeScopedState {
  const state: RuntimeScopedState = {
    runtimeAuthScopeId: runtimeId,
    entries: new Map(),
    metadata: {
      runtimeAuthScopeId: runtimeId,
      cacheEntries: [],
      cancellationHooks: [],
      revokedTokens: [],
      metrics: { hits: 0, misses: 0, lastUpdated: Date.now() },
    },
    settingsSubscriptions: [],
  };
  runtimeScopedStates.set(runtimeId, state);
  return state;
}

describe('invalidateProviderRuntimeCache (standalone)', () => {
  beforeEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  afterEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  /**
   * @fix issue2035
   * Core fix: a single agent's refresh must clear that agent's cached token.
   */
  it('removes the cached entry for the provider so the next read misses', () => {
    const state = createState('agent-1');
    storeRuntimeScopedToken(state, 'anthropic', 'default', 'stale-token');

    expect(state.entries.size).toBe(1);

    const invalidated = invalidateProviderRuntimeCache('anthropic');

    expect(invalidated).toBe(1);
    expect(state.entries.size).toBe(0);
  });

  /**
   * @fix issue2035
   * Multi-agent scenario from the issue: refresh by one agent must propagate
   * cache invalidation to every runtime so other agents stop using the
   * revoked token.
   */
  it('invalidates matching entries across all runtimes', () => {
    const agent1 = createState('agent-1');
    const agent2 = createState('agent-2');
    storeRuntimeScopedToken(agent1, 'anthropic', 'default', 'stale-1');
    storeRuntimeScopedToken(agent2, 'anthropic', 'default', 'stale-2');

    const invalidated = invalidateProviderRuntimeCache('anthropic');

    expect(invalidated).toBe(2);
    expect(agent1.entries.size).toBe(0);
    expect(agent2.entries.size).toBe(0);
  });

  /**
   * @fix issue2035
   * Must not disturb unrelated providers cached in the same runtime.
   */
  it('does not invalidate entries for other providers', () => {
    const state = createState('agent-1');
    storeRuntimeScopedToken(state, 'anthropic', 'default', 'anthropic-token');
    storeRuntimeScopedToken(state, 'gemini', 'default', 'gemini-token');

    const invalidated = invalidateProviderRuntimeCache('anthropic');

    expect(invalidated).toBe(1);
    expect(state.entries.has('agent-1::gemini::default')).toBe(true);
    expect(state.entries.has('agent-1::anthropic::default')).toBe(false);
  });

  /**
   * @fix issue2035
   * When a profileId is supplied, only that profile's entry is cleared.
   */
  it('invalidates only the matching profile when profileId is provided', () => {
    const state = createState('agent-1');
    storeRuntimeScopedToken(state, 'anthropic', 'work', 'work-token');
    storeRuntimeScopedToken(state, 'anthropic', 'personal', 'personal-token');

    const invalidated = invalidateProviderRuntimeCache('anthropic', 'work');

    expect(invalidated).toBe(1);
    expect(state.entries.has('agent-1::anthropic::work')).toBe(false);
    expect(state.entries.has('agent-1::anthropic::personal')).toBe(true);
  });

  /**
   * @fix issue2035
   * No runtimes registered must be a graceful no-op returning zero.
   */
  it('returns 0 when there are no runtime states', () => {
    const invalidated = invalidateProviderRuntimeCache('anthropic');
    expect(invalidated).toBe(0);
  });
});
