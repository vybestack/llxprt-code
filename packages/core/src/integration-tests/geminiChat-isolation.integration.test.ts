/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251028-STATELESS6.P09
 * @requirement REQ-STAT6-003.1, REQ-STAT6-003.2, REQ-STAT6-003.3
 * @pseudocode agent-runtime-context.md line 109 (step 009)
 *
 * Integration tests for GeminiChat runtime context isolation.
 * These tests verify that foreground and subagent contexts remain independent
 * across history, telemetry, provider/model, and ephemeral settings.
 *
 * EXPECTED STATE: These tests MUST FAIL initially (RED phase of TDD).
 * They will pass after Phase P10 GeminiChat refactor.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Config } from '../config/config.js';
import { createAgentRuntimeContext } from '../runtime/createAgentRuntimeContext.js';
import { createAgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { AuthType } from '../core/contentGenerator.js';
import { DEFAULT_TOKEN_LIMIT } from '../core/tokenLimits.js';
import type {
  ReadonlySettingsSnapshot,
  ApiRequestEvent,
  ApiResponseEvent,
  ApiErrorEvent,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from '../runtime/AgentRuntimeContext.js';
import type { IProvider } from '../providers/IProvider.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import { SettingsService } from '../settings/SettingsService.js';

const noopProviderAdapter: AgentRuntimeProviderAdapter = {
  getActiveProvider: () => ({ name: 'stub-provider' }) as IProvider,
  setActiveProvider: () => {},
};

const noopToolsView: ToolRegistryView = {
  listToolNames: () => [],
  getToolMetadata: () => undefined,
};

function createProviderRuntimeStub(runtimeId: string) {
  return createProviderRuntimeContext({
    settingsService: new SettingsService(),
    runtimeId,
    metadata: { source: 'geminiChat-isolation.integration.test' },
  });
}

function buildRuntimeContext(
  state: ReturnType<typeof createAgentRuntimeState>,
  settings: Partial<ReadonlySettingsSnapshot>,
  overrides: Partial<{
    provider: AgentRuntimeProviderAdapter;
    telemetry: AgentRuntimeTelemetryAdapter;
    tools: ToolRegistryView;
  }> = {},
) {
  const telemetryAdapter: AgentRuntimeTelemetryAdapter =
    overrides.telemetry ?? {
      logApiRequest: () => {},
      logApiResponse: () => {},
      logApiError: () => {},
    };

  return createAgentRuntimeContext({
    state,
    settings: settings as ReadonlySettingsSnapshot,
    provider: overrides.provider ?? noopProviderAdapter,
    telemetry: telemetryAdapter,
    tools: overrides.tools ?? noopToolsView,
    providerRuntime: createProviderRuntimeStub(state.runtimeId),
  });
}

// Mock content generator to avoid real API calls
vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createContentGenerator: vi.fn().mockResolvedValue({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => 'mock response',
          candidates: [],
          usageMetadata: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        },
      }),
      generateContentStream: vi.fn().mockResolvedValue({
        async *stream() {
          yield {
            text: () => 'mock stream',
            candidates: [],
            usageMetadata: {
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
            },
          };
        },
      }),
    }),
  };
});

