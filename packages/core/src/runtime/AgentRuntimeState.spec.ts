/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P04
 * @requirement REQ-STAT5-001
 * @pseudocode runtime-state.md lines 535-561
 *
 * Comprehensive TDD tests for AgentRuntimeState behavior.
 * RED phase: All tests fail against stub implementation.
 * GREEN phase: Phase 05 implements the actual runtime state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAgentRuntimeState,
  updateAgentRuntimeState,
  updateAgentRuntimeStateBatch,
  getAgentRuntimeStateSnapshot,
  subscribeToAgentRuntimeState,
  getProvider,
  getModel,
  getBaseUrl,
  getSessionId,
  getModelParams,
  RuntimeStateError,
  RuntimeStateErrorCode,
  type AgentRuntimeState,
  type RuntimeStateParams,
  type RuntimeStateChangedEvent,
} from './AgentRuntimeState.js';

describe('AgentRuntimeState - Constructor Validation', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P04
   * @requirement REQ-STAT5-001.1
   * @pseudocode runtime-state.md lines 73-105
   *
   * Tests that createAgentRuntimeState validates required fields and auth consistency.
   */

  it('should create valid runtime state with all required fields', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.1
    // @pseudocode runtime-state.md lines 73-105

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime-001',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session-001',
    };

    const state = createAgentRuntimeState(params);

    expect(state.runtimeId).toBe('test-runtime-001');
    expect(state.provider).toBe('gemini');
    expect(state.model).toBe('gemini-2.0-flash');
    expect(state.sessionId).toBe('test-session-001');
    expect(state.updatedAt).toBeGreaterThan(0);
  });

  it('should throw error when runtimeId is missing', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.1
    // @pseudocode runtime-state.md lines 75-76

    const params = {
      runtimeId: '',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
    } as RuntimeStateParams;

    expect(() => createAgentRuntimeState(params)).toThrow(RuntimeStateError);
    expect(() => createAgentRuntimeState(params)).toThrow(/runtimeId\.missing/);
  });

  it('should throw error when provider is missing', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.1
    // @pseudocode runtime-state.md lines 77-78

    const params = {
      runtimeId: 'test-runtime',
      provider: '',
      model: 'gemini-2.0-flash',
    } as RuntimeStateParams;

    expect(() => createAgentRuntimeState(params)).toThrow(RuntimeStateError);
    expect(() => createAgentRuntimeState(params)).toThrow(/provider\.missing/);
  });

  it('should throw error when model is missing', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.1
    // @pseudocode runtime-state.md lines 79-80

    const params = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: '',
    } as RuntimeStateParams;

    expect(() => createAgentRuntimeState(params)).toThrow(RuntimeStateError);
    expect(() => createAgentRuntimeState(params)).toThrow(/model\.missing/);
  });

  it('should throw error when baseUrl is invalid URL format', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.1
    // @pseudocode runtime-state.md lines 89-91

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      baseUrl: 'not-a-valid-url',
    };

    expect(() => createAgentRuntimeState(params)).toThrow(RuntimeStateError);
    expect(() => createAgentRuntimeState(params)).toThrow(/baseUrl\.invalid/);
  });

  it('should generate sessionId if not provided', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.1
    // @pseudocode runtime-state.md lines 101

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      // sessionId omitted
    };

    const state = createAgentRuntimeState(params);

    expect(state.sessionId).toBeDefined();
    expect(state.sessionId.length).toBeGreaterThan(0);
  });

  it('should deep freeze modelParams to prevent mutation', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 100

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      modelParams: { temperature: 0.7 },
    };

    const state = createAgentRuntimeState(params);

    expect(() => {
      (state.modelParams as Record<string, unknown>).temperature = 0.9;
    }).toThrow();
  });
});

