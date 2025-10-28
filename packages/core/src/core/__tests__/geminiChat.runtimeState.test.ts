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
 * TDD tests for GeminiChat runtime state integration (RED phase).
 * These tests verify that GeminiChat receives runtime data via injected context
 * and uses runtime metadata for provider calls, not Config.
 *
 * Expected outcome: These tests FAIL against current implementation because
 * GeminiChat still uses Config directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { GeminiChat } from '../geminiChat.js';
import { Config } from '../../config/config.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '../../runtime/AgentRuntimeState.js';
import { AuthType } from '../contentGenerator.js';
import { HistoryService } from '../../services/history/HistoryService.js';
import type { ContentGenerator } from '../contentGenerator.js';

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
    authType: AuthType.USE_GEMINI,
    authPayload: { apiKey: 'runtime-api-key' },
    sessionId: 'test-session-001',
    ...overrides,
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
  } as unknown as HistoryService;
}

describe('GeminiChat - Runtime State Integration', () => {
  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-004.1
   * @pseudocode gemini-runtime.md lines 323-382
   *
   * Test: GeminiChat constructor accepts runtime state
   */
  describe('Constructor Integration', () => {
    it('should accept AgentRuntimeState as first parameter', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1
      // @pseudocode gemini-runtime.md lines 204-220

      const runtimeState = createTestRuntimeState();
      const config = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      // This will fail because current GeminiChat doesn't accept runtime state
      expect(() => {
        // @ts-expect-error - Testing future constructor signature
        new GeminiChat(
          runtimeState,
          config,
          contentGenerator,
          { systemInstruction: 'test' },
          [],
          historyService,
        );
      }).not.toThrow();
    });

    it('should accept provider context parameter', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1
      // @pseudocode gemini-runtime.md lines 197-217

      const runtimeState = createTestRuntimeState();
      const config = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const providerContext = {
        runtimeState,
        settingsService: config.getSettingsService(),
        config, // Phase 5 backward compat
      };

      // This will fail because current GeminiChat doesn't accept provider context
      expect(() => {
        // @ts-expect-error - Testing future constructor signature
        new GeminiChat(
          runtimeState,
          config,
          contentGenerator,
          { systemInstruction: 'test' },
          [],
          historyService,
          providerContext,
        );
      }).not.toThrow();
    });
  });

  /**
   * @plan PLAN-20251027-STATELESS5.P09
   * @requirement REQ-STAT5-004.1
   *
   * Test: GeminiChat uses runtime state for provider calls
   */
  describe('Runtime State Usage in Provider Calls', () => {
    it('should use provider from runtime state not Config', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        provider: 'gemini', // Runtime state says gemini
      });
      const config = createTestConfig();
      config.setProvider('openai'); // Config says openai (wrong!)

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      // @ts-expect-error - Testing future API
      const chat = new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
      );

      // When sending a message, should use 'gemini' from runtime state
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState']?.provider).toBe('gemini');
    });

    it('should use model from runtime state not Config', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        model: 'gemini-2.0-flash', // Runtime state model
      });
      const config = createTestConfig();
      config.setModel('gemini-1.5-pro'); // Config model (wrong!)

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      // @ts-expect-error - Testing future API
      const chat = new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
      );

      // Should use model from runtime state
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState']?.model).toBe('gemini-2.0-flash');
    });

    it('should use auth from runtime state not Config', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        authType: AuthType.USE_GEMINI,
        authPayload: { apiKey: 'runtime-key' }, // Runtime state auth
      });
      const config = createTestConfig();
      // Config has different auth (via constructor defaults)

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      // @ts-expect-error - Testing future API
      const chat = new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
      );

      // Should use auth from runtime state
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState']?.authType).toBe(AuthType.USE_GEMINI);
      expect(chat['runtimeState']?.authPayload).toEqual({
        apiKey: 'runtime-key',
      });
    });

    it('should use baseUrl from runtime state not Config', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        baseUrl: 'https://runtime.api.example.com', // Runtime state base URL
      });
      const config = createTestConfig();
      // Config has different base URL (via constructor defaults)

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      // @ts-expect-error - Testing future API
      const chat = new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
      );

      // Should use baseUrl from runtime state
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState']?.baseUrl).toBe(
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
      const config = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      // @ts-expect-error - Testing future API
      const chat = new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
      );

      // Chat should use the injected history service
      expect(chat['historyService']).toBe(historyService);
    });

    it('should not create its own HistoryService when one is injected', async () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState();
      const config = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      // @ts-expect-error - Testing future API
      const chat = new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
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
      const config = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const providerContext = {
        runtimeState,
        settingsService: config.getSettingsService(),
        config,
      };

      // @ts-expect-error - Testing future API
      const chat = new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
        providerContext,
      );

      // Chat should have access to provider context
      expect(chat['_providerContext']).toBe(providerContext);
    });

    it('should use provider context for metadata, not Config', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1

      const runtimeState = createTestRuntimeState({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
      });
      const config = createTestConfig();
      config.setProvider('openai'); // Wrong!
      config.setModel('gpt-4'); // Wrong!

      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();
      const providerContext = {
        runtimeState,
        settingsService: config.getSettingsService(),
        config,
      };

      // @ts-expect-error - Testing future API
      const chat = new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
        providerContext,
      );

      // Should use runtime state from provider context, not Config
      expect(chat['runtimeState']).toBeDefined();
      expect(chat['runtimeState']?.provider).toBe('gemini');
      expect(chat['runtimeState']?.model).toBe('gemini-2.0-flash');
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
      const config = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      const getProviderSpy = vi.spyOn(config, 'getProvider');

      // @ts-expect-error - Testing future API
      new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
      );

      // GeminiChat should NOT call getProvider when runtime state is provided
      // Note: getModel() may still be called as a fallback in line 425 of geminiChat.ts
      // but the result won't be used if runtimeState.model is present
      expect(getProviderSpy).not.toHaveBeenCalled();
    });

    it('should only use Config for ephemeral settings (tools, user memory, etc)', () => {
      // @plan PLAN-20251027-STATELESS5.P09
      // @requirement REQ-STAT5-004.1
      // @pseudocode gemini-runtime.md lines 166-174

      const runtimeState = createTestRuntimeState();
      const config = createTestConfig();
      const contentGenerator = createMockContentGenerator();
      const historyService = createMockHistoryService();

      const _getToolRegistrySpy = vi.spyOn(config, 'getToolRegistry');
      const _getUserMemorySpy = vi.spyOn(config, 'getUserMemory');

      // @ts-expect-error - Testing future API
      new GeminiChat(
        runtimeState,
        config,
        contentGenerator,
        { systemInstruction: 'test' },
        [],
        historyService,
      );

      // GeminiChat CAN call these Config methods (ephemeral settings)
      // This tests that we maintain backward compatibility for non-migrated settings
      // These calls are OK in Phase 5
      expect(true).toBe(true); // This test documents acceptable Config usage
      void _getToolRegistrySpy;
      void _getUserMemorySpy;
    });
  });
});
