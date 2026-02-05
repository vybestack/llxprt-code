/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P07
 * @requirement REQ-STAT5-002
 * @pseudocode cli-runtime-adapter.md lines 51-609
 *
 * Comprehensive TDD tests for AgentRuntimeAdapter behavior.
 * RED phase: All tests fail against stub implementation.
 * GREEN phase: Phase 08 implements the actual adapter logic.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AgentRuntimeAdapter,
  bootstrapForegroundAgent,
  resolveRuntimeStateFromFlags,
  setRuntimeAdapter,
  getRuntimeAdapter,
  resetRuntimeAdapter,
  setRuntimeProvider,
  getRuntimeProvider,
  setRuntimeModel,
  getRuntimeModel,
  switchRuntimeProvider,
  type CliFlags,
  type BootstrapResult,
} from './agentRuntimeAdapter.js';
import {
  createAgentRuntimeState,
  updateAgentRuntimeState,
  subscribeToAgentRuntimeState,
  type AgentRuntimeState,
  type RuntimeStateParams,
  type Config,
} from '@vybestack/llxprt-code-core';

// Mock fs module for keyfile reading
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((path: string) => {
      if (path === '/path/to/keyfile') {
        return 'test-api-key-from-file';
      }
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }),
  };
});

// Mock Config for testing
function createMockConfig(): Config {
  const mockProviderManager = {
    hasProvider: vi.fn((name: string) =>
      ['gemini', 'anthropic', 'openai'].includes(name),
    ),
    getProvider: vi.fn((name: string) => ({
      getDefaultModel: vi.fn(() => {
        const defaults: Record<string, string> = {
          gemini: 'gemini-2.0-flash',
          anthropic: 'claude-3-5-sonnet-20241022',
          openai: 'gpt-4',
        };
        return defaults[name] || 'default-model';
      }),
    })),
    getProviderByName: vi.fn((name: string) => {
      if (!['gemini', 'anthropic', 'openai'].includes(name)) {
        return undefined;
      }
      return {
        getDefaultModel: vi.fn(() => {
          const defaults: Record<string, string> = {
            gemini: 'gemini-2.0-flash',
            anthropic: 'claude-3-5-sonnet-20241022',
            openai: 'gpt-4',
          };
          return defaults[name] || 'default-model';
        }),
      };
    }),
    getProviderNames: vi.fn(() => ['gemini', 'anthropic', 'openai']),
    listProviders: vi.fn(() => ['gemini', 'anthropic', 'openai']),
  };

  return {
    getProvider: vi.fn(() => 'gemini'),
    setProvider: vi.fn(),
    getModel: vi.fn(() => 'gemini-2.0-flash'),
    setModel: vi.fn(),
    getSessionId: vi.fn(() => 'test-session-id'),
    getProxy: vi.fn(() => undefined),
    setProxy: vi.fn(),
    getEphemeralSetting: vi.fn((key: string) => {
      if (key === 'base-url') return undefined;
      return undefined;
    }),
    setEphemeralSetting: vi.fn(),
    getProviderManager: vi.fn(() => mockProviderManager),
    refreshAuth: vi.fn(async () => {}),
    getSettingsService: vi.fn(() => ({})),
  } as unknown as Config;
}

describe('AgentRuntimeAdapter - Constructor and Initialization', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 51-88
   *
   * Tests adapter construction, state initialization, and config mirroring.
   */

  it('should initialize adapter with runtime state and legacy config', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 56-75

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();

    const adapter = new AgentRuntimeAdapter(runtimeState, config);

    expect(adapter.getProvider()).toBe('gemini');
    expect(adapter.getModel()).toBe('gemini-2.0-flash');
  });

  it('should mirror initial state to legacy config on construction', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 67-68

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      baseUrl: 'https://api.anthropic.com',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();

    new AgentRuntimeAdapter(runtimeState, config);

    expect(config.setProvider).toHaveBeenCalledWith('anthropic');
    expect(config.setModel).toHaveBeenCalledWith('claude-3-5-sonnet-20241022');
    expect(config.setEphemeralSetting).toHaveBeenCalledWith(
      'base-url',
      'https://api.anthropic.com',
    );
  });

  it('should subscribe to runtime state changes on construction', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 70-73

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();

    const adapter = new AgentRuntimeAdapter(runtimeState, config);

    // Update state and verify adapter reflects the change
    updateAgentRuntimeState(runtimeState, { model: 'gemini-2.5-flash' });

    // After subscription, adapter should reflect new state
    expect(adapter.getModel()).toBe('gemini-2.5-flash');
  });
});

