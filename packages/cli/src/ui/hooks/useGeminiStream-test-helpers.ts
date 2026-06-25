/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';

const coreMocks = vi.hoisted(() => {
  const mockSendMessageStream = vi
    .fn()
    .mockReturnValue((async function* () {})());
  const mockStartChat = vi.fn();
  const MockedAgentClientClass = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    _config: unknown,
  ) {
    this.startChat = mockStartChat;
    this.sendMessageStream = mockSendMessageStream;
    this.addHistory = vi.fn();
    this.getCurrentSequenceModel = vi.fn().mockReturnValue(null);
    this.getChat = vi.fn().mockReturnValue({
      recordCompletedToolCalls: vi.fn(),
    });
  });
  const MockedUserPromptEvent = vi.fn().mockImplementation(() => {});
  const mockParseAndFormatApiError = vi.fn();

  return {
    MockedAgentClientClass,
    MockedUserPromptEvent,
    mockParseAndFormatApiError,
    mockSendMessageStream,
    mockStartChat,
  };
});

export const MockedAgentClientClass = coreMocks.MockedAgentClientClass;
export const mockParseAndFormatApiError = coreMocks.mockParseAndFormatApiError;
export const mockSendMessageStream = coreMocks.mockSendMessageStream;
export const mockStartChat = coreMocks.mockStartChat;

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actualCoreModule = await importOriginal<Record<string, unknown>>();
  return {
    ...actualCoreModule,
    GitService: vi.fn(),
    AgentClient: coreMocks.MockedAgentClientClass,
    UserPromptEvent: coreMocks.MockedUserPromptEvent,
    parseAndFormatApiError: coreMocks.mockParseAndFormatApiError,
    tokenLimit: vi.fn().mockReturnValue(100),
  };
});
