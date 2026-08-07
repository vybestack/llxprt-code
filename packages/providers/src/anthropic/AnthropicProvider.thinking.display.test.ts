/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider thinking `display` field behavior across
 * model families and reasoning.includeInResponse settings.
 * Extracted from AnthropicProvider.thinking.config.test.ts for max-lines
 * compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AnthropicRequestBody } from './test-utils/anthropicTestUtils.js';
import {
  mockMessagesCreate,
  setupThinkingProvider,
  type ThinkingTestSetup,
} from './test-utils/anthropicThinkingTestSetup.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

describe('AnthropicProvider thinking display field @plan:PLAN-ANTHROPIC-THINKING', () => {
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

  function buildMessages(): IContent[] {
    return [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
    ];
  }

  async function captureRequest(model: string): Promise<AnthropicRequestBody> {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const generator = provider.generateChatCompletion(
      buildCallOptions(buildMessages(), {
        settingsOverrides: { global: { model } },
      }),
    );
    await generator.next();
    expect(mockMessagesCreate).toHaveBeenCalled();
    return mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;
  }

  it('should set display:summarized for Opus 4.8 when reasoning.includeInResponse is true @issue:1723', async () => {
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.includeInResponse', true);
    const request = await captureRequest('claude-opus-4-8');
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.thinking?.display).toBe('summarized');
  });

  it('should set display:omitted for Opus 4.8 when reasoning.includeInResponse is false @issue:1723', async () => {
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.includeInResponse', false);
    const request = await captureRequest('claude-opus-4-8');
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.thinking?.display).toBe('omitted');
  });

  it('should set display:summarized for Sonnet 5 when reasoning.includeInResponse is true @issue:1723', async () => {
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.includeInResponse', true);
    const request = await captureRequest('claude-sonnet-5');
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.thinking?.display).toBe('summarized');
  });

  it('should set display:omitted for budgeted thinking when reasoning.includeInResponse is false @issue:1723', async () => {
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.budgetTokens', 15000);
    settingsService.set('reasoning.includeInResponse', false);
    const request = await captureRequest('claude-opus-4-8');
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('enabled');
    expect(request.thinking?.budget_tokens).toBe(15000);
    expect(request.thinking?.display).toBe('omitted');
  });

  it('should omit display for budgeted thinking when reasoning.includeInResponse is true @issue:1723', async () => {
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.budgetTokens', 15000);
    settingsService.set('reasoning.includeInResponse', true);
    const request = await captureRequest('claude-sonnet-4-5');
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('enabled');
    expect(request.thinking?.budget_tokens).toBe(15000);
    expect(request.thinking?.display).toBeUndefined();
  });

  it('should set display:summarized for Fable 5 when reasoning.includeInResponse is true @issue:1723', async () => {
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.includeInResponse', true);
    const request = await captureRequest('claude-fable-5-20251029');
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.thinking?.display).toBe('summarized');
  });

  it('should set display:omitted for Fable 5 when reasoning.includeInResponse is false @issue:1723', async () => {
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.includeInResponse', false);
    const request = await captureRequest('claude-fable-5-20251029');
    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('adaptive');
    expect(request.thinking?.display).toBe('omitted');
  });
});
