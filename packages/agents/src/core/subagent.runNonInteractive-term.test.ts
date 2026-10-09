/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope termination, recovery, and dispose. runInteractive termination
 * and scheduling-timeout coverage lives in subagent.runInteractive-term.test.ts.
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  vi,
  describe,
  beforeEach,
  afterEach,
  afterAll,
  type Mock,
} from 'bun:test';
import { ChatSession } from './chatSession.js';
import {
  createContentGenerator,
  type ContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
const realEnvironmentContextModule = {
  ...(await import('@vybestack/llxprt-code-core/utils/environmentContext.js')),
};
const realNonInteractiveToolExecutorModule = {
  ...(await import('./nonInteractiveToolExecutor.js')),
};

const { mockReadTodos, TodoStoreMock } = (() => {
  const mockReadTodos = vi.fn().mockResolvedValue([]);
  const TodoStoreMock = vi
    .fn()
    .mockImplementation(() => ({ readTodos: mockReadTodos }));
  return { mockReadTodos, TodoStoreMock };
})();

const actual = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...actual,
  LocalTodoStore: TodoStoreMock,
}));

const __actual = { ...(await import('./chatSession.js')) };
void vi.mock('./chatSession.js', () => {
  const apply = (actual: typeof import('./chatSession.js')) => ({
    ...actual,
    ChatSession: vi.fn(),
  });
  const result = __actual as
    | typeof import('./chatSession.js')
    | Promise<typeof import('./chatSession.js')>;
  return result instanceof Promise ? result.then(apply) : apply(result);
});
const actual3 = {
  ...(await import('@vybestack/llxprt-code-core/core/contentGenerator.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/contentGenerator.js', () => ({
  ...actual3,
  createContentGenerator: vi.fn(),
}));
void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () =>
  automock(realEnvironmentContextModule),
);
void vi.mock('./nonInteractiveToolExecutor.js', () =>
  automock(realNonInteractiveToolExecutorModule),
);
const actual4 = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
void vi.mock('@vybestack/llxprt-code-ide-integration', () => ({
  ...actual4,
  IdeClient: {
    getInstance: vi.fn().mockResolvedValue({
      getConnectionStatus: vi.fn(),
      initialize: vi.fn(),
      shutdown: vi.fn(),
    }),
  },
}));
const actual5 = {
  ...(await import('@vybestack/llxprt-code-core/core/prompts.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  ...actual5,
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
}));

import { registerTerminationTests } from './__tests__/subagent.runNonInteractive-term-cases.js';
import {
  registerInteractiveBestEffortTest,
  registerDisposeTests,
} from './__tests__/subagent.runNonInteractive-term-dispose-cases.js';

describe('subagent.ts', () => {
  afterAll(() => {
    void vi.mock('./chatSession.js', () => __actual);
    void vi.mock(
      './nonInteractiveToolExecutor.js',
      () => realNonInteractiveToolExecutorModule,
    );
    void vi.mock('@vybestack/llxprt-code-tools', () => actual);
    void vi.mock(
      '@vybestack/llxprt-code-core/utils/environmentContext.js',
      () => realEnvironmentContextModule,
    );
    void vi.mock(
      '@vybestack/llxprt-code-core/core/contentGenerator.js',
      () => actual3,
    );
  });

  let mockSendMessageStream: Mock<(...args: never[]) => unknown>;

  beforeEach(() => {
    // Guards against a previous test leaking fake-timer state across test
    // boundaries. Restore real timers before failing so a leak fails exactly
    // one test instead of poisoning every later one.
    if (vi.isFakeTimers()) {
      vi.useRealTimers();
      throw new Error(
        'subagent.ts tests: previous test leaked fake timers into this one',
      );
    }

    vi.clearAllMocks();
    mockReadTodos.mockReset();
    mockReadTodos.mockResolvedValue([]);
    TodoStoreMock.mockClear();

    (
      getEnvironmentContext as Mock<typeof getEnvironmentContext>
    ).mockResolvedValue([{ text: 'Env Context' }]);
    (
      createContentGenerator as Mock<typeof createContentGenerator>
    ).mockResolvedValue({
      getGenerativeModel: vi.fn(),
    } as unknown as ContentGenerator);

    mockSendMessageStream = vi.fn();
    (
      ChatSession as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation(
      () =>
        ({
          sendMessageStream: mockSendMessageStream,
          recordCompletedToolCalls: vi.fn(),
          getHistory: vi.fn().mockReturnValue([]),
          getHistoryService: vi.fn().mockReturnValue({
            clear: vi.fn(),
            findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
            getCurated: vi.fn().mockReturnValue([]),
            getTotalTokens: vi.fn().mockReturnValue(0),
          }),
          getConfig: vi.fn().mockReturnValue(undefined),
        }) as unknown as ChatSession,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  registerTerminationTests(() => mockSendMessageStream);
  registerInteractiveBestEffortTest(() => mockSendMessageStream);
  registerDisposeTests(() => mockSendMessageStream);
});
