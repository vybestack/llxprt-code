/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  SubagentOrchestrator,
  SubagentLaunchRequest,
} from '../core/subagentOrchestrator.js';
import type { SubAgentScope } from '../core/subagent.js';
import { type ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
import { type ToolResult, ToolErrorType } from '@vybestack/llxprt-code-tools';
import { type TaskToolInvocationParams } from './taskToolGovernance.js';
import {
  handleBackgroundAbort,
  readEphemeralSettings,
  setupAsyncTimeout,
  setupForegroundRelay,
} from './taskAbortHelpers.js';
import { createErrorResult } from './taskResultHelpers.js';

export interface AsyncSetupResult {
  launchResult: Awaited<ReturnType<SubagentOrchestrator['launch']>>;
  agentId: string;
  scope: SubAgentScope;
  contextState: ContextState;
  dispose: () => Promise<void>;
  asyncAbortController: AbortController;
  timeoutId: NodeJS.Timeout | null;
  timedOut: { value: boolean };
  cleanupForegroundRelay: () => void;
}

/** Collaborators needed to run an async task. */
export interface AsyncTaskCollaborators {
  config: Config;
  normalized: TaskToolInvocationParams;
  params: { timeout_seconds?: number; grace_period_seconds?: number };
  createOrchestrator: () => SubagentOrchestrator;
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
  isInteractiveEnvironment?: () => boolean;
  getSchedulerFactory?: () => SubagentSchedulerFactory | undefined;
  buildLaunchRequest: (params: {
    timeout_seconds?: number;
    grace_period_seconds?: number;
  }) => SubagentLaunchRequest;
  buildContextState: () => ContextState;
}

/** Normalizes a streaming text fragment to a single trailing newline. */
export function normalizeSubagentStreamingText(text: string): string {
  if (!text) {
    return '';
  }
  const lf = text.replace(/\r\n?/g, '\n');
  return lf.endsWith('\n') ? lf : lf + '\n';
}

/**
 * Reads global + ephemeral settings to determine whether async subagents are
 * enabled. Returns an error `ToolResult` when disabled, otherwise `undefined`.
 *
 * Uses boundary-validation for `getSettingsService` because partial config
 * mocks omit the method even though the static `Config` type requires it.
 */
export function checkAsyncSettings(config: Config): ToolResult | undefined {
  const settingsService =
    typeof config.getSettingsService === 'function'
      ? config.getSettingsService()
      : undefined;
  const globalSettings =
    settingsService &&
    typeof settingsService.getAllGlobalSettings === 'function'
      ? settingsService.getAllGlobalSettings()
      : {};
  const subagentsSettings = globalSettings['subagents'] as
    | { asyncEnabled?: boolean; maxAsync?: number }
    | undefined;
  const globalAsyncEnabled = subagentsSettings?.asyncEnabled !== false;
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

  const ephemeralSettings = readEphemeralSettings(config);
  const profileAsyncEnabled =
    ephemeralSettings['subagents.async.enabled'] !== false;
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
export function resolveAsyncContext(collaborators: AsyncTaskCollaborators):
  | ToolResult
  | {
      asyncTaskManager: AsyncTaskManager;
      orchestrator: SubagentOrchestrator;
      bookingId: string;
    } {
  const settingsCheck = checkAsyncSettings(collaborators.config);
  if (settingsCheck) {
    return settingsCheck;
  }

  const asyncTaskManager = collaborators.getAsyncTaskManager?.();
  if (asyncTaskManager === undefined) {
    return {
      llmContent: 'Async mode requires AsyncTaskManager to be configured.',
      returnDisplay: 'Error: Async mode not available.',
      error: {
        message: 'AsyncTaskManager not configured',
        type: ToolErrorType.EXECUTION_FAILED,
      },
    };
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
 * Sets up the async infrastructure: relays the foreground signal, launches the
 * subagent, registers the task, and arms the timeout. Returns either an error
 * `ToolResult` (on launch failure) or the `AsyncSetupResult`.
 */
export async function setupAsyncInfrastructure(
  collaborators: AsyncTaskCollaborators,
  foregroundSignal: AbortSignal,
  orchestrator: SubagentOrchestrator,
  asyncTaskManager: AsyncTaskManager,
  bookingId: string | undefined,
): Promise<(AsyncSetupResult & { error?: undefined }) | ToolResult> {
  let launchResult: Awaited<ReturnType<SubagentOrchestrator['launch']>>;
  let agentId: string | undefined;
  let scope: SubAgentScope;
  let contextState: ContextState;
  let dispose: (() => Promise<void>) | undefined;
  const asyncAbortController = new AbortController();
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

  try {
    const launchRequest = collaborators.buildLaunchRequest(
      collaborators.params,
    );
    launchResult = await orchestrator.launch(
      launchRequest,
      asyncAbortController.signal,
    );
    agentId = launchResult.agentId;
    scope = launchResult.scope;
    dispose = launchResult.dispose;
    contextState = collaborators.buildContextState();

    const timeoutSetup = setupAsyncTimeout(
      collaborators.config,
      collaborators.params.timeout_seconds,
      asyncAbortController,
      timedOut,
    );
    timeoutId = timeoutSetup.timeoutId;

    asyncTaskManager.registerTask(
      {
        id: agentId,
        subagentName: collaborators.normalized.subagentName,
        goalPrompt: collaborators.normalized.goalPrompt,
        abortController: asyncAbortController,
      },
      bookingId,
    );
    taskRegistered = true;
  } catch (error) {
    cleanupForegroundRelay();
    if (!taskRegistered && bookingId) {
      asyncTaskManager.cancelReservation(bookingId);
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (dispose) {
      // Defensively swallow disposal errors on the partial-launch path so a
      // rejecting dispose() cannot surface as an unhandled rejection.
      void dispose().catch(() => {});
    }
    return createErrorResult(
      error,
      `Failed to launch async subagent '${collaborators.normalized.subagentName}'.`,
    );
  }

  return {
    launchResult,
    agentId,
    scope,
    contextState,
    dispose,
    asyncAbortController,
    timeoutId,
    timedOut,
    cleanupForegroundRelay,
  };
}

/**
 * Sets up async streaming XML tags and message relay. Returns `undefined` when
 * no `updateOutput` callback was supplied.
 */
export function setupAsyncStreaming(
  subagentName: string,
  scope: SubAgentScope,
  agentId: string,
  updateOutput?: (output: string) => void,
): { emitAsyncClosingSubagentTag: () => void } | undefined {
  if (!updateOutput) return undefined;

  let asyncXmlOutputOpen = false;
  const emitAsyncClosingSubagentTag = () => {
    if (!asyncXmlOutputOpen) {
      return;
    }
    updateOutput(`</subagent name="${subagentName}" id="${agentId}">\n`);
    asyncXmlOutputOpen = false;
  };

  updateOutput(`<subagent name="${subagentName}" id="${agentId}">\n`);
  asyncXmlOutputOpen = true;

  const existingHandler = scope.onMessage;
  scope.onMessage = (message: string) => {
    const cleaned = normalizeSubagentStreamingText(message);
    if (cleaned.trim().length > 0) {
      updateOutput(cleaned);
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
  emitClosingSubagentTag?: () => void,
  cleanupForegroundRelay?: () => void,
  timedOut?: { value: boolean },
): void {
  void (async () => {
    try {
      const environmentInteractive =
        collaborators.isInteractiveEnvironment?.() ?? true;

      if (
        environmentInteractive &&
        typeof scope.runInteractive === 'function'
      ) {
        const schedulerFactory = collaborators.getSchedulerFactory?.();
        const interactiveOptions = schedulerFactory
          ? { schedulerFactory }
          : undefined;
        await scope.runInteractive(contextState, interactiveOptions);
      } else {
        await scope.runNonInteractive(contextState);
      }

      if (signal.aborted) {
        handleBackgroundAbort(
          asyncTaskManager,
          agentId,
          timedOut?.value === true,
        );
        return;
      }

      const output = scope.output;

      asyncTaskManager.completeTask(agentId, output);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      asyncTaskManager.failTask(agentId, errorMessage);
    } finally {
      emitClosingSubagentTag?.();

      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      cleanupForegroundRelay?.();

      try {
        await dispose();
      } catch {
        // Swallow dispose errors
      }
    }
  })();
}

/**
 * Orchestrates the full async execution path: validate preconditions, set up
 * infrastructure, stream, and kick off background execution. Returns the
 * "task launched" `ToolResult` immediately.
 */
export async function executeAsyncTask(
  collaborators: AsyncTaskCollaborators,
  signal: AbortSignal,
  updateOutput?: (output: string) => void,
): Promise<ToolResult> {
  const ctx = resolveAsyncContext(collaborators);
  if (!('asyncTaskManager' in ctx)) {
    return ctx;
  }
  const { asyncTaskManager, orchestrator, bookingId } = ctx;

  const setupResult = await setupAsyncInfrastructure(
    collaborators,
    signal,
    orchestrator,
    asyncTaskManager,
    bookingId,
  );
  if ('error' in setupResult && setupResult.error) {
    return setupResult;
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
  } = setupResult as AsyncSetupResult;

  const asyncStreaming = setupAsyncStreaming(
    collaborators.normalized.subagentName,
    scope,
    agentId,
    updateOutput,
  );

  executeInBackground(
    collaborators,
    scope,
    contextState,
    agentId,
    asyncTaskManager,
    dispose,
    asyncAbortController.signal,
    timeoutId,
    asyncStreaming?.emitAsyncClosingSubagentTag,
    cleanupForegroundRelay,
    timedOut,
  );

  return {
    llmContent:
      `Async task launched: subagent '${collaborators.normalized.subagentName}' (ID: ${agentId}). ` +
      `Task is running in background. Use 'check_async_tasks' to monitor progress.`,
    returnDisplay: `Async task started: **${collaborators.normalized.subagentName}** (\`${agentId}\`)`,
    metadata: {
      agentId,
      async: true,
      status: 'running',
    },
  };
}
