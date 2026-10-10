/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  TaskLaunchOwner,
  TaskLaunch,
} from '../session/task-launch-owner.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  SubagentOrchestrator,
  SubagentLaunchRequest,
} from '../core/subagentOrchestrator.js';
import type { SubAgentScope } from '../core/subagent.js';
import { type ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { AgentDisplayCallbacks } from '../api/agent.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { createStreamNormalizer } from '@vybestack/llxprt-code-tools/utils/textDelta.js';
import {
  type ToolResult,
  type LiveOutputUpdate,
} from '@vybestack/llxprt-code-tools';
import { type TaskToolInvocationParams } from './taskToolGovernance.js';
import {
  handleBackgroundAbort,
  setupAsyncTimeout,
  setupForegroundRelay,
  TASK_TIMEOUT_DEFAULT_SETTING,
  TASK_TIMEOUT_MAX_SETTING,
} from './taskAbortHelpers.js';
import {
  attachTimeoutMetadata,
  createErrorResult,
  createTimeoutResult,
} from './taskResultHelpers.js';
import {
  describeTimeoutTermination,
  requireEffectiveTimeoutSeconds,
  type TimeoutResolution,
} from '@vybestack/llxprt-code-tools/utils/timeoutResolution.js';

export interface AsyncSetupResult {
  agentId: string;
  scope: SubAgentScope;
  contextState: ContextState;
  dispose: () => Promise<void>;
  asyncAbortController: AbortController;
  timeoutId: NodeJS.Timeout | null;
  timedOut: { value: boolean };
  cleanupForegroundRelay: () => void;
  resolution: TimeoutResolution;
}

/** Collaborators needed to run an async task. */
export interface AsyncTaskCollaborators {
  taskLaunchOwner?: TaskLaunchOwner;
  config: Config;
  readTaskPolicy: () => Readonly<{
    'task-default-timeout-seconds'?: unknown;
    'task-max-timeout-seconds'?: unknown;
    globalAsyncEnabled: boolean;
    profileAsyncEnabled: boolean;
  }>;
  normalized: TaskToolInvocationParams;
  params: { timeout_seconds?: number; grace_period_seconds?: number };
  createOrchestrator: () => SubagentOrchestrator;
  isInteractiveEnvironment?: () => boolean;
  openChildDisplay?: () => AgentDisplayCallbacks;
  buildLaunchRequest: (timeoutMs?: number) => SubagentLaunchRequest;
  buildContextState: () => ContextState;
}

/**
 * Normalizes line endings in a streaming text fragment without forcing a
 * trailing newline. Earlier versions appended '\n' to every fragment, but
 * that broke LLM token streaming — each word landed on its own line. The
 * LLM's own whitespace and newlines are authoritative; we only normalize
 * carriage-return variants to '\n'.
 *
 * Preserved for backward compatibility. Prefer `toLosslessTextDelta` for an
 * isolated single delta (stateless CR/CRLF→LF), or `createStreamNormalizer`
 * for a stream spanning chunk boundaries (correctly joins a CRLF pair split
 * across consecutive deltas and flushes a trailing lone CR on close).
 */
export function normalizeSubagentStreamingText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Reads global + ephemeral settings to determine whether async subagents are
 * enabled. Returns an error `ToolResult` when disabled, otherwise `undefined`.
 */
export function checkAsyncSettings(
  policy: Readonly<{
    globalAsyncEnabled: boolean;
    profileAsyncEnabled: boolean;
  }>,
): ToolResult | undefined {
  const globalAsyncEnabled = policy.globalAsyncEnabled;
  if (!globalAsyncEnabled) {
    return {
      llmContent:
        'Async subagents are globally disabled via /settings. Enable "Async Subagents Enabled" in /settings to use async mode.',
      returnDisplay: 'Error: Async subagents are globally disabled.',
      error: {
        message: 'Async subagents are globally disabled via /settings.',
        type: ToolErrorType.EXECUTION_FAILED,
      },
    };
  }

  const profileAsyncEnabled = policy.profileAsyncEnabled;
  if (!profileAsyncEnabled) {
    return {
      llmContent:
        'This profile disables async subagents. Re-enable with: /set subagents.async.enabled true',
      returnDisplay: 'Error: Async subagents disabled in profile.',
      error: {
        message: 'Async subagents disabled in active profile.',
        type: ToolErrorType.EXECUTION_FAILED,
      },
    };
  }

  return undefined;
}

/**
 * Builds the "no async slot available" `ToolResult`.
 */
export function createAsyncSlotResult(
  asyncTaskManager: AsyncTaskManager,
): ToolResult {
  const canLaunch = asyncTaskManager.canLaunchAsync();
  const baseReason = canLaunch.reason ?? 'Async task limit reached';
  const guidance =
    'You can: (1) wait for running async tasks to complete using check_async_tasks, ' +
    '(2) launch this subagent synchronously (without async: true), or ' +
    '(3) try again later when a slot is available.';
  const errorMessage = `${baseReason}. ${guidance}`;
  return {
    llmContent: errorMessage,
    returnDisplay: baseReason,
    error: {
      message: baseReason,
      type: ToolErrorType.EXECUTION_FAILED,
    },
  };
}

/**
 * Validates async preconditions and reserves a booking slot. Returns either
 * an error ToolResult or the validated orchestrator + task manager + booking id.
 */
export function resolveAsyncContext(
  collaborators: AsyncTaskCollaborators,
  asyncTaskManager: AsyncTaskManager,
):
  | ToolResult
  | {
      asyncTaskManager: AsyncTaskManager;
      orchestrator: SubagentOrchestrator;
      bookingId: string;
    } {
  const settingsCheck = checkAsyncSettings(collaborators.readTaskPolicy());
  if (settingsCheck) {
    return settingsCheck;
  }

  let orchestrator: SubagentOrchestrator;
  try {
    orchestrator = collaborators.createOrchestrator();
  } catch (error) {
    return createErrorResult(
      error,
      'Failed to create orchestrator for async task.',
    );
  }

  const bookingId = asyncTaskManager.tryReserveAsyncSlot();
  if (!bookingId) {
    return createAsyncSlotResult(asyncTaskManager);
  }

  return { asyncTaskManager, orchestrator, bookingId };
}

/**
 * Cleans up partially-allocated async resources after a failed launch:
 * foreground relay, slot reservation, timeout timer, and scope disposal.
 */
async function cleanupFailedAsyncLaunch(
  primaryError: unknown,
  cleanupForegroundRelay: () => void,
  taskRegistered: boolean,
  bookingId: string | undefined,
  asyncTaskManager: AsyncTaskManager,
  timeoutId: NodeJS.Timeout | null,
  dispose: (() => Promise<void>) | undefined,
): Promise<void> {
  try {
    await cleanupAsyncSteps([
      cleanupForegroundRelay,
      () => {
        if (!taskRegistered && bookingId) {
          asyncTaskManager.cancelReservation(bookingId);
        }
      },
      () => {
        if (timeoutId) clearTimeout(timeoutId);
      },
      async () => {
        await dispose?.();
      },
    ]);
  } catch (cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Async launch and cleanup failed',
    );
  }
}

