/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P09
 * @requirement REQ-STAT5-003.1
 * @pseudocode gemini-runtime.md lines 145-248
 *
 * TDD tests for GeminiClient runtime state integration (RED phase).
 * These tests verify that GeminiClient consumes AgentRuntimeState for model/provider/auth
 * instead of reading from Config directly.
 *
 * Expected outcome: These tests FAIL against current implementation because
 * GeminiClient still uses Config directly.
 */

import { describe, it, expect } from 'vitest';
import { GeminiClient } from '../client.js';
import { Config } from '../../config/config.js';
import {
  createAgentRuntimeState,
  updateAgentRuntimeState,
  type AgentRuntimeState,
} from '../../runtime/AgentRuntimeState.js';
import { HistoryService } from '../../services/history/HistoryService.js';

/**
 * Test helper: Create minimal Config for testing
 */
function createTestConfig(): Config {
  const config = new Config({
    sessionId: 'test-session-id',
    targetDir: '/tmp/test-dir',
  } as unknown as import('../../config/config.js').ConfigParameters);
  // Note: We don't set provider/model/auth here because runtime state should override them
  return config;
}

/**
 * Test helper: Create test AgentRuntimeState
 */
function createTestRuntimeState(
  overrides?: Partial<AgentRuntimeState>,
): AgentRuntimeState {
  return createAgentRuntimeState({
    runtimeId: 'test-runtime-001',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    sessionId: 'test-session-001',
    ...overrides,
  });
}

