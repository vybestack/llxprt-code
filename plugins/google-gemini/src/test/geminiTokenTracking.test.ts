/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gemini-side counterpart of the host integration suite
 * `integration-tests/token-tracking.test.ts`. Since #2628 moved Gemini into
 * this runtime plugin, host lanes cannot import plugin source, so the
 * Gemini-specific token-tracking coverage lives here and imports the host
 * packages as peers (the blessed plugin -> host direction).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '@vybestack/llxprt-code-providers/ProviderManager.js';
import { LoggingProviderWrapper } from '@vybestack/llxprt-code-providers/LoggingProviderWrapper.js';
import { OpenAIProvider } from '@vybestack/llxprt-code-providers/openai/OpenAIProvider.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { makeFakeConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { GeminiProvider } from '../gemini/GeminiProvider.js';

describe('gemini token tracking', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    const runtime = createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'gemini-token-tracking',
    });
    // Config first so registerProvider applies the production wrapping,
    // matching the setup used by ProviderManager.gemini-switch.test.ts.
    manager = new ProviderManager(runtime);
    manager.setConfig(makeFakeConfig());
  });

  describe('ProviderManager session token accumulation', () => {
    it('preserves accurate totals when the active provider switches mid-session', () => {
      const pm = manager;
      pm.registerProvider(new OpenAIProvider('test-key'));
      pm.registerProvider(new GeminiProvider());
      pm.resetSessionTokenUsage();

      pm.setActiveProvider('openai');
      pm.accumulateSessionTokens('openai', {
        input: 100,
        output: 75,
        cache: 0,
        tool: 0,
        thought: 0,
      });

      pm.setActiveProvider('gemini');
      pm.accumulateSessionTokens('gemini', {
        input: 175,
        output: 100,
        cache: 25,
        tool: 15,
        thought: 5,
      });

      pm.setActiveProvider('openai');
      pm.accumulateSessionTokens('openai', {
        input: 90,
        output: 60,
        cache: 10,
        tool: 5,
        thought: 0,
      });

      const usage = pm.getSessionTokenUsage();
      expect(usage.input).toBe(365);
      expect(usage.output).toBe(235);
      expect(usage.cache).toBe(35);
      expect(usage.tool).toBe(20);
      expect(usage.thought).toBe(5);
      expect(usage.total).toBe(625); // 365 + 235 + 20 + 5
    });
  });

  describe('per-provider token extraction via LoggingProviderWrapper', () => {
    it('extracts cached content tokens from a Gemini usage object', () => {
      const wrapper = new LoggingProviderWrapper(new GeminiProvider(), null);
      const counts = wrapper.extractTokenCountsFromResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello, I can help you with that!' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usage: {
          prompt_tokens: 180,
          completion_tokens: 95,
          total_tokens: 275,
          cached_content_tokens: 40,
        },
      });

      expect(counts.input_token_count).toBe(180);
      expect(counts.output_token_count).toBe(95);
      expect(counts.cached_content_token_count).toBe(40);
      expect(counts.tool_token_count).toBe(0);
      expect(counts.thoughts_token_count).toBe(0);
    });

    it('yields zeros for missing or incomplete usage data for the Gemini provider', () => {
      const wrapper = new LoggingProviderWrapper(new GeminiProvider(), null);
      const incomplete = [{}, { usage: {} }, { headers: {} }, null, undefined];

      for (const response of incomplete) {
        const counts = wrapper.extractTokenCountsFromResponse(response);
        expect(counts.input_token_count).toBe(0);
        expect(counts.output_token_count).toBe(0);
        expect(counts.cached_content_token_count).toBe(0);
        expect(counts.tool_token_count).toBe(0);
        expect(counts.thoughts_token_count).toBe(0);
      }
    });
  });
});
