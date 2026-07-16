/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Async streaming behavioral coverage through the real TaskTool async path.
 *
 * These tests exercise the full wiring: TaskTool(async:true) → executeAsyncTask
 * → setupAsyncStreaming → executeInBackground → updateOutput. They catch broken
 * TaskTool/executeAsyncTask wiring that lower-level setupAsyncStreaming tests
 * would miss.
 */

import { describe, it, expect, vi } from 'vitest';
import { TaskTool, type TaskToolParams } from './task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';

interface AsyncStreamingHarness {
  tool: TaskTool;
  mockAsyncTaskManager: Record<string, ReturnType<typeof vi.fn>>;
  /**
   * Resolves when completeTask or failTask is invoked by the background
   * execution path. Await via {@link expectCompletionWithin} to guard against
   * indefinite hangs if the wiring regresses.
   */
  completionPromise: Promise<void>;
}

/**
 * Default deadline for the completion guard. Well below the 30s global Vitest
 * testTimeout so a hang produces a clear, fast failure rather than a slow one.
 */
const COMPLETION_TIMEOUT_MS = 5_000;

/**
 * Races a completion promise against a deterministic local timeout. If the
 * promise does not settle within `timeoutMs`, rejects with a message pointing
 * at the completeTask/failTask wiring as the likely cause. Avoids repeating
 * Promise.race boilerplate at each await site.
 */
