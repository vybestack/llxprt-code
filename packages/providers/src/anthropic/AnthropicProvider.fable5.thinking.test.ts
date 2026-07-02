/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider extended thinking specific to Claude Fable 5
 * (adaptive thinking is always on and cannot be disabled). Split from
 * AnthropicProvider.thinking.config.test.ts for max-lines compliance.
 * @issue #2328
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AnthropicRequestBody } from './test-utils/anthropicTestUtils.js';
import {
  mockMessagesCreate,
  setupThinkingProvider,
  type ThinkingTestSetup,
} from './test-utils/anthropicThinkingTestSetup.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

describe('AnthropicProvider Fable 5 Extended Thinking @issue:2328', () => {
  let provider: ThinkingTestSetup['provider'];
  let settingsService: ThinkingTestSetup['settingsService'];
  let buildCallOptions: ThinkingTestSetup['buildCallOptions'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupThinkingProvider();
    provider = setup.provider;
    settingsService = setup.settingsService;
    buildCallOptions = setup.buildCallOptions;
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  // Shared harness: pin Fable 5, apply reasoning settings, run one turn, and
  // return the captured request body. Collapses the per-test boilerplate.
  async function generateFable5Request(
    settings: Array<[string, unknown]>,
  ): Promise<AnthropicRequestBody> {
    for (const [key, value] of settings) {
      settingsService.set(key, value);
    }

    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages, {
        settingsOverrides: { global: { model: 'claude-fable-5' } },
      }),
    );
    await generator.next();

    return mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;
  }

  it('should use adaptive thinking for Claude Fable 5 @issue:2328', async () => {
    const request = await generateFable5Request([['reasoning.enabled', true]]);
    // Fable 5 is adaptive-capable: adaptive thinking is always on.
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.thinking?.budget_tokens).toBeUndefined();
    // Fable 5 never returns raw chain-of-thought; request 'summarized' so
    // thinking blocks carry readable summaries instead of empty fields.
    expect(request.thinking?.display).toBe('summarized');
    // Fable 5 defaults to 40K max output (not the API-only 128K ceiling).
    expect(request.max_tokens).toBe(40000);
  });

  it('should keep adaptive thinking for Claude Fable 5 even when a reasoning budget is configured @issue:2328', async () => {
    const request = await generateFable5Request([
      ['reasoning.enabled', true],
      ['reasoning.budgetTokens', 8000],
    ]);
    // Fable 5 is adaptive-only: a configured budget must not downgrade it to
    // legacy budgeted 'enabled' thinking.
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.thinking?.budget_tokens).toBeUndefined();
  });

  it('should keep adaptive thinking for Claude Fable 5 even when adaptiveThinking is disabled @issue:2328', async () => {
    const request = await generateFable5Request([
      ['reasoning.enabled', true],
      ['reasoning.adaptiveThinking', false],
    ]);
    // Fable 5 cannot disable thinking; an adaptiveThinking:false override
    // must still produce adaptive thinking.
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.thinking?.budget_tokens).toBeUndefined();
  });

  it('should place effort in output_config for Claude Fable 5 @issue:2328', async () => {
    const request = await generateFable5Request([
      ['reasoning.enabled', true],
      ['reasoning.effort', 'medium'],
    ]);
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.output_config).toBeDefined();
    expect(request.output_config?.effort).toBe('medium');
  });

  it('should omit the thinking field for Claude Fable 5 when reasoning is disabled @issue:2328', async () => {
    const request = await generateFable5Request([['reasoning.enabled', false]]);
    // Fable 5 cannot disable adaptive thinking. With reasoning disabled we
    // omit the thinking field entirely (never send the unsupported 'disabled'
    // type); the API then applies its adaptive default.
    expect(request.thinking).toBeUndefined();
  });

  it('does not carry a zero-data-retention/privacy directive for Claude Fable 5 @issue:2328', async () => {
    const request = await generateFable5Request([['reasoning.enabled', true]]);
    // Fable 5 is a designated Covered Model: it requires 30-day data retention
    // and is NOT available under zero-data-retention. A privacy/ZDR directive
    // would be rejected by the API, so the request body must never include one.
    expect(request).not.toHaveProperty('privacy');
    expect(request).not.toHaveProperty('zero_data_retention');
  });
});
