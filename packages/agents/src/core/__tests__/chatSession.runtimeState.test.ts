import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P09
 * @requirement REQ-STAT5-004.1
 * @pseudocode gemini-runtime.md lines 323-382
 *
 * TDD tests for ChatSession runtime state integration (RED phase).
 * These tests verify that ChatSession receives runtime data via injected context
 * and uses runtime metadata for provider calls, not Config.
 *
 * Expected outcome: These tests FAIL against current implementation because
 * ChatSession still uses Config directly.
 */

import { afterEach, describe, it, expect, vi } from 'bun:test';
import { ChatSession } from '../chatSession.js';
import {
  Config,
  type ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

/**
 * Test helper: Create minimal Config for testing
 */
const roots: Array<{ config: Config; settingsOwner: SessionSettingsOwner }> =
  [];

function createTestConfig(options: Partial<ConfigParameters> = {}) {
  const config = new Config({
    sessionId: 'test-session-id',
    targetDir: '/tmp/test-dir',
    cwd: '/tmp/test-dir',
    debugMode: false,
    model: 'declared-model',
    ...options,
  });
  const settingsService = new SettingsService();
  for (const [key, value] of Object.entries({
    'compression-threshold': 0.8,
    'context-limit': 60000,
    'compression-preserve-threshold': 0.2,
  }))
    settingsService.set(key, value);
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  const root = { config, settingsService, settingsOwner };
  roots.push(root);
  return root;
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

/**
 * Test helper: Create test AgentRuntimeContext
 * @plan PLAN-20251028-STATELESS6.P10
 */
function createTestRuntimeContext(
  runtimeState: AgentRuntimeState,
  root: ReturnType<typeof createTestConfig>,
  historyService?: HistoryService,
): AgentRuntimeContext {
  const providerRuntime = createProviderRuntimeContext({
    settingsService: root.settingsService,
    config: root.config,
    runtimeId: runtimeState.runtimeId,
    metadata: { source: 'chatSession.runtimeState.test' },
  });
  return createAgentRuntimeContext({
    state: runtimeState,
    settings: root.settingsOwner.readRuntimePolicy(),
    provider: createProviderAdapterFromManager(undefined),
    telemetry: createTelemetryAdapter(
      root.config,
      root.settingsOwner.telemetry,
    ),
    tools: createToolRegistryViewFromRegistry(undefined),
    history: historyService,
    providerRuntime,
    prepareProviderInvocation: (name, parameters, signal) =>
      root.settingsOwner.prepareProviderInvocation(
        runtimeState.runtimeId,
        name,
        parameters,
        signal,
      ),
  });
}

/**
 * Test helper: Create mock ContentGenerator
 */
function createMockContentGenerator(): ContentGenerator {
  return {
    generateContent: vi.fn().mockResolvedValue({
      response: {
        text: () => 'Test response',
        candidates: [],
      },
    }),
    streamGenerateContent: vi.fn(),
    embedContent: vi.fn(),
  } as unknown as ContentGenerator;
}

/**
 * Test helper: Create mock HistoryService
 */
function createMockHistoryService(): HistoryService {
  return {
    getHistory: vi.fn().mockResolvedValue([]),
    addToHistory: vi.fn(),
    add: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    getCurated: vi.fn().mockReturnValue([]),
    getCuratedForProvider: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
    generateTurnKey: vi.fn().mockReturnValue('test-turn-key'),
    getIdGeneratorCallback: vi.fn().mockReturnValue(() => 'test-id'),
    findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
    waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
    syncTotalTokens: vi.fn(),
  } as unknown as HistoryService;
}

describe('ChatSession - Runtime State Integration', () => {
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await root.settingsOwner.dispose();
      await root.config.dispose();
    }
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-004.1
   * @pseudocode gemini-runtime.md lines 323-382
   *
   * Test: ChatSession constructor accepts runtime state
   */
  describe('Constructor Integration', () => {
    it('should accept AgentRuntimeState as first parameter', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1
      // @pseudocode gemini-runtime.md lines 204-220

      const runtimeState = createTestRuntimeState();
      const root = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      // Phase 6: Use AgentRuntimeContext constructor
      expect(() => {
        new ChatSession(
          view,
          contentGenerator,
          { systemInstruction: 'test' },
          [],
        );
      }).not.toThrow();
    });

    it('should accept provider context parameter', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1
      // @pseudocode gemini-runtime.md lines 197-217

      const runtimeState = createTestRuntimeState();
      const root = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);
      // Phase 7: Constructor relies solely on AgentRuntimeContext
      expect(() => {
        new ChatSession(
          view,
          contentGenerator,
          { systemInstruction: 'test' },
          [],
        );
      }).not.toThrow();
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-004.1
   *
   * Test: ChatSession uses runtime state for provider calls
   */
  describe('Runtime State Usage in Provider Calls', () => {
    it('should use provider from runtime state not Config', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        provider: 'gemini', // Runtime state says gemini
      });
      const root = createTestConfig({ provider: 'openai' });

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      const chat = new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // When sending a message, should use 'gemini' from runtime state
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState'].provider).toBe('gemini');
    });

    it('should use model from runtime state not Config', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        model: 'gemini-2.0-flash', // Runtime state model
      });
      const root = createTestConfig({ model: 'gemini-1.5-pro' });

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      const chat = new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // Should use model from runtime state
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState'].model).toBe('gemini-2.0-flash');
    });

    it('should use runtime state over Config defaults', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        model: 'runtime-model',
      });
      const root = createTestConfig();

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      const chat = new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // Should use values from runtime state
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState'].model).toBe('runtime-model');
    });

    it('should use baseUrl from runtime state not Config', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        baseUrl: 'https://runtime.api.example.com', // Runtime state base URL
      });
      const root = createTestConfig();
      // Config has different base URL (via constructor defaults)

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      const chat = new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // Should use baseUrl from runtime state
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState'].baseUrl).toBe(
        'https://runtime.api.example.com',
      );
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-004.1
   * @pseudocode gemini-runtime.md lines 189-196
   *
   * Test: HistoryService injection remains explicit
   */
  describe('HistoryService Injection', () => {
    it('should accept and use injected HistoryService', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1
      // @pseudocode gemini-runtime.md lines 189-196

      const runtimeState = createTestRuntimeState();
      const root = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      const chat = new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // Chat should use the injected history service
      expect(chat['historyService']).toBe(historyService);
    });

    it('should not create its own HistoryService when one is injected', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState();
      const root = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      const chat = new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // Should not create a second history service
      // This tests that we properly reuse the injected instance
      expect(chat['historyService']).toBe(historyService);
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-004.1
   *
   * Test: Runtime context data flows correctly
   */
  describe('Provider Runtime Context', () => {
    it('should receive runtime context with state + settings', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1
      // @pseudocode gemini-runtime.md lines 197-217

      const runtimeState = createTestRuntimeState();
      const root = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);
      const chat = new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );
      expect(chat).toBeInstanceOf(ChatSession);
    });

    it('should use provider context for metadata, not Config', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
      });
      const root = createTestConfig({ provider: 'openai', model: 'gpt-4' });

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);
      const chat = new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // Should use runtime state from provided AgentRuntimeContext, not Config
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState'].provider).toBe('gemini');
      expect(chat['runtimeState'].model).toBe('gemini-2.0-flash');
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-004.1
   *
   * Test: Config only used for ephemeral settings passthrough
   */
  describe('Config Usage Restrictions', () => {
    it('should not read provider from Config when runtime state provided', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState();
      const root = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      const getProviderSpy = vi.spyOn(root.config, 'getProvider');

      new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // ChatSession should NOT call getProvider when runtime state is provided
      // Note: getModel() may still be called as a fallback in line 425 of chatSession.ts
      // but the result won't be used if runtimeState.model is present
      expect(getProviderSpy).not.toHaveBeenCalled();
    });

    it('keeps session parameters outside immutable Config construction data', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1
      // @pseudocode gemini-runtime.md lines 166-174

      const runtimeState = createTestRuntimeState();
      const root = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const view = createTestRuntimeContext(runtimeState, root, historyService);

      root.settingsOwner.writeUserParameter('temperature', 0.4);

      new ChatSession(
        view,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
      );

      // ChatSession CAN call these Config methods (ephemeral settings)
      // This tests that we maintain backward compatibility for non-migrated settings
      // These calls are OK in Phase 5
      expect(root.config.getInitialSettings()).not.toHaveProperty(
        'temperature',
      );
      expect(root.settingsOwner.readNamedParameter('temperature')).toBe(0.4);
    });
  });
});