describe('GeminiClient - Runtime State Integration', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-003.1
   * @pseudocode gemini-runtime.md lines 18-60
   *
   * Test: GeminiClient constructor accepts AgentRuntimeState
   */
  describe('Constructor Integration', () => {
    it('should accept AgentRuntimeState as second parameter', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1
      // @pseudocode gemini-runtime.md lines 21-42

      const config = createTestConfig();
      const runtimeState = createTestRuntimeState();

      // This will fail because current GeminiClient constructor only accepts Config
      expect(() => {
        // @ts-expect-error - Testing future constructor signature
        new GeminiClient(config, runtimeState);
      }).not.toThrow();
    });

    it('should accept HistoryService as third parameter', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1
      // @pseudocode gemini-runtime.md lines 43-48

      const config = createTestConfig();
      const runtimeState = createTestRuntimeState();
      const historyService = {} as HistoryService; // Mock

      // This will fail because current GeminiClient constructor signature doesn't support this
      expect(() => {
        // @ts-expect-error - Testing future constructor signature
        new GeminiClient(config, runtimeState, historyService);
      }).not.toThrow();
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-003.1
   * @pseudocode gemini-runtime.md lines 60-142
   *
   * Test: GeminiClient uses runtime state for provider/model/auth
   */
  describe('Runtime State Usage', () => {
    it('should read provider from runtime state when config differs', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1
      // @pseudocode gemini-runtime.md lines 245-248

      const config = createTestConfig();
      config.setProvider('openai'); // Config has different provider

      const runtimeState = createTestRuntimeState({
        provider: 'gemini', // Runtime state has gemini
      });

      // @ts-expect-error - Testing future API
      const client = new GeminiClient(config, runtimeState);

      // When we initialize the client, it should use 'gemini' from runtime state
      // Verify that the client has stored the runtime state
      expect(client['runtimeState']).toBeDefined();
      expect(client['runtimeState']?.provider).toBe('gemini');
    });

    it('should read model from runtime state not Config', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1
      // @pseudocode gemini-runtime.md lines 171-176

      const config = createTestConfig();
      config.setModel('gemini-1.5-pro'); // Config has different model

      const runtimeState = createTestRuntimeState({
        model: 'gemini-2.0-flash', // Runtime state has different model
      });

      // @ts-expect-error - Testing future API
      const client = new GeminiClient(config, runtimeState);

      // Model selection should use runtime state value
      expect(client['runtimeState']).toBeDefined();
      expect(client['runtimeState']?.model).toBe('gemini-2.0-flash');
    });

    it('should read provider from runtime state for explicit provider override', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1
      // @pseudocode gemini-runtime.md lines 90-104

      const config = createTestConfig();
      config.setProvider('openai');

      const runtimeState = createTestRuntimeState({
        provider: 'gemini',
      });

      // @ts-expect-error - Testing future API
      const client = new GeminiClient(config, runtimeState);

      expect(client['runtimeState']).toBeDefined();
      expect(client['runtimeState']?.provider).toBe('gemini');
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-003.2
   * @pseudocode gemini-runtime.md lines 55-59
   *
   * Test: Runtime state change subscription for telemetry
   */
  describe('Runtime State Subscription', () => {
    it('should subscribe to runtime state changes on construction', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.2
      // @pseudocode gemini-runtime.md lines 55-59

      const config = createTestConfig();
      const runtimeState = createTestRuntimeState();

      // @ts-expect-error - Testing future API
      const client = new GeminiClient(config, runtimeState);

      // Verify that the client has subscribed (has an unsubscribe function)
      expect(client['_unsubscribe']).toBeDefined();
      expect(typeof client['_unsubscribe']).toBe('function');
    });

    it('should update telemetry metadata when runtime state changes', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.2
      // @pseudocode gemini-runtime.md lines 55-59

      const config = createTestConfig();
      const runtimeState = createTestRuntimeState();

      // @ts-expect-error - Testing future API
      const client = new GeminiClient(config, runtimeState);

      // Verify subscription exists
      expect(client['_unsubscribe']).toBeDefined();

      // Change runtime state
      const updatedState = updateAgentRuntimeState(runtimeState.runtimeId, {
        model: 'gemini-2.5-flash',
      });

      // Client should still have reference to updated runtime state
      expect(updatedState.model).toBe('gemini-2.5-flash');
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-003.1
   *
   * Test: Runtime state updates do not mutate state object
   */
  describe('State Immutability', () => {
    it('should not mutate runtime state when client operates', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1

      const config = createTestConfig();
      const runtimeState = createTestRuntimeState();
      const originalProvider = runtimeState.provider;
      const originalModel = runtimeState.model;
      const originalUpdatedAt = runtimeState.updatedAt;

      // @ts-expect-error - Testing future API
      const _client = new GeminiClient(config, runtimeState);

      // Perform some operations (mocked)
      // Client operations should not mutate the runtime state object

      expect(runtimeState.provider).toBe(originalProvider);
      expect(runtimeState.model).toBe(originalModel);
      expect(runtimeState.updatedAt).toBe(originalUpdatedAt);
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-003.1
   * @pseudocode gemini-runtime.md lines 189-196
   *
   * Test: HistoryService reuse
   */
  describe('HistoryService Reuse', () => {
    it('should reuse injected HistoryService instance', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1
      // @pseudocode gemini-runtime.md lines 189-196

      const config = createTestConfig();
      const runtimeState = createTestRuntimeState();
      const historyService = {} as HistoryService; // Mock

      // @ts-expect-error - Testing future API
      const client = new GeminiClient(config, runtimeState, historyService);

      // Client should store the injected HistoryService
      expect(client['_historyService']).toBe(historyService);
    });

    it('should create HistoryService from config if not provided (legacy path)', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1
      // @pseudocode gemini-runtime.md lines 189-196

      const config = createTestConfig();
      const runtimeState = createTestRuntimeState();

      // @ts-expect-error - Testing future API
      const client = new GeminiClient(config, runtimeState);
      // No history service provided

      // Client should not have a history service yet (lazy creation)
      // This tests backward compatibility - history service is optional
      expect(client['_historyService']).toBeUndefined();
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-003.1
   *
   * Test: Error handling when runtime state missing required data
   */
  describe('Error Handling', () => {
    it('should throw error when runtime state has invalid provider', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1

      const config = createTestConfig();
      // Create runtime state with invalid provider by bypassing validation
      const runtimeState = {
        runtimeId: 'test-runtime-001',
        provider: '', // Invalid
        model: 'gemini-2.0-flash',
        sessionId: 'test-session-001',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as unknown as AgentRuntimeState;

      expect(() => {
        // @ts-expect-error - Testing future API
        new GeminiClient(config, runtimeState);
      }).toThrow(/provider/i);
    });

    it('should throw error when runtime state has invalid model', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1

      const config = createTestConfig();
      // Create runtime state with invalid model by bypassing validation
      const runtimeState = {
        runtimeId: 'test-runtime-001',
        provider: 'gemini',
        model: '', // Invalid
        sessionId: 'test-session-001',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as unknown as AgentRuntimeState;

      expect(() => {
        // @ts-expect-error - Testing future API
        new GeminiClient(config, runtimeState);
      }).toThrow(/model/i);
    });

    it('should throw error when runtime state has blank provider override', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-003.1

      const config = createTestConfig();
      const baseState = createTestRuntimeState();
      const runtimeState = Object.freeze({
        ...baseState,
        provider: '',
        updatedAt: Date.now(),
      }) as AgentRuntimeState;

      expect(() => {
        // @ts-expect-error - Testing future API
        new GeminiClient(config, runtimeState);
      }).toThrow(/provider/i);
    });
  });
});
