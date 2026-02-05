/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan:PLAN-20251027-STATELESS5.P11
 * @requirement:REQ-STAT5-005
 *
 * Runtime Isolation Integration Test
 *
 * Verifies that AgentRuntimeAdapter and diagnostics correctly use runtime state snapshots
 * and that the integration between CLI bootstrap, adapter, and slash commands works end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
  type Config,
} from '@vybestack/llxprt-code-core';
import {
  AgentRuntimeAdapter,
  setRuntimeAdapter,
  getRuntimeAdapter,
  resetRuntimeAdapter,
} from '../runtime/agentRuntimeAdapter.js';

describe('Runtime Isolation Integration', () => {
  let mockConfig: Config;
  let runtimeState: AgentRuntimeState;
  let adapter: AgentRuntimeAdapter;

  beforeEach(() => {
    // Create minimal mock Config
    mockConfig = {
      getProvider: () => 'gemini',
      setProvider: () => {},
      getModel: () => 'gemini-1.5-flash',
      setModel: () => {},
      setEphemeralSetting: () => {},
      getProviderManager: () => ({
        listProviders: () => ['gemini', 'openai', 'anthropic'],
      }),
    } as unknown as Config;

    // Create initial runtime state
    runtimeState = createAgentRuntimeState({
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      sessionId: 'test-session-123',
    });

    // Create adapter
    adapter = new AgentRuntimeAdapter(runtimeState, mockConfig);
  });

  afterEach(() => {
    adapter.dispose();
    resetRuntimeAdapter();
  });

  describe('AgentRuntimeAdapter Integration', () => {
    it('should provide runtime state via getSnapshot()', () => {
      const snapshot = adapter.getSnapshot();

      expect(snapshot.runtimeId).toBe('test-runtime');
      expect(snapshot.provider).toBe('gemini');
      expect(snapshot.model).toBe('gemini-1.5-flash');
      expect(snapshot.sessionId).toBe('test-session-123');
    });

    it('should return frozen immutable snapshot', () => {
      const snapshot = adapter.getSnapshot();

      expect(Object.isFrozen(snapshot)).toBe(true);

      // Attempt to modify should fail silently or throw in strict mode
      expect(() => {
        (snapshot as { provider: string }).provider = 'openai';
      }).toThrow();
    });

    it('should expose runtime state fields via individual getters', () => {
      expect(adapter.getProvider()).toBe('gemini');
      expect(adapter.getModel()).toBe('gemini-1.5-flash');
      expect(adapter.getSessionId()).toBe('test-session-123');
    });

    it('should allow model changes', () => {
      adapter.setModel('gemini-2.0-flash-exp');

      const state = adapter.getRuntimeState();
      expect(state.model).toBe('gemini-2.0-flash-exp');

      const snapshot = adapter.getSnapshot();
      expect(snapshot.model).toBe('gemini-2.0-flash-exp');
    });
  });

  describe('Global Adapter Registration', () => {
    it('should set and retrieve global runtime adapter', () => {
      setRuntimeAdapter(adapter);

      const retrieved = getRuntimeAdapter();
      expect(retrieved).toBe(adapter);

      expect(retrieved.getProvider()).toBe('gemini');
      expect(retrieved.getModel()).toBe('gemini-1.5-flash');
    });

    it('should throw if global adapter not initialized', () => {
      resetRuntimeAdapter();

      expect(() => getRuntimeAdapter()).toThrow(
        /Runtime adapter not initialized/,
      );
    });
  });

  describe('Runtime State Immutability', () => {
    it('should create new runtime state instance on update', () => {
      const originalState = adapter.getRuntimeState();

      adapter.setModel('gemini-2.0-flash-exp');

      const updatedState = adapter.getRuntimeState();

      // New instance created
      expect(updatedState).not.toBe(originalState);

      // Old instance unchanged
      expect(originalState.model).toBe('gemini-1.5-flash');

      // New instance has updated value
      expect(updatedState.model).toBe('gemini-2.0-flash-exp');
    });

    it('should preserve immutability of runtime state snapshots', () => {
      const snapshot1 = adapter.getSnapshot();

      adapter.setModel('gemini-2.0-flash-exp');

      const snapshot2 = adapter.getSnapshot();

      // Snapshots are different objects
      expect(snapshot2).not.toBe(snapshot1);

      // First snapshot unchanged
      expect(snapshot1.model).toBe('gemini-1.5-flash');

      // Second snapshot has new value
      expect(snapshot2.model).toBe('gemini-2.0-flash-exp');

      // Both snapshots are frozen
      expect(Object.isFrozen(snapshot1)).toBe(true);
      expect(Object.isFrozen(snapshot2)).toBe(true);
    });
  });

  describe('Diagnostics Integration', () => {
    it('should provide snapshot for diagnostics command', () => {
      setRuntimeAdapter(adapter);

      // Simulate diagnostics command accessing runtime state
      const diagnosticAdapter = getRuntimeAdapter();
      const snapshot = diagnosticAdapter.getSnapshot();

      expect(snapshot.provider).toBe('gemini');
      expect(snapshot.model).toBe('gemini-1.5-flash');
      expect(snapshot.sessionId).toBe('test-session-123');
    });

    it('should reflect runtime state changes in diagnostics', () => {
      setRuntimeAdapter(adapter);

      // Initial state
      const beforeSnapshot = getRuntimeAdapter().getSnapshot();
      expect(beforeSnapshot.model).toBe('gemini-1.5-flash');

      // Change model
      adapter.setModel('gemini-2.0-flash-exp');

      // Diagnostics should see updated state
      const afterSnapshot = getRuntimeAdapter().getSnapshot();
      expect(afterSnapshot.model).toBe('gemini-2.0-flash-exp');
    });
  });

  describe('Config Mirroring', () => {
    it('should mirror runtime state to Config for UI compatibility', () => {
      let mirroredProvider: string | undefined;
      let mirroredModel: string | undefined;

      // Create mock Config that tracks mirrored values
      const trackingConfig = {
        ...mockConfig,
        setProvider: (p: string) => {
          mirroredProvider = p;
        },
        setModel: (m: string) => {
          mirroredModel = m;
        },
        setEphemeralSetting: () => {},
        getProviderManager: () => ({
          listProviders: () => ['gemini', 'openai', 'anthropic'],
        }),
      } as unknown as Config;

      // Create adapter with tracking config
      const trackingAdapter = new AgentRuntimeAdapter(
        runtimeState,
        trackingConfig,
      );

      // Constructor should mirror initial state
      expect(mirroredProvider).toBe('gemini');
      expect(mirroredModel).toBe('gemini-1.5-flash');

      // Model change should mirror to config
      trackingAdapter.setModel('gemini-2.0-flash-exp');
      expect(mirroredModel).toBe('gemini-2.0-flash-exp');

      trackingAdapter.dispose();
    });
  });
});
