import { createTerminationConfig } from './helpers/termination-config-fixture.js';
import { createSubagentScope } from './helpers/create-subagent-scope.js';
import { scopeInputs } from './subagent-test-helpers.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, type Mock } from 'bun:test';

type StreamMock = Mock<(...args: never[]) => unknown>;
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ChildAgentScope } from '../subagentOrchestrator.js';
import {
  ContextState,
  SubagentTerminateMode,
  type PromptConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession, StreamEventType } from '../chatSession.js';
import { mockChunk } from './turn-test-helpers.js';
import {
  createMockStream,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';
import { waitForCondition } from '../../test-utils/eventLoop.js';

const CONDITION_WAIT_TURNS = 200_000;

export function registerInteractiveBestEffortTest(
  getMockSendMessageStream: () => StreamMock,
): void {
  it('treats eager completed-tool persistence as best-effort during interactive runs', async () => {
    const { scope, recordCompletedToolCalls, completedCalls } =
      await runInteractiveBestEffort(getMockSendMessageStream);
    expect(recordCompletedToolCalls).toHaveBeenCalledWith(
      defaultModelConfig.model,
      completedCalls,
    );
    expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.MAX_TURNS);
  });
}

async function runInteractiveBestEffort(
  getMockSendMessageStream: () => StreamMock,
): Promise<{
  scope: ChildAgentScope;
  recordCompletedToolCalls: Mock<() => never>;
  completedCalls: ReturnType<typeof makeCompletedCalls>;
}> {
  const promptConfig: PromptConfig = { systemPrompt: 'Execute task.' };
  const { config, mcpRuntime, settingsService } =
    await createTerminationConfig();
  const runConfig: RunConfig = { ...defaultRunConfig, max_turns: 1 };
  const recordCompletedToolCalls = vi.fn(() => {
    throw new Error('history write failed');
  });
  mockFailingCompletedToolPersistence(
    getMockSendMessageStream,
    recordCompletedToolCalls,
  );

  const runtimeBundle = createStatelessRuntimeBundle({
    settings: settingsService,
    toolsView: {
      listToolNames: () => ['external_tool'],
      getToolMetadata: () => ({
        name: 'external_tool',
        description: 'External tool',
        parameterSchema: { type: 'object', properties: {} },
      }),
    },
  });
  const { overrides } = createRuntimeOverrides(
    mcpRuntime.workspaceFilesystem.paths,
    { settings: settingsService, runtimeBundle },
  );

  const scope = await createSubagentScope(
    {
      name: 'interactive-best-effort-agent',
      prompt: promptConfig,
      model: defaultModelConfig,
      run: runConfig,
      toolConfig: { tools: ['external_tool'] },
      outputConfig: undefined,
    },
    ...scopeInputs(config, overrides),
  );

  getMockSendMessageStream().mockImplementation(
    createMockStream([
      [
        {
          id: 'call-best-effort',
          name: 'external_tool',
          args: {},
        },
      ],
    ]),
  );

  const completedCalls = makeCompletedCalls();
  const schedulerFactory = vi.fn(({ onAllToolCallsComplete }) => ({
    schedule: vi.fn().mockImplementation(async () => {
      await onAllToolCallsComplete(completedCalls);
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
  }));

  await expect(
    scope.runInteractive(new ContextState(), { schedulerFactory }),
  ).resolves.toBeUndefined();
  return { scope, recordCompletedToolCalls, completedCalls };
}

export function registerDisposeTests(
  getMockSendMessageStream: () => StreamMock,
): void {
  describe('dispose', () => {
    registerDisposeActive(getMockSendMessageStream);
    registerDisposeParentListener(getMockSendMessageStream);
    registerDisposeMultiple();
    registerDisposeAbortReference(getMockSendMessageStream);
    registerDisposeStalledRun(getMockSendMessageStream);
  });
}

function registerDisposeActive(
  getMockSendMessageStream: () => StreamMock,
): void {
  it('should abort active operations when dispose is called', async () => {
    const { config, mcpRuntime, settingsService } =
      await createTerminationConfig();

    const runtimeBundle = createStatelessRuntimeBundle({
      settings: settingsService,
    });
    const { overrides } = createRuntimeOverrides(
      mcpRuntime.workspaceFilesystem.paths,
      { settings: settingsService, runtimeBundle },
    );

    const scope = await createSubagentScope(
      {
        name: 'test-agent',
        prompt: { systemPrompt: 'Test agent' },
        model: defaultModelConfig,
        run: defaultRunConfig,
        toolConfig: undefined,
        outputConfig: undefined,
      },
      ...scopeInputs(config, overrides),
    );

    // Model returns stop immediately to complete normally
    getMockSendMessageStream().mockImplementation(createMockStream(['stop']));
    await scope.runNonInteractive(new ContextState());

    // Now call dispose - it should clean up
    await scope.dispose();

    // Verify disposal was successful by checking cancel is safe
    expect(() => scope.cancel('test')).not.toThrow();
  });
}

function registerDisposeParentListener(
  getMockSendMessageStream: () => StreamMock,
): void {
  it('should clean up parent abort signal listener when dispose is called', async () => {
    const { config, mcpRuntime, settingsService } =
      await createTerminationConfig();

    const parentAbortController = new AbortController();
    const removeEventListenerSpy = vi.spyOn(
      parentAbortController.signal,
      'removeEventListener',
    );

    const runtimeBundle = createStatelessRuntimeBundle({
      settings: settingsService,
    });
    const { overrides } = createRuntimeOverrides(
      mcpRuntime.workspaceFilesystem.paths,
      { settings: settingsService, runtimeBundle },
    );

    const scope = await createSubagentScope(
      {
        name: 'test-agent',
        prompt: { systemPrompt: 'Test agent' },
        model: defaultModelConfig,
        run: defaultRunConfig,
        toolConfig: undefined,
        outputConfig: undefined,
        parentSignal: parentAbortController.signal,
      },
      ...scopeInputs(config, overrides),
    );

    // Run the agent to bind the parent signal
    getMockSendMessageStream().mockImplementation(createMockStream(['stop']));
    await scope.runNonInteractive(new ContextState());

    // Now dispose should clean up listeners
    await scope.dispose();

    // Verify removeEventListener was called
    expect(removeEventListenerSpy).toHaveBeenCalled();
  });
}

function registerDisposeMultiple(): void {
  it('should be safe to call dispose multiple times', async () => {
    const { config, mcpRuntime, settingsService } =
      await createTerminationConfig();

    const runtimeBundle = createStatelessRuntimeBundle({
      settings: settingsService,
    });
    const { overrides } = createRuntimeOverrides(
      mcpRuntime.workspaceFilesystem.paths,
      { settings: settingsService, runtimeBundle },
    );

    const scope = await createSubagentScope(
      {
        name: 'test-agent',
        prompt: { systemPrompt: 'Test agent' },
        model: defaultModelConfig,
        run: defaultRunConfig,
        toolConfig: undefined,
        outputConfig: undefined,
      },
      ...scopeInputs(config, overrides),
    );

    // Should not throw
    const closing: Array<Promise<void>> = [];
    expect(() => {
      closing.push(scope.dispose(), scope.dispose(), scope.dispose());
    }).not.toThrow();
    await Promise.all(closing);
  });
}

function registerDisposeAbortReference(
  getMockSendMessageStream: () => StreamMock,
): void {
  it('should nullify active abort controller reference', async () => {
    const { config, mcpRuntime, settingsService } =
      await createTerminationConfig();

    const runtimeBundle = createStatelessRuntimeBundle({
      settings: settingsService,
    });
    const { overrides } = createRuntimeOverrides(
      mcpRuntime.workspaceFilesystem.paths,
      { settings: settingsService, runtimeBundle },
    );

    const scope = await createSubagentScope(
      {
        name: 'test-agent',
        prompt: { systemPrompt: 'Test agent' },
        model: defaultModelConfig,
        run: defaultRunConfig,
        toolConfig: undefined,
        outputConfig: undefined,
      },
      ...scopeInputs(config, overrides),
    );

    // Start an operation to create an abort controller
    getMockSendMessageStream().mockImplementation(createMockStream(['stop']));
    await scope.runNonInteractive(new ContextState());

    // Dispose
    await scope.dispose();

    // Try to access the private activeAbortController through cancel method
    // If it's null, cancel should be safe
    expect(() => scope.cancel('test')).not.toThrow();
  });
}

function registerDisposeStalledRun(
  getMockSendMessageStream: () => StreamMock,
): void {
  it('unblocks a stalled non-interactive run so no async work leaks between tests', async () => {
    const runError = await verifyDisposeUnblocksStalledRun(
      getMockSendMessageStream,
    );
    expect(runError).toMatchObject({ name: 'AbortError' });
  });
}

async function verifyDisposeUnblocksStalledRun(
  getMockSendMessageStream: () => StreamMock,
): Promise<unknown> {
  const { config, mcpRuntime, settingsOwner, settingsService } =
    await createTerminationConfig();
  // Install fake timers after config creation so config/auth setup runs on
  // real timers; fake timers freeze Date.now/performance.now/hrtime and
  // stop Bun's per-test timeout from firing.
  vi.useFakeTimers();
  // Keep the idle watchdog from firing during the test window so only dispose
  // can unblock the stalled stream consumption.
  settingsOwner.writeUserParameter('stream-idle-timeout-ms', 60_000);

  const getCapturedSignal = installStalledDisposeStream(
    getMockSendMessageStream,
  );

  const runConfig: RunConfig = { max_time_minutes: 5, max_turns: 100 };
  let scope: ChildAgentScope | undefined;
  let runPromise: Promise<void> | undefined;
  let runRejection: Promise<unknown> | undefined;
  try {
    const runtimeBundle = createStatelessRuntimeBundle({
      settings: settingsService,
    });
    const { overrides } = createRuntimeOverrides(
      mcpRuntime.workspaceFilesystem.paths,
      { settings: settingsService, runtimeBundle },
    );

    scope = await createSubagentScope(
      {
        name: 'test-agent',
        prompt: { systemPrompt: 'Test agent' },
        model: defaultModelConfig,
        run: runConfig,
        toolConfig: undefined,
        outputConfig: undefined,
      },
      ...scopeInputs(config, overrides),
    );

    runPromise = scope.runNonInteractive(new ContextState());
    runRejection = runPromise.then(
      () => {
        throw new Error('Expected dispose to abort the stalled run');
      },
      (error: unknown) => error,
    );

    // Wait for the run to enter stream consumption so the abort signal is
    // captured against this test's mock before dispose fires.
    expect(
      await waitForCondition(
        () => getCapturedSignal() !== undefined,
        CONDITION_WAIT_TURNS,
      ),
    ).toBe(true);

    const didSettle = trackSettlement(runRejection);

    await scope.dispose();

    // The stream is stalled after its first chunk and the idle watchdog is
    // too far out to fire; dispose must abort so the run settles within a
    // bounded wait instead of hanging the file.
    expect(await waitForCondition(didSettle, CONDITION_WAIT_TURNS)).toBe(true);

    const runError = await runRejection;
    return runError;
  } finally {
    vi.useRealTimers();
    // Absorbers guard a failure path: if the run somehow never settles the
    // bounded wait returns false, the expect throws, and these swallow any late
    // rejection so it cannot surface as an unhandled error in the next test.
    // Do not await — a stalled chain under fake timers must not hang cleanup.
    runPromise?.catch(() => {});
    runRejection?.catch(() => {});
    await scope?.dispose();
  }
}

function mockFailingCompletedToolPersistence(
  getMockSendMessageStream: () => StreamMock,
  recordCompletedToolCalls: () => never,
): void {
  (
    ChatSession as unknown as Mock<(...args: never[]) => unknown>
  ).mockImplementationOnce(
    (runtime: AgentRuntimeContext) =>
      ({
        getStreamTimeoutPolicy: () => runtime.readStreamTimeoutPolicy(),
        shouldShowCitations: () => runtime.showCitations(),
        getResolvedBaseUrl: () => undefined,
        sendMessageStream: getMockSendMessageStream(),
        recordCompletedToolCalls,
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
}

function installStalledDisposeStream(
  getMockSendMessageStream: () => StreamMock,
): () => AbortSignal | undefined {
  let capturedSignal: AbortSignal | undefined;
  getMockSendMessageStream().mockImplementation(
    async ({
      config: messageConfig,
    }: {
      config: { abortSignal: AbortSignal };
    }) => {
      capturedSignal = messageConfig.abortSignal;
      return (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'partial' }),
        };
        await new Promise<void>(() => {});
      })();
    },
  );
  return () => capturedSignal;
}

function makeCompletedCalls() {
  return [
    {
      status: 'success' as const,
      request: {
        callId: 'call-best-effort',
        name: 'external_tool',
        args: {},
      },
      tool: {
        name: 'external_tool',
        description: 'External tool',
        canUpdateOutput: false,
        schema: { parameters: { type: 'object', properties: {} } },
        build: vi.fn(),
      },
      response: {
        callId: 'call-best-effort',
        responseParts: [{ text: 'tool output' }],
        resultDisplay: 'tool output',
      },
      invocation: { execute: vi.fn() },
    },
  ];
}

function trackSettlement(promise: Promise<unknown>): () => boolean {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
}
