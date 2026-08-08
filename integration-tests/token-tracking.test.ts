/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single survivor of the six `token-tracking*` integration-test files.
 *
 * Covers the cross-package integration of:
 *   - `ProviderManager` session-token accumulation (across providers + switches)
 *   - `ProviderPerformanceTracker` (TPM formula, throttle accumulation + reset)
 *   - `LoggingProviderWrapper.extractTokenCountsFromResponse` per provider shape
 *   - `retryWithBackoff` throttle tracking (429 backoff ordering)
 *   - `formatSessionTokenUsage` output shape (property-based)
 *
 * Pure in-process: it never spawns the CLI and never contacts a model, so it
 * is exercised once per CI shard rather than once per E2E matrix leg.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import { ProviderManager } from '@vybestack/llxprt-code-providers/ProviderManager.js';
import { ProviderPerformanceTracker } from '@vybestack/llxprt-code-providers/logging/ProviderPerformanceTracker.js';
import { LoggingProviderWrapper } from '@vybestack/llxprt-code-providers/LoggingProviderWrapper.js';
import {
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
} from '@vybestack/llxprt-code-providers';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RedactionConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import { formatSessionTokenUsage } from '../packages/cli/src/ui/utils/tokenFormatters.js';
import { initializeTestProviderRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { resetSettingsService } from '@vybestack/llxprt-code-settings/settings/settingsServiceInstance.js';

/**
 * Property-based test helper — a runner-portable replacement for the `itProp`
 * import previously supplied by `@fast-check/vitest`.
 *
 * `@fast-check/vitest` builds its API on `vitest/suite`'s
 * `createTaskCollector` / `getCurrentSuite`, which are Vitest runner internals
 * with no Bun equivalent, so a property file using it could not load under Bun
 * at all. This helper registers an ordinary `it(name, …)` and drives the
 * property with plain `fast-check`, which both runners load natively.
 *
 * `fc.assert` receives the arbitraries declared at each call site, so every
 * predicate is invoked with genuinely generated values.
 */
type PropertyPredicate<Ts extends readonly unknown[]> = (
  ...args: Ts
) => void | boolean | Promise<void | boolean>;

function registerProperty<Ts extends readonly unknown[]>(
  register: (name: string, run: () => Promise<void>) => void,
  name: string,
  arbitraries: { [K in keyof Ts]: fc.Arbitrary<Ts[K]> },
  predicate: PropertyPredicate<Ts>,
): void {
  register(name, async () => {
    const check = async (...args: Ts): Promise<boolean> => {
      const outcome = await predicate(...args);
      return outcome !== false;
    };
    if (arbitraries.length === 0) {
      if (!(await check())) {
        throw new Error(`Property "${name}" returned false`);
      }
      return;
    }
    await fc.assert(fc.asyncProperty(...arbitraries, check));
  });
}

function itProp<Ts extends readonly unknown[]>(
  name: string,
  arbitraries: { [K in keyof Ts]: fc.Arbitrary<Ts[K]> },
  predicate: PropertyPredicate<Ts>,
): void {
  registerProperty(
    (testName, run) => {
      it(testName, run);
    },
    name,
    arbitraries,
    predicate,
  );
}

/** Redaction config that disables all redaction for deterministic extraction. */
function noRedactionConfig(): RedactionConfig {
  return {
    redactApiKeys: false,
    redactCredentials: false,
    redactFilePaths: false,
    redactUrls: false,
    redactEmails: false,
    redactPersonalInfo: false,
  };
}

/** Minimal config object the LoggingProviderWrapper constructor accepts. */
function loggingConfig(): {
  getRedactionConfig: () => RedactionConfig;
  getConversationLoggingEnabled: () => boolean;
} {
  return {
    getRedactionConfig: () => noRedactionConfig(),
    getConversationLoggingEnabled: () => false,
  };
}

/**
 * Shared lifecycle: registers the provider-runtime setup/teardown hooks once
 * and returns lazy accessors. Mirrors the `useTempDir()` pattern from
 * dev-docs/RULES.md — every describe that needs a real ProviderManager calls
 * this helper instead of repeating the beforeEach/afterEach boilerplate.
 */
function useProviderManager(suite: string): {
  manager: () => ProviderManager;
  config: () => Config;
} {
  let providerManager: ProviderManager;
  let providerConfig: Config;

  beforeEach(() => {
    resetSettingsService();
    const runtimeId = `${suite}.${Math.random().toString(36).slice(2, 10)}`;
    const { runtime: testRuntime } = initializeTestProviderRuntime({
      runtimeId,
      metadata: { suite, runtimeId },
    });
    providerConfig = new Config({
      sessionId: `${suite}-${Date.now()}`,
      projectRoot: process.cwd(),
      targetDir: process.cwd(),
      llxprtHomeDir: `/tmp/.llxprt-${suite}`,
      isReadOnlyFilesystem: false,
      persistentStatePath: `/tmp/.llxprt-${suite}/state`,
      conversationLoggingEnabled: false,
      conversationLogPath: `/tmp/.llxprt-${suite}/logs`,
      getUserMemory: () => '',
      embeddingModel: 'text-embedding-3-small',
      providerConfig: undefined,
      oauthManager: undefined,
    });
    providerManager = new ProviderManager(testRuntime);
    providerManager.setConfig(providerConfig);
    providerConfig.setProviderManager(providerManager);
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  return {
    manager: () => providerManager,
    config: () => providerConfig,
  };
}

describe('token-tracking cross-package integration', () => {
  describe('ProviderManager session token accumulation', () => {
    const { manager } = useProviderManager('accumulation');

    it('sums tokens contributed by multiple providers into one session total', () => {
      const pm = manager();
      pm.resetSessionTokenUsage();
      // input includes cache tokens (total-including-cache invariant);
      // `total` deliberately excludes cache (re-read, not newly consumed).
      pm.accumulateSessionTokens('openai', {
        input: 250,
        output: 150,
        cache: 50,
        tool: 25,
        thought: 0,
      });
      pm.accumulateSessionTokens('anthropic', {
        input: 300,
        output: 200,
        cache: 0,
        tool: 10,
        thought: 15,
      });

      const usage = pm.getSessionTokenUsage();
      expect(usage.input).toBe(550);
      expect(usage.output).toBe(350);
      expect(usage.cache).toBe(50);
      expect(usage.tool).toBe(35);
      expect(usage.thought).toBe(15);
      expect(usage.total).toBe(950); // 550 + 350 + 35 + 15
    });

    it('preserves accurate totals when the active provider switches mid-session', () => {
      const pm = manager();
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

    it('resets every session field to zero', () => {
      const pm = manager();
      pm.resetSessionTokenUsage();
      pm.accumulateSessionTokens('openai', {
        input: 150,
        output: 200,
        cache: 50,
        tool: 25,
        thought: 10,
      });
      expect(pm.getSessionTokenUsage().total).toBe(385);

      pm.resetSessionTokenUsage();

      const reset = pm.getSessionTokenUsage();
      expect(reset.input).toBe(0);
      expect(reset.output).toBe(0);
      expect(reset.cache).toBe(0);
      expect(reset.tool).toBe(0);
      expect(reset.thought).toBe(0);
      expect(reset.total).toBe(0);
    });

    it('clamps negative token contributions to zero instead of going negative', () => {
      const pm = manager();
      pm.resetSessionTokenUsage();
      pm.accumulateSessionTokens('openai', {
        input: -50,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
      });

      const usage = pm.getSessionTokenUsage();
      expect(usage.input).toBe(0);
      expect(usage.total).toBe(0);
    });

    it('sustains high-frequency accumulation plus formatting without measurable lag', () => {
      const pm = manager();
      pm.resetSessionTokenUsage();
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        pm.accumulateSessionTokens('openai', {
          input: i === 0 ? 200 : 0,
          output: 5 + (i % 3),
          cache: 0,
          tool: 0,
          thought: 0,
        });
        formatSessionTokenUsage(pm.getSessionTokenUsage());
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
      const usage = pm.getSessionTokenUsage();
      expect(usage.input).toBe(200);
      expect(usage.output).toBeGreaterThan(500);
    });
  });

  describe('ProviderPerformanceTracker metrics', () => {
    it('accumulates throttle wait times and resets them to zero', () => {
      const tracker = new ProviderPerformanceTracker('openai');
      tracker.trackThrottleWaitTime(2000);
      tracker.trackThrottleWaitTime(4000);
      tracker.addThrottleWaitTime(1500);

      expect(tracker.getLatestMetrics().throttleWaitTimeMs).toBe(7500);

      tracker.reset();

      expect(tracker.getLatestMetrics().throttleWaitTimeMs).toBe(0);
    });

    itProp(
      'derives tokensPerMinute as 60000 * tokens / duration for a single completion',
      [fc.integer({ min: 1000, max: 5000 })],
      (tokenCount) => {
        const tracker = new ProviderPerformanceTracker('openai');
        // TPM = 60000 * Σtokens / Σduration. A single 1000ms completion of
        // `tokenCount` tokens yields exactly 60 * tokenCount.
        tracker.recordCompletion(1000, null, tokenCount, 5);
        expect(tracker.getLatestMetrics().tokensPerMinute).toBe(
          60 * tokenCount,
        );
      },
    );
  });

  describe('per-provider token extraction via LoggingProviderWrapper', () => {
    it('extracts input/output from an OpenAI completion usage object', () => {
      const wrapper = new LoggingProviderWrapper(
        new OpenAIProvider('test-key'),
        loggingConfig(),
      );
      const counts = wrapper.extractTokenCountsFromResponse({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        usage: {
          prompt_tokens: 250,
          completion_tokens: 150,
          total_tokens: 400,
        },
      });

      expect(counts.input_token_count).toBe(250);
      expect(counts.output_token_count).toBe(150);
      expect(counts.cached_content_token_count).toBe(0);
      expect(counts.tool_token_count).toBe(0);
      expect(counts.thoughts_token_count).toBe(0);
    });

    it('returns zeros for an OpenAI streaming chunk that carries no usage', () => {
      const wrapper = new LoggingProviderWrapper(
        new OpenAIProvider('test-key'),
        loggingConfig(),
      );
      const counts = wrapper.extractTokenCountsFromResponse({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [
          { delta: { content: 'Hello' }, index: 0, finish_reason: null },
        ],
      });

      expect(counts.input_token_count).toBe(0);
      expect(counts.output_token_count).toBe(0);
      expect(counts.cached_content_token_count).toBe(0);
      expect(counts.tool_token_count).toBe(0);
      expect(counts.thoughts_token_count).toBe(0);
    });

    it('extracts usage from the final OpenAI streaming chunk', () => {
      const wrapper = new LoggingProviderWrapper(
        new OpenAIProvider('test-key'),
        loggingConfig(),
      );
      const counts = wrapper.extractTokenCountsFromResponse({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 300,
          completion_tokens: 180,
          total_tokens: 480,
        },
      });

      expect(counts.input_token_count).toBe(300);
      expect(counts.output_token_count).toBe(180);
    });

    it('extracts input/output from Anthropic response headers', () => {
      const wrapper = new LoggingProviderWrapper(
        new AnthropicProvider('test-key'),
        loggingConfig(),
      );
      const counts = wrapper.extractTokenCountsFromResponse({
        id: 'msg_test',
        type: 'message',
        content: [{ type: 'text', text: 'Hello' }],
        headers: {
          'anthropic-input-tokens': '200',
          'anthropic-output-tokens': '120',
        },
      });

      expect(counts.input_token_count).toBe(200);
      expect(counts.output_token_count).toBe(120);
      expect(counts.cached_content_token_count).toBe(0);
      expect(counts.tool_token_count).toBe(0);
      expect(counts.thoughts_token_count).toBe(0);
    });

    it('extracts Anthropic thinking (reasoning) tokens from a usage object', () => {
      const wrapper = new LoggingProviderWrapper(
        new AnthropicProvider('test-key'),
        loggingConfig(),
      );
      const counts = wrapper.extractTokenCountsFromResponse({
        content: [
          { type: 'thinking', content: 'Let me think...' },
          { type: 'text', text: 'Based on my analysis...' },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 150,
          thoughts_tokens: 80,
        },
      });

      expect(counts.input_token_count).toBe(200);
      expect(counts.output_token_count).toBe(150);
      expect(counts.thoughts_token_count).toBe(80);
    });

    it('extracts cached content tokens from a Gemini usage object', () => {
      const wrapper = new LoggingProviderWrapper(
        new GeminiProvider(),
        loggingConfig(),
      );
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

    it('yields zeros for missing or incomplete usage data across providers', () => {
      const wrappers = [
        new LoggingProviderWrapper(
          new OpenAIProvider('test-key'),
          loggingConfig(),
        ),
        new LoggingProviderWrapper(
          new AnthropicProvider('test-key'),
          loggingConfig(),
        ),
        new LoggingProviderWrapper(new GeminiProvider(), loggingConfig()),
      ];
      const incomplete = [{}, { usage: {} }, { headers: {} }, null, undefined];

      for (const wrapper of wrappers) {
        for (const response of incomplete) {
          const counts = wrapper.extractTokenCountsFromResponse(response);
          expect(counts.input_token_count).toBe(0);
          expect(counts.output_token_count).toBe(0);
          expect(counts.cached_content_token_count).toBe(0);
          expect(counts.tool_token_count).toBe(0);
          expect(counts.thoughts_token_count).toBe(0);
        }
      }
    });
  });

  describe('retryWithBackoff throttle tracking', () => {
    it('invokes trackThrottleWaitTime and succeeds after transient 429 retries', async () => {
      const waitTimes: number[] = [];
      let attempts = 0;
      const fn = async (): Promise<string> => {
        attempts++;
        if (attempts < 3) {
          throw Object.assign(new Error('Rate limit exceeded'), {
            status: 429,
          });
        }
        return 'success';
      };

      const result = await retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 80,
        maxDelayMs: 1000,
        trackThrottleWaitTime: (ms) => waitTimes.push(ms),
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
      expect(waitTimes).toHaveLength(2);
      for (const wait of waitTimes) {
        expect(wait).toBeGreaterThan(0);
      }
    });

    it('accumulates exponentially increasing backoff delays', async () => {
      const waitTimes: number[] = [];
      let attempts = 0;
      const fn = async (): Promise<string> => {
        attempts++;
        if (attempts < 4) {
          throw Object.assign(new Error('Rate limit'), { status: 429 });
        }
        return 'success';
      };

      await retryWithBackoff(fn, {
        maxAttempts: 6,
        initialDelayMs: 80,
        maxDelayMs: 5000,
        trackThrottleWaitTime: (ms) => waitTimes.push(ms),
      });

      expect(waitTimes).toHaveLength(3);
      // With initialDelayMs=80, the ±30% jitter bands never overlap across
      // successive doublings, so the recorded waits are strictly increasing.
      expect(waitTimes[1]).toBeGreaterThan(waitTimes[0]);
      expect(waitTimes[2]).toBeGreaterThan(waitTimes[1]);
    });
  });

  describe('formatter shape property', () => {
    itProp(
      'formatSessionTokenUsage renders every category with locale grouping for any non-negative counts',
      [
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 50000 }),
        fc.integer({ min: 0, max: 20000 }),
        fc.integer({ min: 0, max: 10000 }),
      ],
      (input, output, cache, tool, thought) => {
        const usage = {
          input,
          output,
          cache,
          tool,
          thought,
          total: input + output + cache + tool + thought,
        };
        const formatted = formatSessionTokenUsage(usage);
        // `toLocaleString()` renders each count with the locale's grouping
        // separator, so the pattern must accept a grouped number.
        const groupedNumber = String.raw`\d[\d,.\u00A0\u202F ]*`;
        expect(formatted).toMatch(
          new RegExp(
            `Session Tokens - Input: ${groupedNumber}, Output: ${groupedNumber}, ` +
              `Cache: ${groupedNumber}, Tool: ${groupedNumber}, ` +
              `Thought: ${groupedNumber}, Total: ${groupedNumber}`,
          ),
        );
      },
    );
  });
});
