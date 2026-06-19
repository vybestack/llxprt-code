/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P10
 * @requirement:REQ-003
 *
 * Static-import drivers for the public event adapter (mapLoopStream /
 * mapStreamEvent). Driving the adapter through a STATIC public-root import
 * (rather than the variable-specifier dynamic import used by the legacy
 * runAdapter) lets Stryker's per-test coverage analysis attribute the killed
 * mutants back to the executing tests — the dynamic import severs that
 * mapping. Behaviourally identical to runAdapter; no mock theater.
 *
 * Deep imports of core/providers types are expected here — this file lives
 * under __tests__/helpers/ which is excluded from the P09 boundary scan.
 */

import {
  mapLoopStream as mapLoopStreamStatic,
  mapStreamEvent as mapStreamEventStatic,
} from '@vybestack/llxprt-code-agents';
import type { ServerGeminiStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
import type { AgenticLoopEvent } from '../../../core/agenticLoop/types.js';
import type { AgentEvent } from '../../event-types.js';

/** Wraps a readonly array as a one-shot async iterable. */
async function* asyncIterOf<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

/**
 * Drives the REAL mapLoopStream via a STATIC public-root import. The static
 * binding lets Stryker map the killed mutants back to the executing tests.
 */
export async function runAdapterStatic(
  loopEvents: readonly AgenticLoopEvent[],
): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const pub of mapLoopStreamStatic(asyncIterOf(loopEvents))) {
    out.push(pub);
  }
  return out;
}

/**
 * Drives the REAL mapStreamEvent generator directly (static import) over a
 * single ServerGeminiStreamEvent with a fresh adapter state, returning ONLY
 * the events that variant yields in isolation. mapStreamEvent's second
 * parameter is the module-private AdapterState; helpers (excluded from the
 * boundary scan) supply a structurally-faithful mirror. Use this to assert
 * the per-variant projection of mapStreamEvent independently of the loop-end
 * done synthesis that mapLoopStream adds.
 */
export function driveSingleStreamEvent(
  event: ServerGeminiStreamEvent,
): readonly AgentEvent[] {
  const state = {
    emittedDone: false,
    lastFinished: null,
    lastStop: null,
    pendingDoneReason: null,
    sawActivity: false,
  };
  const out: AgentEvent[] = [];
  for (const pub of mapStreamEventStatic(
    event,
    state as unknown as Parameters<typeof mapStreamEventStatic>[1],
  )) {
    out.push(pub);
  }
  return out;
}
