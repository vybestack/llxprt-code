import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';

import type {
  ToolExecutionPolicy,
  ToolGovernance,
} from '@vybestack/llxprt-code-tools';
import type { ToolLookup } from '@vybestack/llxprt-code-tools';
import type { ChildToolDisplay } from '../../session/childToolDisplay.js';

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-007
 * @pseudocode switch-rebind.md steps 10-27 (initial-build path)
 *
 * The shared loop-rebuild routine used by createAgent (initial build) and by
 * every client-rebinding mutation (P16 switch/auth/profile). AgenticLoop caches
 * its constructor client in a `private readonly` field and never re-resolves
 * it, so after any client rebind the facade MUST construct a fresh AgenticLoop
 * bound to the current `config.getAgentClient()`. AgenticLoop has NO
 * cancel/dispose method — it cancels via the AbortSignal passed to run() and
 * self-cleans in run()'s finally; the facade aborts its own controller and
 * unsubscribes facade-recorded per-turn subscriptions.
 */

import {
  bindSchedulerOwner,
  type SchedulerConstruction,
} from '../../session/assembleSchedulerOwner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import { AgenticLoop } from '../../core/agenticLoop/AgenticLoop.js';
import type { AgenticLoopOptions } from '../../core/agenticLoop/types.js';

/** The mutable slot shared by createAgent and rebuildLoop. */
export interface LoopHolder {
  childDisplay?: ChildToolDisplay;
  schedulerFactory?: SchedulerConstruction;
  current?: AgenticLoop;
  /** Facade-owned AbortController for the active run's signal (G1). */
  activeRunController?: AbortController;
  /** Facade-recorded per-turn subscription unsubscribers (G1). */
  subscriptions?: ReadonlyArray<() => void>;
  /**
   * The client the current loop was bound to at construction. Compared against
   * `deps.resolveClient()` before each `stream()` turn so a stale client
   * (e.g. after a slash-command refreshAuth outside the facade) triggers a
   * rebuild instead of streaming through the old client.
   */
  boundClient?: AgenticLoopOptions['agentClient'];
}

/** Dependencies for rebuildLoop (switch-rebind.md RebuildLoopDeps). */
export interface RebuildLoopDeps {
  telemetry: RootTelemetry;
  loopHolder: LoopHolder;
  resolveClient: () => AgenticLoopOptions['agentClient'];
  config: Config;
  toolSelection: ToolLookup;
  readExecutionPolicy: () => ToolExecutionPolicy;
  readApprovalMode?: () => ApprovalMode;
  getToolGovernance: () => ToolGovernance;
  messageBus: MessageBus;
  approvalHandler?: AgenticLoopOptions['approvalHandler'];
  displayCallbacks?: AgenticLoopOptions['displayCallbacks'];
  AgenticLoopCtor?: typeof AgenticLoop;
}

/** Creates an empty mutable loop holder slot. */
export function createLoopHolder(): LoopHolder {
  return {};
}

/**
 * Unsubscribes facade-recorded per-turn subscriptions on the prior loop.
 * @pseudocode switch-rebind.md step 14
 */
function unsubscribePrior(holder: LoopHolder): void {
  const subs = holder.subscriptions;
  if (subs === undefined) {
    return;
  }
  const failures: unknown[] = [];
  for (const unsubscribe of subs) {
    try {
      unsubscribe();
    } catch (error) {
      failures.push(error);
    }
  }
  holder.subscriptions = undefined;
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'Prior loop subscription cleanup failed',
    );
  }
}

/**
 * Constructs the replacement before aborting the prior run and unsubscribing
 * recorded subscriptions, then publishes the loop with a fresh controller.
 * @pseudocode switch-rebind.md steps 10-27
 */
export function rebuildLoop(deps: RebuildLoopDeps): AgenticLoop {
  const prepared = prepareLoop(deps);
  const loop = prepared.publish();
  prepared.retire();
  return loop;
}

export function prepareLoop(deps: RebuildLoopDeps): {
  publish: () => AgenticLoop;
  retire: () => void;
} {
  const holder = deps.loopHolder;
  const prior = {
    current: holder.current,
    activeRunController: holder.activeRunController,
    subscriptions: holder.subscriptions,
  };

  // @pseudocode switch-rebind.md step 16: resolve the CURRENT client
  const currentClient = deps.resolveClient();

  // @pseudocode switch-rebind.md steps 17-22: construct a fresh loop
  const Ctor = deps.AgenticLoopCtor ?? AgenticLoop;
  const newLoop = new Ctor({
    createSchedulerOwner: bindSchedulerOwner(
      deps.config,
      deps.messageBus,
      deps.config.isInteractive(),
      deps.toolSelection,
      holder.schedulerFactory ?? ((options) => new CoreToolScheduler(options)),
      deps.readExecutionPolicy,
      deps.getToolGovernance,
      deps.readApprovalMode,
      deps.telemetry,
    ),
    agentClient: currentClient,
    config: deps.config,
    messageBus: deps.messageBus,
    approvalHandler: deps.approvalHandler,
    displayCallbacks: deps.displayCallbacks,
    interactiveMode: deps.config.isInteractive(),
  });

  return {
    publish: () => {
      holder.activeRunController = new AbortController();
      holder.subscriptions = undefined;
      holder.current = newLoop;
      holder.boundClient = currentClient;
      return newLoop;
    },
    retire: () => {
      if (prior.current !== undefined) {
        prior.activeRunController?.abort();
        unsubscribePrior(prior);
      }
    },
  };
}

/** Returns true when the holder's loop is bound to the given client. */
export function isLoopBoundToClient(
  holder: LoopHolder,
  client: AgenticLoopOptions['agentClient'],
): boolean {
  return holder.boundClient === client;
}

/** Rebuilds via `rebuild` when the holder's bound client differs from the current. */
export function ensureFreshClientLoop(
  holder: LoopHolder,
  resolveClient: () => AgenticLoopOptions['agentClient'],
  rebuild: () => void,
): void {
  if (holder.current === undefined) {
    return;
  }
  if (isLoopBoundToClient(holder, resolveClient())) {
    return;
  }
  rebuild();
}

/**
 * Resolves the holder's loop after a stale-client rebuild attempt. Returns the
 * live loop on success, or a structured error message when the rebuild threw
 * or no loop is initialized — so stream() can yield error/done events instead
 * of rejecting the async generator.
 */
export function resolveLoopOrError(
  holder: LoopHolder,
  resolveClient: () => AgenticLoopOptions['agentClient'],
  rebuild: () => void,
):
  | { loop: AgenticLoop; error?: undefined }
  | { loop?: undefined; error: { message: string } } {
  try {
    ensureFreshClientLoop(holder, resolveClient, rebuild);
  } catch (e) {
    return {
      error: {
        message: `Agent loop initialization failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  const loop = holder.current;
  return loop
    ? { loop }
    : { error: { message: 'Agent loop is not initialized' } };
}