describe('AgentRuntimeState - Immutable Updates', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P04
   * @requirement REQ-STAT5-001.2
   * @pseudocode runtime-state.md lines 209-243
   *
   * Tests that updateAgentRuntimeState creates new immutable instances.
   */

  let baseState: AgentRuntimeState;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    baseState = createAgentRuntimeState(params);
  });

  it('should create new instance when updating provider', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 209-243

    const newState = updateAgentRuntimeState(baseState, { provider: 'openai' });

    expect(newState).not.toBe(baseState);
    expect(newState.provider).toBe('openai');
    expect(baseState.provider).toBe('gemini'); // Original unchanged
  });

  it('should create new instance when updating model', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 209-243

    const newState = updateAgentRuntimeState(baseState, {
      model: 'gemini-2.5-flash',
    });

    expect(newState).not.toBe(baseState);
    expect(newState.model).toBe('gemini-2.5-flash');
    expect(baseState.model).toBe('gemini-2.0-flash'); // Original unchanged
  });

  it('should update timestamp when creating new state', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 226

    const originalTimestamp = baseState.updatedAt;
    const newState = updateAgentRuntimeState(baseState, {
      model: 'gemini-2.5-flash',
    });

    expect(newState.updatedAt).toBeGreaterThan(originalTimestamp);
  });

  it('should throw error for unsupported update field', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 214-218

    const updates = {
      unsupportedField: 'value',
    } as Partial<RuntimeStateParams>;

    expect(() => updateAgentRuntimeState(baseState, updates)).toThrow(
      RuntimeStateError,
    );
    expect(() => updateAgentRuntimeState(baseState, updates)).toThrow(
      /update\.unsupported/,
    );
  });

  it('should validate provider is non-empty string on update', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 219-221

    expect(() => updateAgentRuntimeState(baseState, { provider: '' })).toThrow(
      RuntimeStateError,
    );
    expect(() => updateAgentRuntimeState(baseState, { provider: '' })).toThrow(
      /provider\.invalid/,
    );
  });

  it('should validate model is non-empty string on update', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 222-223

    expect(() => updateAgentRuntimeState(baseState, { model: '' })).toThrow(
      RuntimeStateError,
    );
    expect(() => updateAgentRuntimeState(baseState, { model: '' })).toThrow(
      /model\.invalid/,
    );
  });

  it('should freeze returned state to prevent mutation', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 227

    const newState = updateAgentRuntimeState(baseState, {
      model: 'gemini-2.5-flash',
    });

    expect(() => {
      (newState as Record<string, unknown>).model = 'modified';
    }).toThrow();
  });
});

describe('AgentRuntimeState - Event Emission', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P04
   * @requirement REQ-STAT5-001.2
   * @pseudocode runtime-state.md lines 230-242
   *
   * Tests that state changes emit synchronous events with correct changesets.
   */

  let baseState: AgentRuntimeState;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    baseState = createAgentRuntimeState(params);
  });

  it('should emit event with correct changeset on update', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 230-241

    const callback = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback);

    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });

    expect(callback).toHaveBeenCalledTimes(1);
    const event = callback.mock.calls[0][0] as RuntimeStateChangedEvent;
    expect(event.runtimeId).toBe('test-runtime');
    expect(event.changes.model).toEqual({
      old: 'gemini-2.0-flash',
      new: 'gemini-2.5-flash',
    });
  });

  it('should emit event synchronously by default', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // @pseudocode runtime-state.md lines 319-325

    let eventFired = false;
    subscribeToAgentRuntimeState('test-runtime', () => {
      eventFired = true;
    });

    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });

    expect(eventFired).toBe(true);
  });

  it('should include snapshot in emitted event', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 238-239

    const callback = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback);

    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });

    const event = callback.mock.calls[0][0] as RuntimeStateChangedEvent;
    expect(event.snapshot).toBeDefined();
    expect(event.snapshot.model).toBe('gemini-2.5-flash');
    expect(event.snapshot.runtimeId).toBe('test-runtime');
  });

  it('should include timestamp in emitted event', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 240

    const callback = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback);

    const beforeUpdate = Date.now();
    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });
    const afterUpdate = Date.now();

    const event = callback.mock.calls[0][0] as RuntimeStateChangedEvent;
    expect(event.timestamp).toBeGreaterThanOrEqual(beforeUpdate);
    expect(event.timestamp).toBeLessThanOrEqual(afterUpdate);
  });

  it('should not emit event if no subscribers', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // Test that update completes successfully even without subscribers

    expect(() =>
      updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' }),
    ).not.toThrow();
  });
});

