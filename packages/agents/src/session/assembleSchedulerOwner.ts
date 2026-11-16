/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SchedulerCallbacks } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import {
  CoreToolScheduler,
  type CoreToolSchedulerOptions,
} from '../core/coreToolScheduler.js';
import { wrapRegistryWithConfirmation } from '../api/confirmationForcing.js';
import { wrapSchedulerFactory } from '../api/agentBootstrap.js';
import type {
  AgentSchedulerFactory,
  AgentSchedulerHandle,
} from '../api/config-types.js';
import { SessionSchedulerOwner } from './sessionSchedulerOwner.js';
import type {
  NestedCodeModeInputs,
  NestedExecutionComposition,
} from '../scheduler/nested-execution.js';
import { logToolScriptRun } from '@vybestack/llxprt-code-core/telemetry/loggers.js';

export type SchedulerConstruction = (
  options: CoreToolSchedulerOptions,
) => CoreToolScheduler;

const constructScheduler: SchedulerConstruction = (options) =>
  new CoreToolScheduler(options);

export function assembleSchedulerOwner(
  label: string,
  options: CoreToolSchedulerOptions,
  construct: SchedulerConstruction = constructScheduler,
): SessionSchedulerOwner {
  const captured = { ...options };
  let scheduler: CoreToolScheduler | undefined;
  return new SessionSchedulerOwner(
    label,
    () => {
      scheduler = construct(captured);
      return scheduler;
    },
    async () => {
      await scheduler?.joinExecutions();
    },
    () => scheduler?.hasPendingWork() ?? false,
  );
}

export function bindSchedulerOwner(
  config: CoreToolSchedulerOptions['config'],
  messageBus: CoreToolSchedulerOptions['messageBus'],
  interactiveMode: boolean,
  toolRegistry: CoreToolSchedulerOptions['toolRegistry'],
  construct: SchedulerConstruction,
  readExecutionPolicy: CoreToolSchedulerOptions['readExecutionPolicy'],
  getToolGovernance: CoreToolSchedulerOptions['getToolGovernance'],
  readApprovalMode: CoreToolSchedulerOptions['readApprovalMode'],
  telemetry: CoreToolSchedulerOptions['telemetry'],
  nested?: NestedCodeModeInputs,
): (callbacks: SchedulerCallbacks) => SessionSchedulerOwner {
  const label = config.getSessionId();
  const base: Omit<CoreToolSchedulerOptions, keyof SchedulerCallbacks> = {
    config,
    telemetry,
    readExecutionPolicy,
    readApprovalMode,
    getToolGovernance,
    messageBus,
    toolRegistry,
    toolContextInteractiveMode: interactiveMode,
  };
  const nestedExecution =
    nested === undefined
      ? undefined
      : composeNestedExecution(label, base, construct, nested);
  return (callbacks) =>
    assembleSchedulerOwner(
      label,
      {
        ...base,
        ...(nestedExecution === undefined ? {} : { nestedExecution }),
        ...callbacks,
      },
      construct,
    );
}

export type NestedSchedulerBase = Omit<
  CoreToolSchedulerOptions,
  keyof SchedulerCallbacks
>;

/**
 * The code mode composition of a caller's scheduler (issue #4084). Nested
 * runs get fresh schedulers from the same options but without a nested
 * composition, so a script cannot start another script. Used by the session
 * loop and by subagent schedulers.
 */
export function composeNestedExecution(
  label: string,
  base: NestedSchedulerBase,
  construct: SchedulerConstruction,
  inputs: NestedCodeModeInputs,
): NestedExecutionComposition {
  return {
    messageBus: base.messageBus,
    approval: inputs.approval,
    interactiveMode: base.toolContextInteractiveMode === true,
    selection: base.toolRegistry,
    readGovernance: base.getToolGovernance,
    createScheduler: (callbacks, { promptsAvailable }) =>
      assembleSchedulerOwner(
        `${label}#script`,
        {
          ...base,
          ...callbacks,
          confirmationPromptsAvailable: promptsAvailable,
        },
        construct,
      ),
    logScriptRun: (event) =>
      logToolScriptRun(base.config, event, base.telemetry),
    readCodeModeLimits: inputs.readCodeModeLimits,
    readDeadline: inputs.readDeadline ?? (() => undefined),
  };
}