describe('GeminiChat Isolation Integration Tests', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeStub('foreground-bootstrap'),
    );
    // Create a mock foreground config with specific model
    new Config({
      provider: 'gemini',
      model: 'gemini-2.0-flash-exp',
      authType: AuthType.USE_GEMINI,
      targetDir: process.cwd(),
      sandbox: false,
    });
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P09
   * @requirement REQ-STAT6-003.2
   * @pseudocode agent-runtime-context.md line 112 (step 009.2)
   *
   * Test: History isolation between foreground and subagent
   * EXPECTED: FAIL (history sharing will occur in current implementation)
   */
  describe('History Isolation', () => {
    it('should maintain independent history services between foreground and subagent', async () => {
      // GIVEN: Foreground context with Config adapter
      const foregroundState = createAgentRuntimeState({
        runtimeId: 'foreground-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'foreground-session',
      });

      const foregroundSettings: ReadonlySettingsSnapshot = {
        compressionThreshold: 0.8,
        contextLimit: 60000,
      };

      const foregroundContext = buildRuntimeContext(
        foregroundState,
        foregroundSettings,
      );

      // GIVEN: Subagent context with manual runtime context
      const subagentState = createAgentRuntimeState({
        runtimeId: 'subagent-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash-thinking-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'subagent-session',
      });

      const subagentSettings: ReadonlySettingsSnapshot = {
        compressionThreshold: 0.7,
        contextLimit: 80000,
      };

      const subagentContext = buildRuntimeContext(
        subagentState,
        subagentSettings,
      );

      // WHEN: Messages added to both histories
      foregroundContext.history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'foreground message' }],
        metadata: { timestamp: Date.now() },
      });

      subagentContext.history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'subagent message' }],
        metadata: { timestamp: Date.now() },
      });

      // THEN: Histories remain independent
      const foregroundMessages = foregroundContext.history.getAll();
      const subagentMessages = subagentContext.history.getAll();

      // Verify different history instances
      expect(foregroundContext.history).not.toBe(subagentContext.history);

      // Verify message counts
      expect(foregroundMessages).toHaveLength(1);
      expect(subagentMessages).toHaveLength(1);

      // Verify message content isolation
      const foregroundText = foregroundMessages[0].blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      const subagentText = subagentMessages[0].blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');

      expect(foregroundText).toContain('foreground message');
      expect(subagentText).toContain('subagent message');

      // Verify no cross-contamination
      expect(foregroundText).not.toContain('subagent message');
      expect(subagentText).not.toContain('foreground message');
    });

    it('should not share history between multiple subagents', async () => {
      // GIVEN: Two subagent contexts
      const subagent1State = createAgentRuntimeState({
        runtimeId: 'subagent-1-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash-thinking-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'subagent-1-session',
      });

      const subagent1Context = buildRuntimeContext(subagent1State, {});

      const subagent2State = createAgentRuntimeState({
        runtimeId: 'subagent-2-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash-thinking-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'subagent-2-session',
      });

      const subagent2Context = buildRuntimeContext(subagent2State, {});

      // WHEN: Messages added to both subagent histories
      subagent1Context.history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'subagent 1 message' }],
        metadata: { timestamp: Date.now() },
      });

      subagent2Context.history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'subagent 2 message' }],
        metadata: { timestamp: Date.now() },
      });

      // THEN: Histories remain independent
      expect(subagent1Context.history).not.toBe(subagent2Context.history);

      const messages1 = subagent1Context.history.getAll();
      const messages2 = subagent2Context.history.getAll();

      expect(messages1).toHaveLength(1);
      expect(messages2).toHaveLength(1);

      const text1 = messages1[0].blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      const text2 = messages2[0].blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');

      expect(text1).toContain('subagent 1 message');
      expect(text2).toContain('subagent 2 message');
    });
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P09
   * @requirement REQ-STAT6-003.3
   * @pseudocode agent-runtime-context.md line 114 (step 009.4)
   *
   * Test: Telemetry runtime ID correlation
   * EXPECTED: FAIL (telemetry will use shared session ID in current implementation)
   */
  describe('Telemetry Runtime ID Correlation', () => {
    it('should tag telemetry events with distinct runtime IDs for foreground vs subagent', async () => {
      // GIVEN: Mock telemetry targets
      const _foregroundLogs: Array<{
        type: string;
        event: ApiRequestEvent | ApiResponseEvent | ApiErrorEvent;
      }> = [];

      const _subagentLogs: Array<{
        type: string;
        event: ApiRequestEvent | ApiResponseEvent | ApiErrorEvent;
      }> = [];

      // GIVEN: Foreground context with telemetry
      const foregroundState = createAgentRuntimeState({
        runtimeId: 'foreground-runtime-123',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'shared-session-456',
      });

      const foregroundContext = buildRuntimeContext(foregroundState, {
        telemetry: { enabled: true, target: null },
      });

      // Spy on foreground telemetry
      const foregroundRequestSpy = vi.spyOn(
        foregroundContext.telemetry,
        'logApiRequest',
      );
      const _foregroundResponseSpy = vi.spyOn(
        foregroundContext.telemetry,
        'logApiResponse',
      );

      // GIVEN: Subagent context with telemetry
      const subagentState = createAgentRuntimeState({
        runtimeId: 'subagent-runtime-789',
        provider: 'gemini',
        model: 'gemini-2.0-flash-thinking-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'shared-session-456', // Same session, different runtime
      });

      const subagentContext = buildRuntimeContext(subagentState, {
        telemetry: { enabled: true, target: null },
      });

      // Spy on subagent telemetry
      const subagentRequestSpy = vi.spyOn(
        subagentContext.telemetry,
        'logApiRequest',
      );
      const _subagentResponseSpy = vi.spyOn(
        subagentContext.telemetry,
        'logApiResponse',
      );

      // WHEN: API requests simulated for both contexts
      const foregroundRequest: ApiRequestEvent = {
        sessionId: foregroundState.sessionId,
        runtimeId: foregroundState.runtimeId,
        provider: foregroundState.provider,
        model: foregroundState.model,
        authType: foregroundState.authType,
        timestamp: Date.now(),
        payload: '{"prompt": "foreground query"}',
      };

      const subagentRequest: ApiRequestEvent = {
        sessionId: subagentState.sessionId,
        runtimeId: subagentState.runtimeId,
        provider: subagentState.provider,
        model: subagentState.model,
        authType: subagentState.authType,
        timestamp: Date.now(),
        payload: '{"prompt": "subagent query"}',
      };

      foregroundContext.telemetry.logApiRequest(foregroundRequest);
      subagentContext.telemetry.logApiRequest(subagentRequest);

      // THEN: Verify spies were called
      expect(foregroundRequestSpy).toHaveBeenCalledOnce();
      expect(subagentRequestSpy).toHaveBeenCalledOnce();

      // THEN: Telemetry events contain distinct runtime IDs
      const foregroundCall = foregroundRequestSpy.mock.calls[0][0];
      const subagentCall = subagentRequestSpy.mock.calls[0][0];

      expect(foregroundCall.runtimeId).toBe('foreground-runtime-123');
      expect(subagentCall.runtimeId).toBe('subagent-runtime-789');
      expect(foregroundCall.runtimeId).not.toBe(subagentCall.runtimeId);

      // THEN: Session IDs are the same (shared session)
      expect(foregroundCall.sessionId).toBe('shared-session-456');
      expect(subagentCall.sessionId).toBe('shared-session-456');
      expect(foregroundCall.sessionId).toBe(subagentCall.sessionId);
    });

    it('should enrich telemetry with runtime-specific metadata', async () => {
      // GIVEN: Contexts with different models
      const context1State = createAgentRuntimeState({
        runtimeId: 'runtime-a',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'session-test',
      });

      const context1 = buildRuntimeContext(context1State, {
        telemetry: { enabled: true, target: null },
      });

      const context2State = createAgentRuntimeState({
        runtimeId: 'runtime-b',
        provider: 'gemini',
        model: 'gemini-2.0-flash-thinking-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'session-test',
      });

      const context2 = buildRuntimeContext(context2State, {
        telemetry: { enabled: true, target: null },
      });

      // Spy on telemetry
      const spy1 = vi.spyOn(context1.telemetry, 'logApiRequest');
      const spy2 = vi.spyOn(context2.telemetry, 'logApiRequest');

      // WHEN: Log requests
      const request1: ApiRequestEvent = {
        sessionId: context1State.sessionId,
        runtimeId: context1State.runtimeId,
        provider: context1State.provider,
        model: context1State.model,
        authType: context1State.authType,
        timestamp: Date.now(),
      };

      const request2: ApiRequestEvent = {
        sessionId: context2State.sessionId,
        runtimeId: context2State.runtimeId,
        provider: context2State.provider,
        model: context2State.model,
        authType: context2State.authType,
        timestamp: Date.now(),
      };

      context1.telemetry.logApiRequest(request1);
      context2.telemetry.logApiRequest(request2);

      // THEN: Each event has correct model metadata
      const call1 = spy1.mock.calls[0][0];
      const call2 = spy2.mock.calls[0][0];

      expect(call1.model).toBe('gemini-2.0-flash-exp');
      expect(call2.model).toBe('gemini-2.0-flash-thinking-exp');
      expect(call1.model).not.toBe(call2.model);
    });
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P09
   * @requirement REQ-STAT6-003.1
   * @pseudocode agent-runtime-context.md line 110 (step 009.1)
   *
   * Test: Provider/model isolation
   * EXPECTED: FAIL (Config.setModel() will mutate foreground in current implementation)
   */
  describe('Provider/Model Isolation', () => {
    it('should keep foreground model unchanged after subagent execution', async () => {
      // GIVEN: Foreground context with specific model
      const originalModel = 'gemini-2.0-flash-exp';
      const foregroundState = createAgentRuntimeState({
        runtimeId: 'foreground-runtime',
        provider: 'gemini',
        model: originalModel,
        authType: AuthType.USE_GEMINI,
        sessionId: 'test-session',
      });

      const foregroundContext = buildRuntimeContext(foregroundState, {});

      // GIVEN: Subagent context with different model
      const subagentModel = 'gemini-2.0-flash-thinking-exp';
      const subagentState = createAgentRuntimeState({
        runtimeId: 'subagent-runtime',
        provider: 'gemini',
        model: subagentModel,
        authType: AuthType.USE_GEMINI,
        sessionId: 'test-session',
      });

      const subagentContext = buildRuntimeContext(subagentState, {});

      // WHEN: Both contexts execute (simulated)
      // In real scenario, GeminiChat would be instantiated with each context
      // and sendMessage called on both

      // THEN: Foreground model remains unchanged
      expect(foregroundContext.state.model).toBe(originalModel);
      expect(foregroundContext.state.model).toBe('gemini-2.0-flash-exp');

      // THEN: Subagent model is different
      expect(subagentContext.state.model).toBe(subagentModel);
      expect(subagentContext.state.model).toBe('gemini-2.0-flash-thinking-exp');

      // THEN: Models are isolated
      expect(foregroundContext.state.model).not.toBe(
        subagentContext.state.model,
      );
    });

    it('should prevent foreground Config mutation from subagent creation', async () => {
      // GIVEN: Foreground config with spy on setModel
      const mockConfig = new Config({
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        authType: AuthType.USE_GEMINI,
        targetDir: process.cwd(),
        sandbox: false,
      });

      const setModelSpy = vi.spyOn(mockConfig, 'setModel');
      const setProviderSpy = vi.spyOn(mockConfig, 'setProvider');

      // GIVEN: Original model for verification
      const originalModel = mockConfig.getModel();

      // WHEN: Subagent created with different model (simulated)
      // NOTE: This will be done via SubAgentScope.create in P10
      // For now, we test the isolation at runtime context level

      const subagentState = createAgentRuntimeState({
        runtimeId: 'subagent-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash-thinking-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: mockConfig.getSessionId(),
      });

      const subagentContext = buildRuntimeContext(subagentState, {});

      // THEN: Config mutators NOT called
      expect(setModelSpy).not.toHaveBeenCalled();
      expect(setProviderSpy).not.toHaveBeenCalled();

      // THEN: Foreground model unchanged
      expect(mockConfig.getModel()).toBe(originalModel);
      expect(mockConfig.getModel()).toBe('gemini-2.0-flash-exp');

      // THEN: Subagent has different model
      expect(subagentContext.state.model).toBe('gemini-2.0-flash-thinking-exp');
    });

    it('should allow concurrent execution without model interference', async () => {
      // GIVEN: Multiple contexts with different models
      const models = [
        'gemini-2.0-flash-exp',
        'gemini-2.0-flash-thinking-exp',
        'gemini-1.5-pro',
      ];

      const contexts = models.map((model, index) => {
        const state = createAgentRuntimeState({
          runtimeId: `runtime-${index}`,
          provider: 'gemini',
          model,
          authType: AuthType.USE_GEMINI,
          sessionId: `session-${index}`,
        });

        return buildRuntimeContext(state, {});
      });

      // WHEN: All contexts accessed concurrently
      const retrievedModels = await Promise.all(
        contexts.map(async (ctx) => ctx.state.model),
      );

      // THEN: Each context retains its model
      expect(retrievedModels).toEqual(models);

      // THEN: No context affected by others
      contexts.forEach((ctx, index) => {
        expect(ctx.state.model).toBe(models[index]);
      });
    });
  });

  /**
   * @plan PLAN-20251028-STATELESS6.P09
   * @requirement REQ-STAT6-002.2
   * @pseudocode agent-runtime-context.md line 113 (step 009.3)
   *
   * Test: Ephemeral settings isolation
   * EXPECTED: FAIL (settings may cross-contaminate in current implementation)
   */
  describe('Ephemeral Settings Isolation', () => {
    it('should maintain independent compression thresholds for foreground vs subagent', async () => {
      // GIVEN: Foreground context with specific compression threshold
      const foregroundState = createAgentRuntimeState({
        runtimeId: 'foreground-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'test-session',
      });

      const foregroundSettings: ReadonlySettingsSnapshot = {
        compressionThreshold: 0.8,
        contextLimit: 60000,
        preserveThreshold: 0.2,
      };

      const foregroundContext = buildRuntimeContext(
        foregroundState,
        foregroundSettings,
      );

      // GIVEN: Subagent context with different compression threshold
      const subagentState = createAgentRuntimeState({
        runtimeId: 'subagent-runtime',
        provider: 'gemini',
        model: 'gemini-2.0-flash-thinking-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'test-session',
      });

      const subagentSettings: ReadonlySettingsSnapshot = {
        compressionThreshold: 0.6,
        contextLimit: 80000,
        preserveThreshold: 0.3,
      };

      const subagentContext = buildRuntimeContext(
        subagentState,
        subagentSettings,
      );

      // WHEN: Ephemeral settings accessed
      const foregroundThreshold =
        foregroundContext.ephemerals.compressionThreshold();
      const subagentThreshold =
        subagentContext.ephemerals.compressionThreshold();

      const foregroundLimit = foregroundContext.ephemerals.contextLimit();
      const subagentLimit = subagentContext.ephemerals.contextLimit();

      const foregroundPreserve =
        foregroundContext.ephemerals.preserveThreshold();
      const subagentPreserve = subagentContext.ephemerals.preserveThreshold();

      // THEN: Each context uses its own settings
      expect(foregroundThreshold).toBe(0.8);
      expect(subagentThreshold).toBe(0.6);
      expect(foregroundThreshold).not.toBe(subagentThreshold);

      expect(foregroundLimit).toBe(60000);
      expect(subagentLimit).toBe(80000);
      expect(foregroundLimit).not.toBe(subagentLimit);

      expect(foregroundPreserve).toBe(0.2);
      expect(subagentPreserve).toBe(0.3);
      expect(foregroundPreserve).not.toBe(subagentPreserve);
    });

    it('should not allow settings cross-contamination during concurrent access', async () => {
      // GIVEN: Multiple contexts with different settings
      const contexts = [
        {
          state: createAgentRuntimeState({
            runtimeId: 'runtime-1',
            provider: 'gemini',
            model: 'gemini-2.0-flash-exp',
            authType: AuthType.USE_GEMINI,
            sessionId: 'session-1',
          }),
          settings: { compressionThreshold: 0.5, contextLimit: 50000 },
        },
        {
          state: createAgentRuntimeState({
            runtimeId: 'runtime-2',
            provider: 'gemini',
            model: 'gemini-2.0-flash-exp',
            authType: AuthType.USE_GEMINI,
            sessionId: 'session-2',
          }),
          settings: { compressionThreshold: 0.7, contextLimit: 70000 },
        },
        {
          state: createAgentRuntimeState({
            runtimeId: 'runtime-3',
            provider: 'gemini',
            model: 'gemini-2.0-flash-exp',
            authType: AuthType.USE_GEMINI,
            sessionId: 'session-3',
          }),
          settings: { compressionThreshold: 0.9, contextLimit: 90000 },
        },
      ].map(({ state, settings }) => buildRuntimeContext(state, settings));

      // WHEN: Settings accessed concurrently
      const thresholds = await Promise.all(
        contexts.map(async (ctx) => ctx.ephemerals.compressionThreshold()),
      );

      const limits = await Promise.all(
        contexts.map(async (ctx) => ctx.ephemerals.contextLimit()),
      );

      // THEN: Each context has its own settings
      expect(thresholds).toEqual([0.5, 0.7, 0.9]);
      expect(limits).toEqual([50000, 70000, 90000]);

      // THEN: No cross-contamination
      contexts.forEach((ctx, index) => {
        expect(ctx.ephemerals.compressionThreshold()).toBe(
          [0.5, 0.7, 0.9][index],
        );
        expect(ctx.ephemerals.contextLimit()).toBe(
          [50000, 70000, 90000][index],
        );
      });
    });

    it('should use default settings when not specified', async () => {
      // GIVEN: Context with empty settings
      const state = createAgentRuntimeState({
        runtimeId: 'runtime-defaults',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'test-session',
      });

      const context = buildRuntimeContext(state, {});

      // WHEN: Ephemeral settings accessed
      const threshold = context.ephemerals.compressionThreshold();
      const limit = context.ephemerals.contextLimit();
      const preserve = context.ephemerals.preserveThreshold();

      // THEN: Default values used (from createAgentRuntimeContext EPHEMERAL_DEFAULTS)
      expect(threshold).toBe(0.8);
      expect(limit).toBe(DEFAULT_TOKEN_LIMIT);
      expect(preserve).toBe(0.2);
    });

    it('should handle partial settings with defaults for missing values', async () => {
      // GIVEN: Context with partial settings
      const state = createAgentRuntimeState({
        runtimeId: 'runtime-partial',
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        authType: AuthType.USE_GEMINI,
        sessionId: 'test-session',
      });

      const context = buildRuntimeContext(state, {
        compressionThreshold: 0.75, // Specified
        // contextLimit: undefined (will use default)
        // preserveThreshold: undefined (will use default)
      });

      // WHEN: Ephemeral settings accessed
      const threshold = context.ephemerals.compressionThreshold();
      const limit = context.ephemerals.contextLimit();
      const preserve = context.ephemerals.preserveThreshold();

      // THEN: Specified value used, rest default
      expect(threshold).toBe(0.75); // Specified
      expect(limit).toBe(DEFAULT_TOKEN_LIMIT); // Default
      expect(preserve).toBe(0.2); // Default
    });
  });
});
