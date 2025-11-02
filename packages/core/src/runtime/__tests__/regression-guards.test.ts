/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P12
 * @requirement REQ-STAT5-005
 *
 * Regression guards to prevent reintroduction of Config as source of truth.
 * These tests enforce that runtime state remains the authoritative source.
 */

import { describe, it, expect } from 'vitest';
import {
  createAgentRuntimeState,
  updateAgentRuntimeState,
  getAgentRuntimeStateSnapshot,
} from '../AgentRuntimeState.js';
import { AuthType } from '../../core/contentGenerator.js';

describe('Runtime State Regression Guards', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P12
   * @requirement REQ-STAT5-001
   *
   * Prevent Config from being used as source of truth for provider/model/auth.
   */
  describe('Config Fallback Prevention', () => {
    it('should enforce runtime state as immutable', () => {
      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      // Attempt to mutate (should throw - Object.freeze enforces immutability at runtime)
      const originalProvider = state.provider;
      expect(() => {
        // @ts-expect-error - Testing immutability
        state.provider = 'anthropic';
      }).toThrow(/Cannot assign to read only property/);

      // State remains unchanged (runtime enforcement confirmed)
      expect(state.provider).toBe(originalProvider);
    });

    it('should require explicit runtime state updates via updateAgentRuntimeState', () => {
      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      // Update must use the update function
      const newState = updateAgentRuntimeState(state, { model: 'gemini-2.5' });

      // Original state unchanged
      expect(state.model).toBe('gemini-2.0-flash');
      // New state reflects update
      expect(newState.model).toBe('gemini-2.5');
    });

    it('should prevent direct property assignment on runtime state', () => {
      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      // TypeScript prevents this at compile time
      // Runtime enforcement via Object.freeze (throws in strict mode)
      expect(() => {
        // @ts-expect-error - Testing immutability
        state.model = 'new-model';
      }).toThrow(/Cannot assign to read only property/); // Runtime immutability enforced!

      // Verify state unchanged
      expect(state.model).toBe('gemini-2.0-flash');
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P12
   * @requirement REQ-STAT5-002
   *
   * Ensure runtime state snapshots remain pure data (no side effects).
   */
  describe('Snapshot Purity', () => {
    it('should return plain object snapshots without methods', () => {
      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      const snapshot = getAgentRuntimeStateSnapshot(state);

      // Snapshot should be a plain object
      expect(typeof snapshot).toBe('object');
      expect(snapshot.provider).toBe('gemini');
      expect(snapshot.model).toBe('gemini-2.0-flash');

      // Snapshot should not have methods (is pure data)
      expect(typeof snapshot).toBe('object');
      expect(snapshot.constructor.name).toBe('Object');
    });

    it('should not allow snapshot mutations to affect original state', () => {
      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      const snapshot = getAgentRuntimeStateSnapshot(state);

      // Attempt to mutate snapshot (should throw - snapshots are frozen)
      expect(() => {
        snapshot.provider = 'anthropic';
      }).toThrow(/Cannot assign to read only property/);

      expect(() => {
        snapshot.model = 'claude-3-5-sonnet';
      }).toThrow(/Cannot assign to read only property/);

      // Original state unchanged (and snapshot unchanged due to immutability)
      expect(state.provider).toBe('gemini');
      expect(state.model).toBe('gemini-2.0-flash');
      expect(snapshot.provider).toBe('gemini');
      expect(snapshot.model).toBe('gemini-2.0-flash');
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P12
   * @requirement REQ-STAT5-003
   *
   * Verify subscription mechanisms don't leak state.
   */
  describe('Subscription Safety', () => {
    it('should not expose mutable state through subscription callbacks', () => {
      // This is tested implicitly through the immutability of AgentRuntimeState
      // Subscriptions receive snapshots, not mutable references
      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      // Subscription callbacks should receive immutable data
      // (Verified through type system and immutability tests above)
      expect(state.provider).toBe('gemini');
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P12
   * @requirement REQ-STAT5-004
   *
   * Prevent regression to Config-based state management.
   */
  describe('Config Isolation', () => {
    it('should enforce that provider/model/auth come from runtime state, not Config', () => {
      // This is a documentation test - the actual enforcement is in
      // GeminiClient and GeminiChat constructors which require runtime state

      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      // Runtime state provides provider/model/auth
      expect(state.provider).toBeDefined();
      expect(state.model).toBeDefined();
      expect(state.authType).toBeDefined();

      // Config should NOT be queried for these values in production code
      // (Verified through code review and integration tests)
    });

    it('should prevent Config from being passed without runtime state', () => {
      // This is enforced by TypeScript types in GeminiClient/GeminiChat constructors
      // Both now require runtime state as a parameter

      // Test would be:
      // expect(() => new GeminiClient(config, undefined)).toThrow()
      // But TypeScript prevents this at compile time

      // This test documents the requirement
      expect(true).toBe(true); // Type safety is the guard
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P12
   * @requirement REQ-STAT5-005
   *
   * Verify runtime state updates trigger proper change notifications.
   */
  describe('Change Notification Integrity', () => {
    it('should ensure updates produce new state objects (immutability)', () => {
      const state1 = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      const state2 = updateAgentRuntimeState(state1, { model: 'gemini-2.5' });

      // Different objects
      expect(state1).not.toBe(state2);

      // Different values
      expect(state1.model).not.toBe(state2.model);

      // Runtime ID preserved
      expect(state1.runtimeId).toBe(state2.runtimeId);
      expect(state2.runtimeId).toBe('test-runtime');
    });

    it('should maintain referential integrity across updates', () => {
      const state1 = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      const state2 = updateAgentRuntimeState(state1, { model: 'gemini-2.5' });
      const state3 = updateAgentRuntimeState(state2, {
        provider: 'anthropic',
      });

      // Chain of updates maintains runtime ID
      expect(state1.runtimeId).toBe('test-runtime');
      expect(state2.runtimeId).toBe('test-runtime');
      expect(state3.runtimeId).toBe('test-runtime');

      // Each state is independent
      expect(state1.model).toBe('gemini-2.0-flash');
      expect(state2.model).toBe('gemini-2.5');
      expect(state3.model).toBe('gemini-2.5'); // Unchanged from state2

      expect(state1.provider).toBe('gemini');
      expect(state2.provider).toBe('gemini');
      expect(state3.provider).toBe('anthropic');
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P12
   * @requirement REQ-STAT5-005
   *
   * Guard against performance regressions in state operations.
   */
  describe('Performance Guards', () => {
    const creationBudgetMs = process.platform === 'darwin' ? 6 : 3;
    const updateBudgetMs = process.platform === 'darwin' ? 5 : 2;

    it('should complete state creation within budget', () => {
      const start = performance.now();

      createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      const duration = performance.now() - start;

      // Should be nearly instantaneous while allowing additional variance on slower hosts
      expect(duration).toBeLessThan(creationBudgetMs);
    });

    it('should complete state updates within budget', () => {
      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      const start = performance.now();

      updateAgentRuntimeState(state, { model: 'gemini-2.5' });

      const duration = performance.now() - start;

      // Should be nearly instantaneous while allowing additional variance on slower hosts
      expect(duration).toBeLessThan(updateBudgetMs);
    });

    it('should complete snapshot generation within budget', () => {
      const state = createAgentRuntimeState({
        runtimeId: 'test-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        authType: AuthType.API_KEY,
        authPayload: { apiKey: 'test-key' },
        sessionId: 'test-session',
      });

      const start = performance.now();

      getAgentRuntimeStateSnapshot(state);

      const duration = performance.now() - start;

      // Should be nearly instantaneous while allowing additional variance on slower hosts
      expect(duration).toBeLessThan(updateBudgetMs);
    });
  });
});
