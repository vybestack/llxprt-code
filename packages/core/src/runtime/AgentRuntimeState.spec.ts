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

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createAgentRuntimeState,
  updateAgentRuntimeState,
  updateAgentRuntimeStateBatch,
  getAgentRuntimeStateSnapshot,
  getProvider,
  getModel,
  getBaseUrl,
  getSessionId,
  getModelParams,
  RuntimeStateError,
  RuntimeStateErrorCode,
  type AgentRuntimeState,
  type RuntimeStateParams,
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
    }).toThrow(TypeError);
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
      /update\.unsupported/,
    );
  });

  it('should validate provider is non-empty string on update', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 219-221

    expect(() => updateAgentRuntimeState(baseState, { provider: '' })).toThrow(
      /provider\.invalid/,
    );
  });

  it('should validate model is non-empty string on update', () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001.2
    // @pseudocode runtime-state.md lines 222-223

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
    }).toThrow(TypeError);
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
    }).toThrow(TypeError);
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

    expect(modelParams).toStrictEqual({ temperature: 0.7 });
    expect(() => {
      (modelParams as Record<string, unknown>).temperature = 0.9;
    }).toThrow(TypeError);
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
    expect(error.details).toStrictEqual({ provider: '' });
    expect(error.message).toContain('provider.missing');
  });
});
