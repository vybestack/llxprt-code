/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Same-path mutation ordering for scheduler batches (issue #3239).
 *
 * File-mutating tools perform whole-file read-modify-write operations, so two
 * batched calls whose target locations overlap can both read the same
 * snapshot and overwrite each other. Mutating invocations (Kind.Edit,
 * Kind.Delete, Kind.Move) that report overlapping locations through the
 * existing toolLocations() contract therefore execute in request order, while
 * every other call keeps the scheduler's concurrent launch behavior.
 */

import path from 'node:path';
import { Kind } from '@vybestack/llxprt-code-tools';
import type { ToolLocation } from '@vybestack/llxprt-code-tools';
import type { ScheduledToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';

const MUTATING_KINDS: ReadonlySet<Kind> = new Set([
  Kind.Edit,
  Kind.Delete,
  Kind.Move,
]);

function isMutatingCall(call: ScheduledToolCall): boolean {
  return MUTATING_KINDS.has(call.tool.kind);
}

/**
 * Lexically normalized target paths for a mutating call. Location identity is
 * deliberately lexical: symlink/hardlink aliasing and cross-process locking
 * are outside the ordering contract.
 */
function normalizedMutationPaths(call: ScheduledToolCall): string[] {
  return call.invocation
    .toolLocations()
    .filter((location: ToolLocation) => location.path.length > 0)
    .map((location: ToolLocation) => path.normalize(location.path));
}

/**
 * Launches each scheduled call, holding mutating calls whose normalized
 * locations overlap an earlier mutating call in the batch until every earlier
 * overlapping call has settled. Calls without dependencies launch
 * immediately. A waiting call does not launch at all once the batch signal
 * has aborted, so no side effects begin after cancellation.
 *
 * @param onAbandoned Invoked exactly once for every mutating call with
 *   locations that is never launched because the batch signal aborted —
 *   whether abort wins the race while the call still waits or the dependency
 *   settles after the abort. The scheduler uses this to buffer a terminal
 *   cancelled result for the abandoned call's execution index.
 */
export function launchCallsWithSamePathOrdering(
  calls: readonly ScheduledToolCall[],
  launch: (call: ScheduledToolCall) => Promise<void>,
  signal: AbortSignal,
  onAbandoned: (call: ScheduledToolCall) => void,
): Array<Promise<void>> {
  const settledMutationsByPath = new Map<string, Promise<void>>();
  return calls.map((call) => {
    if (!isMutatingCall(call)) {
      return launch(call);
    }
    const mutationPaths = normalizedMutationPaths(call);
    if (mutationPaths.length === 0) {
      return launch(call);
    }

    const predecessors = [
      ...new Set(
        mutationPaths.flatMap(
          (mutationPath) => settledMutationsByPath.get(mutationPath) ?? [],
        ),
      ),
    ];
    const dependency =
      predecessors.length > 0 ? Promise.all(predecessors) : Promise.resolve();

    // Abandonment is reported exactly once per call. Waiting calls need the
    // abort listener because their dependency may never settle after an
    // abort-ignoring predecessor; every call's dependency-settle path checks
    // the signal so a skip can never silently omit the notification.
    let launchFinalized = false;
    const abandon = (): void => {
      if (launchFinalized) return;
      launchFinalized = true;
      signal.removeEventListener('abort', abandon);
      onAbandoned(call);
    };
    if (predecessors.length > 0) {
      signal.addEventListener('abort', abandon, { once: true });
    }

    const launched = dependency.then(() => {
      if (signal.aborted) {
        abandon();
        return undefined;
      }
      launchFinalized = true;
      signal.removeEventListener('abort', abandon);
      return launch(call);
    });
    const settled = launched.then(
      () => undefined,
      () => undefined,
    );
    for (const mutationPath of mutationPaths) {
      settledMutationsByPath.set(mutationPath, settled);
    }
    return launched;
  });
}