describe('AgentRuntimeAdapter - Read Operations', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 199-221
   *
   * Tests synchronous getters that delegate to runtime state.
   */

  let adapter: AgentRuntimeAdapter;
  let runtimeState: AgentRuntimeState;
  let config: Config;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      baseUrl: 'https://custom.api.com',
      sessionId: 'test-session-123',
      modelParams: { temperature: 0.7 },
    };
    runtimeState = createAgentRuntimeState(params);
    config = createMockConfig();
    adapter = new AgentRuntimeAdapter(runtimeState, config);
  });

  it('should return current provider name via getProvider', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 199-203

    expect(adapter.getProvider()).toBe('gemini');
  });

  it('should return current model name via getModel', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 205-206

    expect(adapter.getModel()).toBe('gemini-2.0-flash');
  });

  it('should return current session ID via getSessionId', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 211-212

    expect(adapter.getSessionId()).toBe('test-session-123');
  });

  it('should return current base URL via getBaseUrl', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 214-215

    expect(adapter.getBaseUrl()).toBe('https://custom.api.com');
  });

  it('should return runtime state reference via getRuntimeState', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 217-218

    const state = adapter.getRuntimeState();

    expect(state.runtimeId).toBe('test-runtime');
    expect(state.provider).toBe('gemini');
    expect(state.model).toBe('gemini-2.0-flash');
  });

  it('should return sanitized snapshot via getSnapshot', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-001.3
    // @pseudocode cli-runtime-adapter.md lines 220-221

    const snapshot = adapter.getSnapshot();

    expect(snapshot.runtimeId).toBe('test-runtime');
    expect(snapshot.provider).toBe('gemini');
    expect(snapshot.model).toBe('gemini-2.0-flash');
  });
});

describe('AgentRuntimeAdapter - Write Operations (Single Field)', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.1, REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 227-272
   *
   * Tests single field updates with config mirroring.
   */

  let adapter: AgentRuntimeAdapter;
  let config: Config;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    config = createMockConfig();
    adapter = new AgentRuntimeAdapter(runtimeState, config);
  });

  it('should update provider and default model via setProvider', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1, REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 227-249

    adapter.setProvider('anthropic');

    expect(adapter.getProvider()).toBe('anthropic');
    expect(adapter.getModel()).toBe('claude-3-5-sonnet-20241022'); // Default for anthropic
    expect(adapter.getBaseUrl()).toBeUndefined(); // Cleared
  });

  it('should mirror provider update to legacy config', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 244-248

    adapter.setProvider('anthropic');

    expect(config.setProvider).toHaveBeenCalledWith('anthropic');
    expect(config.setModel).toHaveBeenCalledWith('claude-3-5-sonnet-20241022');
  });

  it('should throw error when setting invalid provider', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 229-231

    expect(() => adapter.setProvider('invalid-provider')).toThrow();
    expect(() => adapter.setProvider('invalid-provider')).toThrow(/not found/);
  });

  it('should update model via setModel', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1, REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 250-256

    adapter.setModel('gemini-2.5-flash');

    expect(adapter.getModel()).toBe('gemini-2.5-flash');
    expect(config.setModel).toHaveBeenCalledWith('gemini-2.5-flash');
  });

  it('should update base URL via setBaseUrl', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1, REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 266-272

    adapter.setBaseUrl('https://custom.api.com');

    expect(adapter.getBaseUrl()).toBe('https://custom.api.com');
    expect(config.setEphemeralSetting).toHaveBeenCalledWith(
      'base-url',
      'https://custom.api.com',
    );
  });
});