function expectCompletionWithin(
  completionPromise: Promise<void>,
  timeoutMs: number = COMPLETION_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `completionPromise did not settle within ${timeoutMs}ms — ` +
              'completeTask/failTask wiring may be broken',
          ),
        ),
      timeoutMs,
    );
  });
  return Promise.race([completionPromise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

/**
 * Builds a TaskTool configured for async execution with a fake orchestrator
 * and fake AsyncTaskManager. The scope's runNonInteractive performs the
 * supplied emission logic — this is real background execution through the
 * genuine async wiring, not a mock of it.
 */
function createAsyncStreamingHarness(
  emit: (scope: { onMessage?: (message: string) => void }) => Promise<void>,
  options: {
    agentId?: string;
    existingHandler?: (message: string) => void;
  } = {},
): AsyncStreamingHarness {
  const agentId = options.agentId ?? 'async-stream-agent';

  let resolveCompletion: (() => void) | undefined;
  const completionPromise = new Promise<void>(
    (resolve) => (resolveCompletion = resolve),
  );

  const mockAsyncTaskManager = {
    canLaunchAsync: vi.fn(() => ({ allowed: true })),
    tryReserveAsyncSlot: vi.fn(() => 'booking-1'),
    registerTask: vi.fn(),
    completeTask: vi.fn(() => resolveCompletion?.()),
    failTask: vi.fn(() => resolveCompletion?.()),
    getTask: vi.fn(() => ({ status: 'running' })),
  };

  const scope: {
    output: {
      emitted_vars: Record<string, string>;
      terminate_reason: SubagentTerminateMode;
    };
    runNonInteractive: ReturnType<typeof vi.fn>;
    onMessage?: (message: string) => void;
  } = {
    output: {
      emitted_vars: {},
      terminate_reason: SubagentTerminateMode.GOAL,
    },
    runNonInteractive: vi.fn().mockImplementation(async () => {
      await emit(scope);
    }),
    onMessage: options.existingHandler,
  };

  const launch = vi.fn().mockResolvedValue({
    agentId,
    scope,
    dispose: vi.fn().mockResolvedValue(undefined),
  });

  const tool = new TaskTool(
    {
      getSessionId: () => 'session-async-stream',
    } as unknown as Config,
    {
      orchestratorFactory: () =>
        ({ launch }) as unknown as SubagentOrchestrator,
      getAsyncTaskManager: () =>
        mockAsyncTaskManager as unknown as AsyncTaskManager,
      isInteractiveEnvironment: () => false,
    },
  );

  return { tool, mockAsyncTaskManager, completionPromise };
}

/** Asserts the exact XML wrapper tags then returns the interior deltas only. */
function extractMessageDeltas(outputs: string[]): string[] {
  const [opening] = outputs;
  expect(opening.startsWith('<subagent name="')).toBe(true);
  expect(opening.endsWith('">\n')).toBe(true);
  const closing = outputs[outputs.length - 1];
  expect(closing.startsWith('</subagent name="')).toBe(true);
  expect(closing.endsWith('">\n')).toBe(true);
  return outputs.slice(1, -1);
}

describe('TaskTool async streaming through real async path', () => {
  it('streams the exact issue sequence with lossless standalone newlines', async () => {
    const { tool, mockAsyncTaskManager, completionPromise } =
      createAsyncStreamingHarness(async (scope) => {
        scope.onMessage?.('Analyzing the codebase...');
        scope.onMessage?.('\n');
        scope.onMessage?.('Found 3 issues:');
        scope.onMessage?.('\n');
        scope.onMessage?.('1. Missing import');
      });

    const outputs: string[] = [];
    const invocation = tool.build({
      subagent_name: 'reviewer',
      goal_prompt: 'Review the code',
      async: true,
    } satisfies TaskToolParams);

    await invocation.execute(new AbortController().signal, (chunk) =>
      outputs.push(chunk),
    );

    await expectCompletionWithin(completionPromise);

    const accumulated = extractMessageDeltas(outputs).join('');

    expect(accumulated).toBe(
      'Analyzing the codebase...\nFound 3 issues:\n1. Missing import',
    );
    // The background task was marked complete via the real async wiring.
    expect(mockAsyncTaskManager.completeTask).toHaveBeenCalledTimes(1);
  });

  it('preserves standalone spaces, tabs, and normalizes CR/CRLF through the async path', async () => {
    const { tool, completionPromise } = createAsyncStreamingHarness(
      async (scope) => {
        scope.onMessage?.('a');
        scope.onMessage?.(' ');
        scope.onMessage?.('b');
        scope.onMessage?.('\t');
        scope.onMessage?.('c');
        scope.onMessage?.('\r');
        scope.onMessage?.('d\r\ne');
      },
    );

    const outputs: string[] = [];
    const invocation = tool.build({
      subagent_name: 'reviewer',
      goal_prompt: 'Review',
      async: true,
    } satisfies TaskToolParams);

    await invocation.execute(new AbortController().signal, (chunk) =>
      outputs.push(chunk),
    );

    await expectCompletionWithin(completionPromise);

    const accumulated = extractMessageDeltas(outputs).join('');

    // Space, tab preserved; lone CR → LF; CRLF → LF.
    expect(accumulated).toBe('a b\tc\nd\ne');
  });

  it('forwards raw messages to an existing onMessage handler through the async path', async () => {
    const receivedRaw: string[] = [];
    const { tool, completionPromise } = createAsyncStreamingHarness(
      async (scope) => {
        scope.onMessage?.('raw\r\nmessage');
      },
      { existingHandler: (msg) => receivedRaw.push(msg) },
    );

    const outputs: string[] = [];
    const invocation = tool.build({
      subagent_name: 'reviewer',
      goal_prompt: 'Review',
      async: true,
    } satisfies TaskToolParams);

    await invocation.execute(new AbortController().signal, (chunk) =>
      outputs.push(chunk),
    );

    await expectCompletionWithin(completionPromise);

    // The existing handler receives the UN-normalized raw message.
    expect(receivedRaw).toStrictEqual(['raw\r\nmessage']);
    // The streamed output is normalized.
    expect(extractMessageDeltas(outputs).join('')).toBe('raw\nmessage');
  });

  it('emits opening and closing XML tags around async streamed content', async () => {
    const { tool, completionPromise } = createAsyncStreamingHarness(
      async (scope) => {
        scope.onMessage?.('hello');
      },
      { agentId: 'async-xml-stream' },
    );

    const outputs: string[] = [];
    const invocation = tool.build({
      subagent_name: 'reviewer',
      goal_prompt: 'Review',
      async: true,
    } satisfies TaskToolParams);

    await invocation.execute(new AbortController().signal, (chunk) =>
      outputs.push(chunk),
    );

    await expectCompletionWithin(completionPromise);

    expect(outputs[0]).toBe(
      '<subagent name="reviewer" id="async-xml-stream">\n',
    );
    expect(outputs[outputs.length - 1]).toBe(
      '</subagent name="reviewer" id="async-xml-stream">\n',
    );
  });

  it('preserves CRLF semantics across split chunk boundaries through the async path', async () => {
    const { tool, completionPromise } = createAsyncStreamingHarness(
      async (scope) => {
        scope.onMessage?.('a\r');
        scope.onMessage?.('\nb');
      },
    );

    const outputs: string[] = [];
    const invocation = tool.build({
      subagent_name: 'reviewer',
      goal_prompt: 'Review',
      async: true,
    } satisfies TaskToolParams);

    await invocation.execute(new AbortController().signal, (chunk) =>
      outputs.push(chunk),
    );

    await expectCompletionWithin(completionPromise);

    expect(extractMessageDeltas(outputs).join('')).toBe('a\nb');
  });

  it('flushes a pending CR as LF when the async stream ends in a lone CR', async () => {
    const { tool, completionPromise } = createAsyncStreamingHarness(
      async (scope) => {
        scope.onMessage?.('hello');
        scope.onMessage?.('\r');
      },
    );

    const outputs: string[] = [];
    const invocation = tool.build({
      subagent_name: 'reviewer',
      goal_prompt: 'Review',
      async: true,
    } satisfies TaskToolParams);

    await invocation.execute(new AbortController().signal, (chunk) =>
      outputs.push(chunk),
    );

    await expectCompletionWithin(completionPromise);

    expect(extractMessageDeltas(outputs).join('')).toBe('hello\n');
  });

  it('preserves model text that begins with exact subagent wrapper prefixes verbatim', async () => {
    const { tool, completionPromise } = createAsyncStreamingHarness(
      async (scope) => {
        scope.onMessage?.('<subagent name="not-wrapper">begin');
        scope.onMessage?.('</subagent name="not-wrapper">end');
      },
    );

    const outputs: string[] = [];
    const invocation = tool.build({
      subagent_name: 'reviewer',
      goal_prompt: 'Review',
      async: true,
    } satisfies TaskToolParams);

    await invocation.execute(new AbortController().signal, (chunk) =>
      outputs.push(chunk),
    );

    await expectCompletionWithin(completionPromise);

    expect(extractMessageDeltas(outputs).join('')).toBe(
      '<subagent name="not-wrapper">begin</subagent name="not-wrapper">end',
    );
  });
});
