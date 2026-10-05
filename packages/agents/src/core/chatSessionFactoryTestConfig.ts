/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { TodoContinuationService } from './TodoContinuationService.js';
import { createChatSession } from './ChatSessionFactory.js';

export function makeConfig(
  overrides: Partial<Config> = {},
  ephemeralSettings: Readonly<Record<string, unknown>> = {},
): Config {
  return {
    getEphemeralSetting: vi
      .fn()
      .mockImplementation((key: string) => ephemeralSettings[key]),
    isJitContextEnabled: vi.fn().mockReturnValue(false),
    getGlobalMemory: vi.fn().mockReturnValue(undefined),
    getUserMemory: vi.fn().mockReturnValue('user memory text'),
    getCoreMemory: vi.fn().mockReturnValue('core memory text'),
    getJitMemoryForPath: vi.fn().mockResolvedValue(null),
    getMcpInstructions: vi.fn().mockReturnValue(undefined),
    isInteractive: vi.fn().mockReturnValue(true),
    getWorkingDir: vi.fn().mockReturnValue('/workspace'),
    getSettingsService: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
    getContentGeneratorConfig: vi.fn().mockReturnValue({}),
    getModel: vi.fn().mockReturnValue('gemini-2.5-flash'),
    getToolRegistry: vi.fn().mockReturnValue(undefined),
    getProviderManager: vi.fn().mockReturnValue(undefined),
    ...overrides,
  } as unknown as Config;
}

export function makeRuntimeState(
  overrides: Partial<AgentRuntimeState> = {},
): AgentRuntimeState {
  return {
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    runtimeId: 'test-runtime-id',
    sessionId: 'test-session-id',
    proxyUrl: undefined,
    ...overrides,
  } as unknown as AgentRuntimeState;
}

export function makeTodoContinuationService(): TodoContinuationService {
  return {
    updateTodoToolAvailabilityFromDeclarations: vi.fn(),
    readTodoSnapshot: vi.fn().mockResolvedValue([]),
    getActiveTodos: vi.fn().mockReturnValue([]),
  } as unknown as TodoContinuationService;
}

export function makeContentGenerator(): ContentGenerator {
  return {} as unknown as ContentGenerator;
}

export function createTestChatSession(
  config: Config,
  runtimeState: AgentRuntimeState,
  extraHistory?: IContent[],
): ReturnType<typeof createChatSession> {
  return createChatSession({
    config,
    runtimeState,
    contentGenerator: makeContentGenerator(),
    storedHistoryService: undefined,
    clearStoredHistoryService: vi.fn(),
    extraHistory,
    generateContentConfig: {},
    todoContinuationService: makeTodoContinuationService(),
    toolRegistry: undefined,
  });
}
