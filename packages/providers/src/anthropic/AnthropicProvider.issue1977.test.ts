/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the assistant-message prefill guard on models that do not
 * support prefill (Claude Fable 5) with reasoning disabled (the default).
 * @issue #1977
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AnthropicRequestBody } from './__tests__/anthropicTestUtils.js';
import {
  mockMessagesCreate,
  setupThinkingProvider,
  type ThinkingTestSetup,
} from './__tests__/anthropicThinkingTestSetup.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

function messageTextContent(
  message: AnthropicRequestBody['messages'][number],
): string | undefined {
  if (Array.isArray(message.content)) {
    return message.content.find((block) => block.type === 'text')?.text;
  }
  return message.content;
}

describe('Issue #1977: prefill guard for models without prefill support', () => {
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

  // Shared harness: pin the model, run one turn over the given history, and
  // return the captured request body.
  async function generateRequest(
    contents: IContent[],
    model: string,
  ): Promise<AnthropicRequestBody> {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const generator = provider.generateChatCompletion(
      buildCallOptions(contents, {
        settingsOverrides: { global: { model } },
      }),
    );
    await generator.next();

    return mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;
  }

  // A conversation that ends with an assistant message, e.g. resumed or
  // migrated across models (opus -> gpt-5.5 -> fable).
  const trailingAssistantHistory: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'I will help you.' }] },
  ];

  it('appends the user placeholder for fable with reasoning disabled @issue:1977', async () => {
    const request = await generateRequest(
      trailingAssistantHistory,
      'claude-fable-5',
    );

    const lastMessage = request.messages[request.messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(messageTextContent(lastMessage)).toBe('Continue the conversation');
  });

  it('appends exactly one placeholder with thinking enabled and keeps adaptive thinking for fable @issue:1977', async () => {
    settingsService.set('reasoning.enabled', true);

    const request = await generateRequest(
      trailingAssistantHistory,
      'claude-fable-5',
    );

    const placeholderCount = request.messages.filter(
      (message) => messageTextContent(message) === 'Continue the conversation',
    ).length;
    expect(placeholderCount).toBe(1);

    const lastMessage = request.messages[request.messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(request.thinking?.type).toBe('adaptive');
  });

  it('keeps the trailing assistant message for prefill-capable sonnet with reasoning disabled @issue:1977', async () => {
    const request = await generateRequest(
      trailingAssistantHistory,
      'claude-sonnet-4-5-20250929',
    );

    const lastMessage = request.messages[request.messages.length - 1];
    expect(lastMessage.role).toBe('assistant');
    const placeholderCount = request.messages.filter(
      (message) => messageTextContent(message) === 'Continue the conversation',
    ).length;
    expect(placeholderCount).toBe(0);
  });

  it('leaves a conversation already ending with a user message untouched for fable @issue:1977', async () => {
    const request = await generateRequest(
      [{ speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] }],
      'claude-fable-5',
    );

    const lastMessage = request.messages[request.messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(messageTextContent(lastMessage)).toBe('Hello');
    const placeholderCount = request.messages.filter(
      (message) => messageTextContent(message) === 'Continue the conversation',
    ).length;
    expect(placeholderCount).toBe(0);
  });

  it.each([
    'claude-fable-5-latest',
    'claude-fable-5-20260701',
    'claude-fable-5-1',
    'claude-fable-5-1-latest',
  ] satisfies readonly string[])(
    'appends the user placeholder for fable variant %s with reasoning disabled @issue:1977',
    async (model) => {
      const request = await generateRequest(trailingAssistantHistory, model);

      const lastMessage = request.messages[request.messages.length - 1];
      expect(lastMessage.role).toBe('user');
      expect(messageTextContent(lastMessage)).toBe('Continue the conversation');
    },
  );
});