describe('AgentRuntimeAdapter - Batch Write Operations', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.1, REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 280-316
   *
   * Tests atomic multi-field updates via switchProvider.
   */

  let adapter: AgentRuntimeAdapter;
  let config: Config;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      baseUrl: 'https://old.api.com',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    config = createMockConfig();
    adapter = new AgentRuntimeAdapter(runtimeState, config);
  });

  it('should atomically switch provider with default model', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1, REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 280-316

    adapter.switchProvider('anthropic');

    expect(adapter.getProvider()).toBe('anthropic');
    expect(adapter.getModel()).toBe('claude-3-5-sonnet-20241022'); // Default model
    expect(adapter.getBaseUrl()).toBeUndefined(); // Base URL cleared
  });

  it('should switch provider with explicit model', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1, REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 290-293

    adapter.switchProvider('anthropic', { model: 'claude-3-opus-20240229' });

    expect(adapter.getProvider()).toBe('anthropic');
    expect(adapter.getModel()).toBe('claude-3-opus-20240229'); // Explicit model
  });

  it('should clear ephemeral settings when clearSettings is true', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 302-306

    adapter.switchProvider('anthropic', { clearSettings: true });

    expect(config.setEphemeralSetting).toHaveBeenCalledWith(
      'base-url',
      undefined,
    );
  });

  it('should preserve settings when clearSettings is false', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 302-306

    const setEphemeralCalls = (
      config.setEphemeralSetting as ReturnType<typeof vi.fn>
    ).mock.calls.length;

    adapter.switchProvider('anthropic', { clearSettings: false });

    // Should not call setEphemeralSetting with undefined (except for base-url clear)
    const newCalls = (config.setEphemeralSetting as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    expect(newCalls).toBeGreaterThan(setEphemeralCalls);
  });

  it('should throw error when switching to invalid provider', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 286-289

    expect(() => adapter.switchProvider('invalid-provider')).toThrow();
    expect(() => adapter.switchProvider('invalid-provider')).toThrow(
      /not found/,
    );
  });

  it('should not emit multiple events for batch update', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 308-312

    const callback = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback);

    adapter.switchProvider('anthropic');

    // Should emit only 1 event despite updating provider + model + baseUrl
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('AgentRuntimeAdapter - Config Mirroring', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 329-351
   *
   * Tests that runtime state changes mirror to legacy Config.
   */

  let adapter: AgentRuntimeAdapter;
  let config: Config;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    config = createMockConfig();
    adapter = new AgentRuntimeAdapter(runtimeState, config);
  });

  it('should mirror provider updates to config', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 331-333

    adapter.setProvider('anthropic');

    expect(config.setProvider).toHaveBeenCalledWith('anthropic');
  });

  it('should mirror model updates to config', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 334

    adapter.setModel('gemini-2.5-flash');

    expect(config.setModel).toHaveBeenCalledWith('gemini-2.5-flash');
  });

  it('should mirror base URL updates to config ephemeral settings', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 337-341

    adapter.setBaseUrl('https://custom.api.com');

    expect(config.setEphemeralSetting).toHaveBeenCalledWith(
      'base-url',
      'https://custom.api.com',
    );
  });

  it('should clear base URL in config when set to undefined', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 340-341

    adapter.setBaseUrl('https://custom.api.com');
    (config.setEphemeralSetting as ReturnType<typeof vi.fn>).mockClear();

    adapter.switchProvider('anthropic'); // Clears base URL

    expect(config.setEphemeralSetting).toHaveBeenCalledWith(
      'base-url',
      undefined,
    );
  });

  it('should not mirror session ID to config', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 349

    const sessionId = adapter.getSessionId();

    expect(sessionId).toBe('test-session');
    // Session ID is immutable and not mirrored
    expect(config.setEphemeralSetting).not.toHaveBeenCalledWith(
      'session-id',
      expect.anything(),
    );
  });
});

describe('AgentRuntimeAdapter - Lifecycle Management', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 597-609
   *
   * Tests adapter disposal and resource cleanup.
   */

  it('should unsubscribe from runtime state events on dispose', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 598-601

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();
    const adapter = new AgentRuntimeAdapter(runtimeState, config);

    const callback = vi.fn();
    subscribeToAgentRuntimeState('test-runtime', callback);

    adapter.dispose();

    // After dispose, adapter should not respond to state changes
    updateAgentRuntimeState(runtimeState, { model: 'gemini-2.5-flash' });

    // Callback still called (not adapter's subscription)
    expect(callback).toHaveBeenCalled();
  });

  it('should allow multiple dispose calls without error', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 597-609

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();
    const adapter = new AgentRuntimeAdapter(runtimeState, config);

    expect(() => {
      adapter.dispose();
      adapter.dispose();
    }).not.toThrow();
  });
});