function effectiveTimeoutMs(resolution: TimeoutResolution): number | undefined {
  return resolution.effectiveTimeoutSeconds === undefined
    ? undefined
    : resolution.effectiveTimeoutSeconds * 1000;
}

/**
 * Builds the TIMEOUT `ToolResult` for a timeout that fires during async launch.
 * The legible message names the effective bound and the raisable settings
 * (Issue #3031), distinct from the raw AbortError text.
 */
function createLaunchTimeoutResult(resolution: TimeoutResolution): ToolResult {
  return attachTimeoutMetadata(
    createTimeoutResult(requireEffectiveTimeoutSeconds(resolution)),
    resolution,
    {
      defaultSetting: TASK_TIMEOUT_DEFAULT_SETTING,
      maxSetting: TASK_TIMEOUT_MAX_SETTING,
    },
  );
}

/**
 * Sets up the async infrastructure: relays the foreground signal, launches the
 * subagent, registers the task, and arms the timeout. Returns either an error
 * `ToolResult` (on launch failure) or the `AsyncSetupResult`.
 */
function registerLaunchedTask(
  manager: AsyncTaskManager,
  id: string,
  task: TaskToolInvocationParams,
  launch: TaskLaunch,
  bookingId: string | undefined,
): void {
  manager.registerTask(
    {
      id,
      subagentName: task.subagentName,
      goalPrompt: task.goalPrompt,
      abortController: launch.controller,
    },
    bookingId,
  );
  launch.register(id);
}

