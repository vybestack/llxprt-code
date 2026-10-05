/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, type Mock } from 'bun:test';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import type { ChatSession } from './chatSession.js';
import type { AgentClient } from './client.js';

export function make413Chat(
  overrides: Partial<ChatSession> = {},
): Partial<ChatSession> {
  return {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getLastPromptTokenCount: vi.fn().mockReturnValue(0),
    getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
    getContextLimit: vi.fn().mockReturnValue(1000000),
    performCompression: vi.fn(),
    enforceContextWindow: vi.fn(),
    estimatePendingTokens: vi.fn(),
    ...overrides,
  };
}

export function enableFailedApiCallRetry(client: AgentClient): void {
  vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
    true,
  );
}

export function setMockTokenLimit(limit: number): void {
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(limit);
}

export function installOverflowMockChat(
  client: AgentClient,
  tokenCount: number,
  extras: Partial<ChatSession> = {},
): Partial<ChatSession> {
  const chat: Partial<ChatSession> = {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getLastPromptTokenCount: vi.fn().mockReturnValue(tokenCount),
    getProjectedPromptBaseline: vi.fn().mockReturnValue(tokenCount),
    getContextLimit: vi.fn(() => tokenLimit('test-model')),
    ...extras,
  };
  client['chat'] = chat as ChatSession;
  return chat;
}

export function installZeroCountGenerator(client: AgentClient): void {
  client['contentGenerator'] = {
    countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
  } as unknown as ContentGenerator;
}