/**
 * Resolves the agents-owned scheduler construction. When the caller
 * injects a factory, wraps it around the default (confirmation-forcing)
 * CoreToolScheduler and retains the handles for facade-level disposal. When no
 * factory is injected, uses the default directly.
 *
 * @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
 */
export function resolveSchedulerFactory(
  forceConfirmations: boolean,
  injected: AgentSchedulerFactory | undefined,
  injectedSchedulerHandles: AgentSchedulerHandle[],
): SchedulerConstruction {
  const defaultSchedulerFactory = createDefaultToolSchedulerFactory({
    forceConfirmations,
  });
  if (injected !== undefined) {
    // @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-006 @requirement:REQ-016
    // The caller injected a factory: each per-turn scheduler is still a real,
    // functioning CoreToolScheduler (built by defaultSchedulerFactory), while
    // the injected factory is invoked alongside and the handle it returns is
    // retained for facade-level disposal. The injected factory FUNCTION is
    // never disposed — only the handle instances it creates.
    return wrapSchedulerFactory(
      injected,
      defaultSchedulerFactory,
      injectedSchedulerHandles,
    );
  }
  return defaultSchedulerFactory;
}

/**
 * The DEFAULT tool scheduler factory injected by createAgent when the caller
 * supplies none. Constructs a {@link CoreToolScheduler} backed by the tool
 * registry, optionally wrapped so every tool surfaces a REAL confirmation (the
 * confirmation-forcing seam).
 *
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 * @pseudocode tool-confirmation-merge.md steps 10-31 (confirmation-forcing seam)
 */
function createDefaultToolSchedulerFactory(options: {
  readonly forceConfirmations: boolean;
}): SchedulerConstruction {
  return (schedulerOptions) => {
    const registry = options.forceConfirmations
      ? wrapRegistryWithConfirmation(schedulerOptions.toolRegistry)
      : schedulerOptions.toolRegistry;
    return new CoreToolScheduler({
      telemetry: schedulerOptions.telemetry,
      config: schedulerOptions.config,
      readExecutionPolicy: schedulerOptions.readExecutionPolicy,
      readApprovalMode: schedulerOptions.readApprovalMode,
      getToolGovernance: schedulerOptions.getToolGovernance,
      messageBus: schedulerOptions.messageBus,
      toolRegistry: registry,
      ...(schedulerOptions.outputUpdateHandler !== undefined
        ? { outputUpdateHandler: schedulerOptions.outputUpdateHandler }
        : {}),
      ...(schedulerOptions.onAllToolCallsComplete !== undefined
        ? { onAllToolCallsComplete: schedulerOptions.onAllToolCallsComplete }
        : {}),
      ...(schedulerOptions.onToolCallsUpdate !== undefined
        ? { onToolCallsUpdate: schedulerOptions.onToolCallsUpdate }
        : {}),
      getPreferredEditor: schedulerOptions.getPreferredEditor,
      onEditorClose: schedulerOptions.onEditorClose,
      ...(schedulerOptions.onEditorOpen !== undefined
        ? { onEditorOpen: schedulerOptions.onEditorOpen }
        : {}),
      ...(schedulerOptions.toolContextInteractiveMode !== undefined
        ? {
            toolContextInteractiveMode:
              schedulerOptions.toolContextInteractiveMode,
          }
        : {}),
      ...(schedulerOptions.onToolResult !== undefined
        ? { onToolResult: schedulerOptions.onToolResult }
        : {}),
      ...(schedulerOptions.nestedExecution !== undefined
        ? { nestedExecution: schedulerOptions.nestedExecution }
        : {}),
      ...(schedulerOptions.confirmationPromptsAvailable !== undefined
        ? {
            confirmationPromptsAvailable:
              schedulerOptions.confirmationPromptsAvailable,
          }
        : {}),
    });
  };
}