export async function setupAsyncInfrastructure(
  collaborators: AsyncTaskCollaborators,
  foregroundSignal: AbortSignal,
  orchestrator: SubagentOrchestrator,
  asyncTaskManager: AsyncTaskManager,
  bookingId: string | undefined,
  launch: TaskLaunch,
): Promise<(AsyncSetupResult & { error?: undefined }) | ToolResult> {
  let dispose: (() => Promise<void>) | undefined;
  const asyncAbortController = launch.controller;
  let timeoutId: NodeJS.Timeout | null = null;
  let taskRegistered = false;
  const timedOut = { value: false };

  // Relay the foreground signal BEFORE launch so an ESC pressed while the
  // orchestrator is still loading config/profile (issue #2074) aborts the
  // launch in-flight instead of being missed during that window.
  const cleanupForegroundRelay = setupForegroundRelay(
    foregroundSignal,
    asyncAbortController,
  );

  // Arm the timeout BEFORE launch so the abort signal bounds it; carrying the
  // full resolution lets the result and timeout failure report the bound (#3031).
  let resolution: TimeoutResolution | undefined;
  try {
    asyncAbortController.signal.throwIfAborted();
    const timeoutSetup = setupAsyncTimeout(
      collaborators.readTaskPolicy(),
      collaborators.params.timeout_seconds,
      asyncAbortController,
      timedOut,
    );
    timeoutId = timeoutSetup.timeoutId;
    resolution = timeoutSetup.resolution;
    const timeoutMs = effectiveTimeoutMs(resolution);

    const launchRequest = collaborators.buildLaunchRequest(timeoutMs);
    const launchResult = await orchestrator.launch(
      launchRequest,
      asyncAbortController.signal,
    );
    const { agentId, scope } = launchResult;
    dispose = launchResult.dispose;
    asyncAbortController.signal.throwIfAborted();
    const contextState = collaborators.buildContextState();

    registerLaunchedTask(
      asyncTaskManager,
      agentId,
      collaborators.normalized,
      launch,
      bookingId,
    );
    taskRegistered = true;
    cleanupForegroundRelay();
    return {
      agentId,
      scope,
      contextState,
      dispose,
      asyncAbortController,
      timeoutId,
      timedOut,
      cleanupForegroundRelay,
      resolution,
    };
  } catch (error) {
    await cleanupFailedAsyncLaunch(
      error,
      cleanupForegroundRelay,
      taskRegistered,
      bookingId,
      asyncTaskManager,
      timeoutId,
      dispose,
    );
    if (timedOut.value && resolution) {
      return createLaunchTimeoutResult(resolution);
    }
    return createErrorResult(
      error,
      `Failed to launch async subagent '${collaborators.normalized.subagentName}'.`,
    );
  }
}

/**
 * Sets up async streaming XML tags and message relay. Returns `undefined` when
 * no `updateOutput` callback was supplied.
 */
export function setupAsyncStreaming(
  subagentName: string,
  scope: SubAgentScope,
  agentId: string,
  updateOutput?: (update: LiveOutputUpdate) => void,
): { emitAsyncClosingSubagentTag: () => void } | undefined {
  if (!updateOutput) return undefined;

  const normalizer = createStreamNormalizer();
  let asyncXmlOutputOpen = false;
  const emitAppend = (data: string): void => {
    updateOutput({ mode: 'append', data });
  };
  const emitAsyncClosingSubagentTag = () => {
    if (!asyncXmlOutputOpen) {
      return;
    }
    const flushed = normalizer.flush();
    if (flushed !== undefined) {
      emitAppend(flushed);
    }
    emitAppend(`</subagent name="${subagentName}" id="${agentId}">\n`);
    asyncXmlOutputOpen = false;
  };

  emitAppend(`<subagent name="${subagentName}" id="${agentId}">\n`);
  asyncXmlOutputOpen = true;

  const existingHandler = scope.onMessage;
  scope.onMessage = (message: string) => {
    const delta = normalizer.push(message);
    if (delta !== undefined) {
      emitAppend(delta);
    }
    existingHandler?.(message);
  };

  return { emitAsyncClosingSubagentTag };
}

/**
 * @plan PLAN-20260130-ASYNCTASK.P11
 *
 * Execute async task in background using the SAME execution path as sync tasks.
 * The only difference is the foreground agent doesn't wait for completion.
 * - Interactive environment → runInteractive() with shared scheduler
 * - Non-interactive environment → runNonInteractive()
 */