describe('AgentRuntimeState - Batch Updates', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P04
   * @requirement REQ-STAT5-002.3
   * @pseudocode runtime-state.md lines 252-278
   *
   * Tests atomic multi-field updates with single event emission.
   */

  let baseState: AgentRuntimeState;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    baseState = createAgentRuntimeState(params);
  });

  it('should atomically update multiple fields in batch', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-002.3
    // @pseudocode runtime-state.md lines 252-276

    const newState = updateAgentRuntimeStateBatch(baseState, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      baseUrl: 'https://api.anthropic.com',
    });

    expect(newState.provider).toBe('anthropic');
    expect(newState.model).toBe('claude-3-5-sonnet-20241022');
    expect(newState.baseUrl).toBe('https://api.anthropic.com');
  });

  it('should emit single event for batch update', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-002.3
    // @pseudocode runtime-state.md lines 264

    const callback = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback);

    updateAgentRuntimeStateBatch(baseState, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should include all changed fields in batch event changeset', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-002.3
    // @pseudocode runtime-state.md lines 263

    const callback = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback);

    updateAgentRuntimeStateBatch(baseState, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    });

    const event = callback.mock.calls[0][0] as RuntimeStateChangedEvent;
    expect(event.changes.provider).toBeDefined();
    expect(event.changes.model).toBeDefined();
  });

  it('should rollback without mutating state if validation fails', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-002.3
    // @pseudocode runtime-state.md lines 257-258

    const originalProvider = baseState.provider;
    const originalModel = baseState.model;

    expect(() =>
      updateAgentRuntimeStateBatch(baseState, {
        provider: 'openai',
        model: '', // Invalid model
      }),
    ).toThrow(RuntimeStateError);

    expect(baseState.provider).toBe(originalProvider);
    expect(baseState.model).toBe(originalModel);
  });
});

describe('AgentRuntimeState - Event Subscription', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P04
   * @requirement REQ-STAT5-003.2
   * @pseudocode runtime-state.md lines 289-318
   *
   * Tests subscription lifecycle and callback invocation.
   */

  let baseState: AgentRuntimeState;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    baseState = createAgentRuntimeState(params);
  });

  it('should invoke callback when state changes', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // @pseudocode runtime-state.md lines 289-306

    const callback = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback);

    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });

    expect(callback).toHaveBeenCalled();
  });

  it('should invoke callback synchronously by default', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // @pseudocode runtime-state.md lines 319-325

    let callbackInvoked = false;
    subscribeToAgentRuntimeState('test-runtime', () => {
      callbackInvoked = true;
    });

    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });

    expect(callbackInvoked).toBe(true);
  });

  it('should invoke callback asynchronously when async option is true', async () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // @pseudocode runtime-state.md lines 319-325

    let callbackInvoked = false;
    subscribeToAgentRuntimeState(
      'test-runtime',
      () => {
        callbackInvoked = true;
      },
      { async: true },
    );

    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });

    expect(callbackInvoked).toBe(false); // Not yet invoked
    await new Promise((resolve) => setTimeout(resolve, 0)); // Wait for microtask
    expect(callbackInvoked).toBe(true); // Now invoked
  });

  it('should return unsubscribe function', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // @pseudocode runtime-state.md lines 304-306

    const unsubscribe = subscribeToAgentRuntimeState('test-runtime', vi.fn());

    expect(typeof unsubscribe).toBe('function');
  });

  it('should not invoke callback after unsubscribe', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // @pseudocode runtime-state.md lines 304-306

    const callback = vi.fn();
    const unsubscribe = subscribeToAgentRuntimeState('test-runtime', callback);

    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();

    updateAgentRuntimeState(baseState, { model: 'gemini-3.0-flash' });
    expect(callback).toHaveBeenCalledTimes(1); // Still only called once
  });

  it('should support multiple subscribers for same runtimeId', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // @pseudocode runtime-state.md lines 289-325

    const callback1 = vi.fn();
    const callback2 = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback1);
    subscribeToAgentRuntimeState('test-runtime', callback2);

    updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' });

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
  });

  it('should handle callback errors without cascade failure', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.2
    // @pseudocode runtime-state.md lines 315 (error handling comment)

    const errorCallback = vi.fn(() => {
      throw new Error('Callback error');
    });
    const successCallback = vi.fn();

    subscribeToAgentRuntimeState('test-runtime', errorCallback);
    subscribeToAgentRuntimeState('test-runtime', successCallback);

    expect(() =>
      updateAgentRuntimeState(baseState, { model: 'gemini-2.5-flash' }),
    ).not.toThrow();

    expect(successCallback).toHaveBeenCalledTimes(1);
  });
});

