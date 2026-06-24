/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { AgenticLoop } from '../../core/agenticLoop/AgenticLoop.js';
import type { AgenticLoopOptions } from '../../core/agenticLoop/types.js';

/** The mutable slot shared by createAgent and rebuildLoop. */
export interface LoopHolder {
  current?: AgenticLoop;
  /** Facade-owned AbortController for the active run's signal (G1). */
  activeRunController?: AbortController;
  /** Facade-recorded per-turn subscription unsubscribers (G1). */
  subscriptions?: ReadonlyArray<() => void>;
}

/** Dependencies for rebuildLoop (switch-rebind.md RebuildLoopDeps). */
export interface RebuildLoopDeps {
  loopHolder: LoopHolder;
  resolveClient: () => AgenticLoopOptions['agentClient'];
  config: Config;
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
  for (const unsubscribe of subs) {
    try {
      unsubscribe();
    } catch {
      // Best-effort teardown — a throwing unsubscribe must not abort the rebuild.
    }
  }
  holder.subscriptions = undefined;
}

/**
 * Tears down the prior loop (abort its active run + unsubscribe recorded subs),
 * constructs a fresh AgenticLoop bound to the CURRENT client, records a fresh
 * facade-owned AbortController, and stores the new loop in the holder.
 * @pseudocode switch-rebind.md steps 10-27
 */
export function rebuildLoop(deps: RebuildLoopDeps): AgenticLoop {
  // @pseudocode switch-rebind.md steps 11-15: tear down prior loop
  const holder = deps.loopHolder;
  if (holder.current !== undefined) {
    holder.activeRunController?.abort();
    holder.activeRunController = undefined;
    unsubscribePrior(holder);
  }

  // @pseudocode switch-rebind.md step 16: resolve the CURRENT client
  const currentClient = deps.resolveClient();

  // @pseudocode switch-rebind.md steps 17-22: construct a fresh loop
  const Ctor = deps.AgenticLoopCtor ?? AgenticLoop;
  const newLoop = new Ctor({
    agentClient: currentClient,
    config: deps.config,
    messageBus: deps.messageBus,
    approvalHandler: deps.approvalHandler,
    displayCallbacks: deps.displayCallbacks,
  });

  // @pseudocode switch-rebind.md step 23: fresh facade-owned controller for
  // the next run's signal. P15 records no per-turn subscriptions yet; the slot
  // exists so P16's switch mutators can attach bus subscriptions here.
  holder.activeRunController = new AbortController();
  holder.subscriptions = undefined;

  // @pseudocode switch-rebind.md step 25: store the new loop
  holder.current = newLoop;
  return newLoop;
}