export function executeInBackground(
  collaborators: AsyncTaskCollaborators,
  scope: SubAgentScope,
  contextState: ContextState,
  agentId: string,
  asyncTaskManager: AsyncTaskManager,
  dispose: () => Promise<void>,
  signal: AbortSignal,
  timeoutId: ReturnType<typeof setTimeout> | null,
  resolution: TimeoutResolution,
  emitClosingSubagentTag?: () => void,
  cleanupForegroundRelay?: () => void,
  timedOut?: { value: boolean },
): Promise<void> {
  return (async () => {
    try {
      const environmentInteractive =
        collaborators.isInteractiveEnvironment?.() ?? true;

      if (
        environmentInteractive &&
        typeof scope.runInteractive === 'function'
      ) {
        const interactiveOptions = {
          displayCallbacks: collaborators.openChildDisplay?.(),
        };
        await scope.runInteractive(contextState, interactiveOptions);
      } else {
        await scope.runNonInteractive(contextState);
      }

      if (signal.aborted) {
        handleBackgroundAbort(
          asyncTaskManager,
          agentId,
          timedOut?.value === true,
          resolution,
        );
        return;
      }

      const output = scope.output;

      asyncTaskManager.completeTask(agentId, output);
    } catch (error) {
      if (signal.aborted && timedOut?.value === true) {
        // A timeout-caused rejection produces a legible failure naming the
        // effective bound and the raisable settings (Issue #3031), distinct
        // from the raw AbortError text.
        asyncTaskManager.failTask(
          agentId,
          describeTimeoutTermination(
            requireEffectiveTimeoutSeconds(resolution),
            {
              defaultSetting: TASK_TIMEOUT_DEFAULT_SETTING,
              maxSetting: TASK_TIMEOUT_MAX_SETTING,
            },
          ),
        );
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      asyncTaskManager.failTask(agentId, errorMessage);
    } finally {
      await cleanupAsyncSteps([
        () => emitClosingSubagentTag?.(),
        () => {
          if (timeoutId !== null) clearTimeout(timeoutId);
        },
        () => cleanupForegroundRelay?.(),
        dispose,
      ]);
    }
  })();
}

/**
 * Orchestrates the full async execution path: validate preconditions, set up
 * infrastructure, stream, and kick off background execution. Returns the
 * "task launched" `ToolResult` immediately.
 */
async function cleanupAsyncSteps(
  steps: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'Async task cleanup failed');
}

function createAcceptedResult(
  subagentName: string,
  agentId: string,
  resolution: TimeoutResolution,
): ToolResult {
  return attachTimeoutMetadata(
    {
      llmContent:
        `Async task launched: subagent '${subagentName}' (ID: ${agentId}). ` +
        `Task is running in background. Use 'check_async_tasks' to monitor progress.`,
      returnDisplay: `Async task started: **${subagentName}** (\`${agentId}\`)`,
      metadata: { agentId, async: true, status: 'running' },
    },
    resolution,
    {
      defaultSetting: TASK_TIMEOUT_DEFAULT_SETTING,
      maxSetting: TASK_TIMEOUT_MAX_SETTING,
    },
  );
}

async function startAsyncStreaming(
  collaborators: AsyncTaskCollaborators,
  setup: AsyncSetupResult,
  manager: AsyncTaskManager,
  updateOutput?: (update: LiveOutputUpdate) => void,
): Promise<ReturnType<typeof setupAsyncStreaming>> {
  try {
    return setupAsyncStreaming(
      collaborators.normalized.subagentName,
      setup.scope,
      setup.agentId,
      updateOutput,
    );
  } catch (error) {
    manager.failTask(
      setup.agentId,
      error instanceof Error ? error.message : String(error),
    );
    await cleanupFailedAsyncLaunch(
      error,
      setup.cleanupForegroundRelay,
      true,
      undefined,
      manager,
      setup.timeoutId,
      setup.dispose,
    );
    throw error;
  }
}

export function executeAsyncTask(
  collaborators: AsyncTaskCollaborators,
  signal: AbortSignal,
  updateOutput?: (update: LiveOutputUpdate) => void,
): Promise<ToolResult> {
  const owner = collaborators.taskLaunchOwner;
  if (!owner)
    return Promise.resolve({
      llmContent: 'Async task requires an Agent task launch owner.',
      returnDisplay: 'Error: Async task is not bound to an Agent.',
      error: {
        message: 'Async task requires an Agent task launch owner',
        type: ToolErrorType.EXECUTION_FAILED,
      },
    });
  return owner.start(async (launch, publish) => {
    const ctx = resolveAsyncContext(collaborators, owner.manager);
    if (!('asyncTaskManager' in ctx)) {
      publish(ctx);
      return;
    }
    const { asyncTaskManager, orchestrator, bookingId } = ctx;
    const setup = await setupAsyncInfrastructure(
      collaborators,
      signal,
      orchestrator,
      asyncTaskManager,
      bookingId,
      launch,
    );
    if (!('scope' in setup)) {
      publish(setup);
      return;
    }
    const {
      agentId,
      scope,
      contextState,
      dispose,
      asyncAbortController,
      timeoutId,
      timedOut,
      cleanupForegroundRelay,
      resolution,
    } = setup;
    const streaming = await startAsyncStreaming(
      collaborators,
      setup,
      asyncTaskManager,
      updateOutput,
    );
    publish(
      createAcceptedResult(
        collaborators.normalized.subagentName,
        agentId,
        resolution,
      ),
    );
    await executeInBackground(
      collaborators,
      scope,
      contextState,
      agentId,
      asyncTaskManager,
      dispose,
      asyncAbortController.signal,
      timeoutId,
      resolution,
      streaming?.emitAsyncClosingSubagentTag,
      cleanupForegroundRelay,
      timedOut,
    );
  });
}
