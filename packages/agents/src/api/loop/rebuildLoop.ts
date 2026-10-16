/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SchedulerConstruction } from '../../session/assembleSchedulerOwner.js';
import type { ChildToolDisplay } from '../../session/childToolDisplay.js';
import type { AgenticLoop } from '../../core/agenticLoop/AgenticLoop.js';
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

/** Creates an empty mutable loop holder slot. */
export function createLoopHolder(): LoopHolder {
  return {};
}

export function rebuildLoop(
  holder: LoopHolder,
  resolveClient: () => AgenticLoopOptions['agentClient'],
  construct: (client: AgenticLoopOptions['agentClient']) => AgenticLoop,
): AgenticLoop {
  const prepared = prepareLoop(holder, resolveClient, construct);
  const loop = prepared.publish();
  prepared.retire();
  return loop;
}

export function prepareLoop(
  holder: LoopHolder,
  resolveClient: () => AgenticLoopOptions['agentClient'],
  construct: (client: AgenticLoopOptions['agentClient']) => AgenticLoop,
): {
  publish: () => AgenticLoop;
  retire: () => void;
} {
  const prior = {
    current: holder.current,
    activeRunController: holder.activeRunController,
    subscriptions: holder.subscriptions,
  };
  const currentClient = resolveClient();
  const newLoop = construct(currentClient);
  let published = false;
  let retired = false;
  return {
    publish: () => {
      if (!published) {
        published = true;
        holder.activeRunController = new AbortController();
        holder.subscriptions = undefined;
        holder.current = newLoop;
        holder.boundClient = currentClient;
      }
      return newLoop;
    },
    retire: () => {
      if (retired || prior.current === undefined) return;
      retired = true;
      const failures: unknown[] = [];
      try {
        prior.activeRunController?.abort();
      } catch (error) {
        failures.push(error);
      }
      for (const unsubscribe of prior.subscriptions ?? []) {
        try {
          unsubscribe();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Prior loop retirement failed');
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
