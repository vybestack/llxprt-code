/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { ProviderManager } from './ProviderManager.js';
import type { IProvider } from './IProvider.js';
import { ContentGeneratorRole } from './ContentGeneratorRole.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { GeminiProvider } from './gemini/GeminiProvider.js';
import { OpenAIProvider } from './openai/OpenAIProvider.js';
import { makeFakeConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

describe('ProviderManager - Gemini switching', () => {
  let manager: ProviderManager;
  let mockProvider: IProvider;

  beforeEach(() => {
    // Set up runtime context for ProviderManager
    const runtime = createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'test-runtime',
    });
    setActiveProviderRuntimeContext(runtime);
    manager = new ProviderManager(runtime);
    mockProvider = {
      name: 'openai',
      async getModels() {
        return [];
      },
      async *generateChatCompletion() {
        yield { role: ContentGeneratorRole.ASSISTANT, content: 'test' };
      },
    };
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('should start with no active provider', () => {
    expect(manager.hasActiveProvider()).toBe(false);
    expect(manager.getActiveProviderName()).toBeUndefined();
  });

  it('should allow clearing active provider to switch back to Gemini', () => {
    // Register and activate a provider
    manager.registerProvider(mockProvider);
    manager.setActiveProvider('openai');
    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('openai');

    // Clear active provider (switch back to Gemini)
    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
    expect(manager.getActiveProviderName()).toBeUndefined();
  });

  it('should correctly report hasActiveProvider state', () => {
    // Initially no active provider
    expect(manager.hasActiveProvider()).toBe(false);

    // Register provider but don't activate
    manager.registerProvider(mockProvider);
    expect(manager.hasActiveProvider()).toBe(false);

    // Activate provider
    manager.setActiveProvider('openai');
    expect(manager.hasActiveProvider()).toBe(true);

    // Clear active provider
    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
  });

  /**
   * Issue #2626 removed the serverToolsProvider auth-state exemption, so a
   * gemini -> other -> gemini roundtrip now clears gemini's provider state
   * on switch-away like every other provider. This regression test drives
   * REAL providers (real GeminiProvider/OpenAIProvider auth resolution over
   * a real SettingsService store) registered through the REAL production
   * wrapping (LoggingProviderWrapper over RetryOrchestrator — enabled by
   * giving the manager a config before registration) and asserts the full
   * contract: the registered wrapper's clearState fires on switch-away,
   * propagates to the raw provider beneath the wrappers, and auth is
   * re-resolved from the persisted store on return (rotated key observed,
   * provider reports authenticated).
   *
   * Generation with the re-resolved credentials is deliberately NOT
   * asserted here: the @google/genai import ratchet (genai-import-baseline)
   * forbids new importers of the SDK, and that coverage already lives in
   * GeminiProvider.auth.test.ts (buildGoogleGenAIOptions carries the
   * resolved key) plus the live smoke profile.
   */
  it('re-resolves gemini auth from the persisted settings store after a provider roundtrip (#2626)', async () => {
    const savedEnv = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      GOOGLE_APPLICATION_CREDENTIALS:
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    try {
      const settings = new SettingsService();
      const runtime = createProviderRuntimeContext({
        settingsService: settings,
        runtimeId: 'gemini-roundtrip',
      });
      setActiveProviderRuntimeContext(runtime);
      const roundtripManager = new ProviderManager(runtime);
      // Config first so registerProvider applies the full production
      // wrapping (RetryOrchestrator + LoggingProviderWrapper).
      roundtripManager.setConfig(makeFakeConfig());

      const gemini = new GeminiProvider();
      const openai = new OpenAIProvider();
      gemini.setRuntimeSettingsService(settings);
      openai.setRuntimeSettingsService(settings);
      settings.setProviderSetting('gemini', 'auth-key', 'gemini-key-1');
      settings.setProviderSetting('openai', 'auth-key', 'openai-key-1');
      roundtripManager.registerProvider(gemini);
      roundtripManager.registerProvider(openai);

      roundtripManager.setActiveProvider('gemini');
      expect(roundtripManager.getActiveProviderName()).toBe('gemini');
      expect(await readAuthToken(gemini)).toBe('gemini-key-1');

      // Observe the REGISTERED wrapper (what setActiveProvider actually
      // clears), not the raw provider: a counting recorder around the
      // production clearState method.
      const registeredGemini = roundtripManager.getActiveProvider() as {
        clearState?: () => void;
      };
      expect(typeof registeredGemini.clearState).toBe('function');
      const originalClearState =
        registeredGemini.clearState!.bind(registeredGemini);
      let clearStateCalls = 0;
      registeredGemini.clearState = () => {
        clearStateCalls++;
        originalClearState();
      };

      // Propagation proof: also record on the RAW provider instance beneath
      // the wrappers (LoggingProviderWrapper -> RetryOrchestrator ->
      // GeminiProvider). If RetryOrchestrator fails to forward clearState,
      // the call stops at the wrapper layer and this counter stays 0.
      const rawOriginalClearState = gemini.clearState.bind(gemini);
      let rawClearStateCalls = 0;
      gemini.clearState = () => {
        rawClearStateCalls++;
        rawOriginalClearState();
      };

      // Switch away: uniform clear for the previous provider — the wrapper
      // must have its state cleared exactly once, and the clear must
      // PROPAGATE to the raw provider's own clearState (the real auth-cache
      // invalidation). (The deleted gemini exemption would skip the call
      // entirely.)
      roundtripManager.setActiveProvider('openai');
      expect(clearStateCalls).toBe(1);
      expect(rawClearStateCalls).toBe(1);

      // Rotate the persisted key while gemini is inactive.
      settings.setProviderSetting('gemini', 'auth-key', 'gemini-key-2');

      roundtripManager.setActiveProvider('gemini');
      expect(roundtripManager.getActiveProviderName()).toBe('gemini');
      expect(await readAuthToken(gemini)).toBe('gemini-key-2');
      expect(await gemini.isAuthenticated()).toBe(true);
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

/**
 * Reads the resolved auth token through GeminiProvider's protected
 * getAuthToken (BaseProvider) — the only way to observe WHICH stored key
 * was resolved. Public isAuthenticated() cannot distinguish key rotation.
 */
function readAuthToken(provider: GeminiProvider): Promise<string> {
  const resolver = provider as unknown as {
    getAuthToken(): Promise<string>;
  };
  return resolver.getAuthToken();
}