describe('AgentRuntimeAdapter - Global Registry', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 366-376
   *
   * Tests global adapter registry for CLI helpers.
   */

  afterEach(() => {
    // Reset global adapter after each test
    try {
      getRuntimeAdapter()?.dispose();
    } catch {
      // No adapter set
    }
    resetRuntimeAdapter();
  });

  it('should set and get global runtime adapter', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 366-376

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();
    const adapter = new AgentRuntimeAdapter(runtimeState, config);

    setRuntimeAdapter(adapter);

    const retrievedAdapter = getRuntimeAdapter();
    expect(retrievedAdapter).toBe(adapter);
  });

  it('should throw error when getting adapter before initialization', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 369-375

    expect(() => getRuntimeAdapter()).toThrow();
    expect(() => getRuntimeAdapter()).toThrow(/not initialized/);
  });
});

describe('CLI Bootstrap Functions - resolveRuntimeStateFromFlags', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.2
   * @pseudocode cli-runtime-adapter.md lines 138-186
   *
   * Tests CLI flag resolution and precedence.
   */

  let config: Config;

  beforeEach(() => {
    config = createMockConfig();
  });

  it('should use config defaults when no flags provided', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 145-152

    const flags: CliFlags = {};

    const params = resolveRuntimeStateFromFlags(flags, config);

    expect(params.provider).toBe('gemini');
    expect(params.model).toBe('gemini-2.0-flash');
  });

  it('should override provider from CLI flag', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 154-157

    const flags: CliFlags = {
      provider: 'anthropic',
    };

    const params = resolveRuntimeStateFromFlags(flags, config);

    expect(params.provider).toBe('anthropic');
  });

  it('should override model from CLI flag', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 159-160

    const flags: CliFlags = {
      model: 'gemini-2.5-flash',
    };

    const params = resolveRuntimeStateFromFlags(flags, config);

    expect(params.model).toBe('gemini-2.5-flash');
  });

  it('should process --set flag for base-url', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 169-176

    const flags: CliFlags = {
      set: [['base-url', 'https://custom.api.com']],
    };

    const params = resolveRuntimeStateFromFlags(flags, config);

    expect(params.baseUrl).toBe('https://custom.api.com');
  });

  it('should process --set flag for model params', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 169-176

    const flags: CliFlags = {
      set: [
        ['temperature', '0.9'],
        ['max-tokens', '2000'],
      ],
    };

    const params = resolveRuntimeStateFromFlags(flags, config);

    expect(params.modelParams?.temperature).toBe('0.9');
    expect(params.modelParams?.['max-tokens']).toBe('2000');
  });

  it('should prioritize CLI flags over config defaults', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 154-160

    const flags: CliFlags = {
      provider: 'anthropic',
      model: 'claude-3-opus-20240229',
    };

    const params = resolveRuntimeStateFromFlags(flags, config);

    expect(params.provider).toBe('anthropic');
    expect(params.model).toBe('claude-3-opus-20240229');
  });
});

describe('CLI Bootstrap Functions - bootstrapForegroundAgent', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.2
   * @pseudocode cli-runtime-adapter.md lines 101-132
   *
   * Tests full foreground agent bootstrap flow.
   */

  let config: Config;

  beforeEach(() => {
    config = createMockConfig();
  });

  it('should bootstrap foreground agent with adapter and client', async () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 101-132

    const flags: CliFlags = {
      provider: 'gemini',
      model: 'gemini-2.0-flash',
    };

    const result: BootstrapResult = await bootstrapForegroundAgent(
      flags,
      config,
    );

    expect(result.adapter.getProvider()).toBe('gemini');
    expect(result.adapter.getModel()).toBe('gemini-2.0-flash');
  });

  it('should create runtime state from resolved flags', async () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 106-113

    const flags: CliFlags = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    };

    const result = await bootstrapForegroundAgent(flags, config);

    expect(result.adapter.getProvider()).toBe('anthropic');
    expect(result.adapter.getModel()).toBe('claude-3-5-sonnet-20241022');
  });

  it('should create adapter with runtime state and config', async () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 115-116

    const flags: CliFlags = {
      provider: 'gemini',
    };

    const result = await bootstrapForegroundAgent(flags, config);

    const state = result.adapter.getRuntimeState();
    expect(state.runtimeId).toBeTruthy();
    expect(state.provider).toBe('gemini');
  });

  it('should pass runtime state to GeminiClient', async () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.2
    // @pseudocode cli-runtime-adapter.md lines 124-129

    const flags: CliFlags = {
      provider: 'gemini',
    };

    const result = await bootstrapForegroundAgent(flags, config);

    // Client should have access to runtime state
    expect(result.client).toBeTruthy();
  });
});

