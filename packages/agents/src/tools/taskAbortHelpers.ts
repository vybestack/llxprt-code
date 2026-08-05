/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import type { SubagentLaunchRequest } from '../core/subagentOrchestrator.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  resolveTimeout as resolveSharedTimeout,
  describeTimeoutTermination,
  type TimeoutResolution,
} from '@vybestack/llxprt-code-tools/utils/timeoutResolution.js';

const abortLogger = new DebugLogger('llxprt:task');

// Tool timeout settings (Issue #1049)
export const DEFAULT_TASK_TIMEOUT_SECONDS = 900;
export const MAX_TASK_TIMEOUT_SECONDS = 1800;

/** Setting names surfaced to the model and to clamp/timeout notices. */
export const TASK_TIMEOUT_DEFAULT_SETTING = 'task-default-timeout-seconds';
export const TASK_TIMEOUT_MAX_SETTING = 'task-max-timeout-seconds';

/**
 * Reads ephemeral settings from the config using boundary-validation.
 *
 * The static `Config` type declares `getEphemeralSettings` as a required
 * method, but callers (and tests) routinely pass partial objects where the
 * method is absent. Validating with `typeof === 'function'` keeps the runtime
 * guard without tripping `@typescript-eslint/no-unnecessary-condition`.
 */
export function readEphemeralSettings(config: {
  getEphemeralSettings?: () => Record<string, unknown> | undefined;
}): Record<string, unknown> {
  return typeof config.getEphemeralSettings === 'function'
    ? (config.getEphemeralSettings() ?? {})
    : {};
}

/**
 * Resolves the effective timeout (seconds) from the requested value, the
 * configured default, and the configured maximum. Thin re-export of the
 * canonical shared helper so the ceiling semantics cannot drift between the
 * task, core-subagent, and shell tools (Issue #3031). Returns `undefined`
 * when the resolved timeout is unbounded (a maximum of -1/absent with an
 * unbounded ask).
 */
export function resolveTimeoutSeconds(
  requestedTimeoutSeconds: number | undefined,
  defaultTimeoutSeconds: number,
  maxTimeoutSeconds: number,
): number | undefined {
  return resolveSharedTimeout(
    requestedTimeoutSeconds,
    defaultTimeoutSeconds,
    maxTimeoutSeconds,
  ).effectiveTimeoutSeconds;
}

/**
 * Resolves the full timeout outcome (effective seconds + clamping flag) from
 * the config's ephemeral settings. Used by the task tool so it can surface
 * clamping in the result and message.
 */
export function resolveTimeoutResolutionFromConfig(
  config: {
    getEphemeralSettings?: () => Record<string, unknown> | undefined;
  },
  requestedTimeoutSeconds: number | undefined,
): TimeoutResolution {
  const settings = readEphemeralSettings(config);
  const defaultTimeoutSeconds =
    (settings[TASK_TIMEOUT_DEFAULT_SETTING] as number | undefined) ??
    DEFAULT_TASK_TIMEOUT_SECONDS;
  const maxTimeoutSeconds =
    (settings[TASK_TIMEOUT_MAX_SETTING] as number | undefined) ??
    MAX_TASK_TIMEOUT_SECONDS;
  return resolveSharedTimeout(
    requestedTimeoutSeconds,
    defaultTimeoutSeconds,
    maxTimeoutSeconds,
  );
}

/**
 * Resolves timeout seconds from the config's ephemeral settings, applying the
 * default and maximum bounds configured there.
 */
export function resolveTimeoutFromConfig(
  config: {
    getEphemeralSettings?: () => Record<string, unknown> | undefined;
  },
  requestedTimeoutSeconds: number | undefined,
): number | undefined {
  return resolveTimeoutResolutionFromConfig(config, requestedTimeoutSeconds)
    .effectiveTimeoutSeconds;
}

export interface TimeoutControllers {
  timeoutMs?: number;
  timeoutSeconds?: number;
  /** Full resolution outcome, used to surface clamping in results (Issue #3031). */
  resolution: TimeoutResolution;
  timeoutController: AbortController;
  timeoutId: ReturnType<typeof setTimeout> | null;
  onUserAbort: () => void;
}

/**
 * Creates the foreground timeout controllers and wires the user-provided abort
 * signal so that an external abort also fires the timeout controller (and
 * clears any pending timeout).
 */
export function createTimeoutControllers(
  config: {
    getEphemeralSettings?: () => Record<string, unknown> | undefined;
  },
  signal: AbortSignal,
  requestedTimeoutSeconds: number | undefined,
): TimeoutControllers {
  const resolution = resolveTimeoutResolutionFromConfig(
    config,
    requestedTimeoutSeconds,
  );
  const timeoutSeconds = resolution.effectiveTimeoutSeconds;
  const timeoutMs =
    timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;
  const timeoutController = new AbortController();
  const timeoutId =
    timeoutMs === undefined
      ? null
      : setTimeout(() => timeoutController.abort(), timeoutMs);

  const onUserAbort = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutController.abort();
  };

  signal.addEventListener('abort', onUserAbort, { once: true });

  return {
    timeoutMs,
    timeoutSeconds,
    resolution,
    timeoutController,
    timeoutId,
    onUserAbort,
  };
}