describe('AgentRuntimeState - Snapshot Export', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P04
   * @requirement REQ-STAT5-001.3
   * @pseudocode runtime-state.md lines 329-355
   *
   * Tests diagnostics snapshot generation with auth payload sanitization.
   */

  it('should export frozen snapshot with all fields', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.3
    // @pseudocode runtime-state.md lines 329-342

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      baseUrl: 'https://api.gemini.com',
      sessionId: 'test-session',
      modelParams: { temperature: 0.7 },
    };
    const state = createAgentRuntimeState(params);

    const snapshot = getAgentRuntimeStateSnapshot(state);

    expect(snapshot.runtimeId).toBe('test-runtime');
    expect(snapshot.provider).toBe('gemini');
    expect(snapshot.model).toBe('gemini-2.0-flash');
    expect(snapshot.baseUrl).toBe('https://api.gemini.com');
    expect(snapshot.sessionId).toBe('test-session');
    expect(snapshot.version).toBe(1);
  });

  it('should return frozen snapshot object', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.3
    // @pseudocode runtime-state.md lines 330

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const state = createAgentRuntimeState(params);

    const snapshot = getAgentRuntimeStateSnapshot(state);

    expect(() => {
      (snapshot as Record<string, unknown>).model = 'modified';
    }).toThrow();
  });

  it('should include schema version for future migrations', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.3
    // @pseudocode runtime-state.md lines 341

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const state = createAgentRuntimeState(params);

    const snapshot = getAgentRuntimeStateSnapshot(state);

    expect(snapshot.version).toBe(1);
  });
});

describe('AgentRuntimeState - Synchronous Accessors', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P04
   * @requirement REQ-STAT5-003.1
   * @pseudocode runtime-state.md lines 150-173
   *
   * Tests fast synchronous field accessors.
   */

  let state: AgentRuntimeState;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      baseUrl: 'https://api.gemini.com',
      sessionId: 'test-session',
      modelParams: { temperature: 0.7 },
    };
    state = createAgentRuntimeState(params);
  });

  it('should return provider via getProvider', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.1
    // @pseudocode runtime-state.md lines 150-152

    expect(getProvider(state)).toBe('gemini');
  });

  it('should return model via getModel', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.1
    // @pseudocode runtime-state.md lines 155-156

    expect(getModel(state)).toBe('gemini-2.0-flash');
  });

  it('should return baseUrl via getBaseUrl', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.1
    // @pseudocode runtime-state.md lines 165-166

    expect(getBaseUrl(state)).toBe('https://api.gemini.com');
  });

  it('should return sessionId via getSessionId', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.1
    // @pseudocode runtime-state.md lines 168-169

    expect(getSessionId(state)).toBe('test-session');
  });

  it('should return frozen clone of modelParams via getModelParams', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-003.1
    // @pseudocode runtime-state.md lines 171-172

    const modelParams = getModelParams(state);

    expect(modelParams).toEqual({ temperature: 0.7 });
    expect(() => {
      (modelParams as Record<string, unknown>).temperature = 0.9;
    }).toThrow();
  });
});

describe('AgentRuntimeState - Error Handling', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P04
   * @requirement REQ-STAT5-001.1
   * @pseudocode runtime-state.md lines 366-406
   *
   * Tests error types and validation error messages.
   */

  it('should create RuntimeStateError with code and details', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.1
    // @pseudocode runtime-state.md lines 366-380

    const error = new RuntimeStateError(
      RuntimeStateErrorCode.PROVIDER_MISSING,
      {
        provider: '',
      },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(RuntimeStateErrorCode.PROVIDER_MISSING);
    expect(error.details).toEqual({ provider: '' });
    expect(error.message).toContain('provider.missing');
  });
});