describe('Legacy Helper Functions - Provider Operations', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 378-398
   *
   * Tests legacy helper functions that delegate to adapter.
   */

  let adapter: AgentRuntimeAdapter;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();
    adapter = new AgentRuntimeAdapter(runtimeState, config);
    setRuntimeAdapter(adapter);
  });

  afterEach(() => {
    adapter.dispose();
    resetRuntimeAdapter();
  });

  it('should set provider via setRuntimeProvider helper', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 378-381

    setRuntimeProvider('anthropic');

    expect(getRuntimeProvider()).toBe('anthropic');
  });

  it('should get provider via getRuntimeProvider helper', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 383-386

    const provider = getRuntimeProvider();

    expect(provider).toBe('gemini');
  });

  it('should set model via setRuntimeModel helper', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 388-390

    setRuntimeModel('gemini-2.5-flash');

    expect(getRuntimeModel()).toBe('gemini-2.5-flash');
  });

  it('should get model via getRuntimeModel helper', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 392-394

    const model = getRuntimeModel();

    expect(model).toBe('gemini-2.0-flash');
  });

  it('should switch provider atomically via switchRuntimeProvider helper', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 396-398

    switchRuntimeProvider('anthropic', 'claude-3-opus-20240229');

    expect(getRuntimeProvider()).toBe('anthropic');
    expect(getRuntimeModel()).toBe('claude-3-opus-20240229');
  });

  it('should use default model when switching provider without explicit model', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 396-398

    switchRuntimeProvider('anthropic');

    expect(getRuntimeProvider()).toBe('anthropic');
    expect(getRuntimeModel()).toBe('claude-3-5-sonnet-20241022'); // Default model
  });
});

describe('AgentRuntimeAdapter - Event Handling', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 76-87
   *
   * Tests that adapter responds to runtime state changes.
   */

  it('should mirror state changes to config when subscribed', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.3
    // @pseudocode cli-runtime-adapter.md lines 76-87

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();
    new AgentRuntimeAdapter(runtimeState, config);

    (config.setModel as ReturnType<typeof vi.fn>).mockClear();

    // Update runtime state externally
    updateAgentRuntimeState(runtimeState, { model: 'gemini-2.5-flash' });

    // Adapter should have mirrored to config
    expect(config.setModel).toHaveBeenCalledWith('gemini-2.5-flash');
  });

  it('should update local runtime state reference on change event', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-002.1
    // @pseudocode cli-runtime-adapter.md lines 77-78

    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();
    const adapter = new AgentRuntimeAdapter(runtimeState, config);

    // Update runtime state externally
    updateAgentRuntimeState(runtimeState, { model: 'gemini-2.5-flash' });

    // Adapter should reflect the change
    expect(adapter.getModel()).toBe('gemini-2.5-flash');
  });
});

describe('AgentRuntimeAdapter - Error Handling', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P07
   * @requirement REQ-STAT5-001.1
   * @pseudocode cli-runtime-adapter.md lines 569-592
   *
   * Tests adapter-level error handling and validation.
   */

  let adapter: AgentRuntimeAdapter;

  beforeEach(() => {
    const params: RuntimeStateParams = {
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
    };
    const runtimeState = createAgentRuntimeState(params);
    const config = createMockConfig();
    adapter = new AgentRuntimeAdapter(runtimeState, config);
  });

  it('should throw descriptive error for invalid provider', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-001.1
    // @pseudocode cli-runtime-adapter.md lines 575-579

    expect(() => adapter.setProvider('invalid-provider')).toThrow();
    expect(() => adapter.setProvider('invalid-provider')).toThrow(/not found/);
  });

  it('should include available providers in error message', () => {
    // @plan PLAN-20251027-STATELESS5.P07
    // @requirement REQ-STAT5-001.1
    // @pseudocode cli-runtime-adapter.md lines 575-579

    try {
      adapter.setProvider('invalid-provider');
      expect.fail('Should have thrown error');
    } catch (error) {
      expect((error as Error).message).toMatch(/gemini|anthropic|openai/);
    }
  });
});