/**
 * Returns true when the error (if any) is a timeout: the timeout controller
 * aborted while the foreground signal did not, and the error is either absent
 * or an AbortError.
 */
export function isTimeoutError(
  signal: AbortSignal,
  timeoutController: AbortController,
  isAbortError: (error: unknown) => boolean,
  error?: unknown,
): boolean {
  if (!timeoutController.signal.aborted || signal.aborted) {
    return false;
  }
  if (error === undefined || error === null) {
    return true;
  }
  return isAbortError(error);
}

/**
 * Returns true when the given error is an `AbortError` (by `name` property).
 */
export function isAbortError(error: unknown): boolean {
  if (error === null || error === undefined || typeof error !== 'object') {
    return false;
  }
  const result = (error as { name?: string }).name === 'AbortError';
  return result;
}

export interface AbortState {
  aborted: { aborted: boolean; timedOut: boolean };
  abortHandler: () => void;
  removeAbortHandler: () => void;
  setLaunchResult: (
    result: Awaited<ReturnType<SubagentOrchestrator['launch']>>,
  ) => void;
}

/**
 * Creates the abort-state closure used during synchronous launch. The abort
 * handler cancels the live subagent scope (if one has been set) when the
 * foreground signal fires.
 */
export function createAbortState(
  launchRequest: SubagentLaunchRequest,
  signal: AbortSignal,
): AbortState {
  const state = { aborted: false, timedOut: false };
  let liveScope:
    | Awaited<ReturnType<SubagentOrchestrator['launch']>>
    | undefined;
  const abortHandler = () => {
    if (state.aborted) return;
    state.aborted = true;
    abortLogger.warn(
      () => `Cancellation requested for subagent '${launchRequest.name}'`,
    );
    try {
      const candidate = liveScope?.scope as
        | { cancel?: (reason?: string) => void }
        | undefined;
      candidate?.cancel?.('User aborted task execution.');
    } catch (error) {
      abortLogger.warn(
        () =>
          `Error while cancelling subagent '${launchRequest.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const removeAbortHandler = () => {
    signal.removeEventListener('abort', abortHandler);
  };
  const setLaunchResult = (
    result: Awaited<ReturnType<SubagentOrchestrator['launch']>>,
  ) => {
    liveScope = result;
  };
  return {
    aborted: state,
    abortHandler,
    removeAbortHandler,
    setLaunchResult,
  };
}

/**
 * Handles the background task after the scope run completes with an aborted
 * signal. Distinguishes timeout (failTask) from user-initiated cancellation
 * (cancelTask, idempotent). Only acts if the task is still 'running' so a
 * prior cancelTask is not overwritten.
 */
export function handleBackgroundAbort(
  asyncTaskManager: {
    getTask: (agentId: string) => { status: string } | undefined;
    failTask: (agentId: string, reason: string) => void;
    cancelTask: (agentId: string) => void;
  },
  agentId: string,
  timedOut: boolean,
  resolution: TimeoutResolution,
): void {
  const task = asyncTaskManager.getTask(agentId);
  if (task?.status !== 'running') return;
  if (timedOut) {
    asyncTaskManager.failTask(
      agentId,
      describeTimeoutTermination(resolution.effectiveTimeoutSeconds, {
        defaultSetting: TASK_TIMEOUT_DEFAULT_SETTING,
        maxSetting: TASK_TIMEOUT_MAX_SETTING,
      }),
    );
  } else {
    asyncTaskManager.cancelTask(agentId);
  }
}

/**
 * Sets up an async timeout that aborts the provided controller and records the
 * timeout in the shared `timedOut` flag. Returns the pending timeout id (or
 * null when timeouts are disabled).
 */
export function setupAsyncTimeout(
  config: {
    getEphemeralSettings?: () => Record<string, unknown> | undefined;
  },
  requestedTimeoutSeconds: number | undefined,
  asyncAbortController: AbortController,
  timedOut: { value: boolean },
): {
  timeoutId: NodeJS.Timeout | null;
  resolution: TimeoutResolution;
} {
  const resolution = resolveTimeoutResolutionFromConfig(
    config,
    requestedTimeoutSeconds,
  );
  const timeoutMs =
    resolution.effectiveTimeoutSeconds === undefined
      ? undefined
      : resolution.effectiveTimeoutSeconds * 1000;
  const timeoutId =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut.value = true;
          asyncAbortController.abort();
        }, timeoutMs);

  return { timeoutId, resolution };
}

/**
 * Wires the foreground turn's abort signal into the async abort controller so
 * that ESC (which aborts the foreground turn) also cancels the detached
 * subagent. Returns a cleanup function that removes the listener.
 */
export function setupForegroundRelay(
  foregroundSignal: AbortSignal,
  asyncAbortController: AbortController,
): () => void {
  const relayForegroundAbort = () => asyncAbortController.abort();
  if (foregroundSignal.aborted) {
    asyncAbortController.abort();
  } else {
    foregroundSignal.addEventListener('abort', relayForegroundAbort, {
      once: true,
    });
  }
  return () => {
    foregroundSignal.removeEventListener('abort', relayForegroundAbort);
  };
}
