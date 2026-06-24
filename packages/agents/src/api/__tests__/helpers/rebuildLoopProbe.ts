/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-007
 *
 * Focused infra probe for the shared loop-rebuild routine. Lives under
 * __tests__/helpers/ so the deep imports of the internal loop module + core
 * Config/MessageBus types are permitted while staying excluded from the T17
 * boundary scan.
 *
 * rebuildLoop is built for dependency injection: it accepts an optional
 * `AgenticLoopCtor`. We inject a recording fake constructor so we can observe —
 * by REAL VALUE — which client/config/bus the freshly constructed loop is bound
 * to, without standing up the heavy real AgenticLoop. The teardown side effects
 * (abort of the prior controller, unsubscription of recorded subs) are observed
 * through real AbortSignal state and real unsubscribe invocations.
 */

import { rebuildLoop, createLoopHolder } from '../../loop/rebuildLoop.js';
import type { LoopHolder, RebuildLoopDeps } from '../../loop/rebuildLoop.js';
import type { AgenticLoop } from '../../../core/agenticLoop/AgenticLoop.js';
import type { AgenticLoopOptions } from '../../../core/agenticLoop/types.js';

export { createLoopHolder };
export type { LoopHolder };

/** A recording fake AgenticLoop: captures the options it was constructed with. */
export interface FakeLoopRecord {
  readonly options: AgenticLoopOptions;
}

export interface RebuildLoopProbe {
  readonly holder: LoopHolder;
  /** All fake-loop constructions in order (one per rebuild). */
  readonly constructions: readonly FakeLoopRecord[];
  /** Runs the production rebuildLoop with the current probe wiring. */
  rebuild(overrides?: Partial<RebuildLoopDeps>): AgenticLoop;
  /** The client value the next resolveClient() will return. */
  setClient(client: AgenticLoopOptions['agentClient']): void;
}

/**
 * Builds a probe around the real rebuildLoop with a recording fake ctor and
 * trivial structural config/messageBus carriers (rebuildLoop only forwards
 * them to the ctor; it never calls methods on them).
 */
export function createRebuildLoopProbe(): RebuildLoopProbe {
  const holder = createLoopHolder();
  const constructions: FakeLoopRecord[] = [];

  let client: AgenticLoopOptions['agentClient'] =
    {} as AgenticLoopOptions['agentClient'];

  const config = {} as RebuildLoopDeps['config'];
  const messageBus = {} as RebuildLoopDeps['messageBus'];

  class FakeAgenticLoop {
    constructor(options: AgenticLoopOptions) {
      constructions.push({ options });
    }
  }

  const baseDeps: RebuildLoopDeps = {
    loopHolder: holder,
    resolveClient: () => client,
    config,
    messageBus,
    AgenticLoopCtor: FakeAgenticLoop as unknown as typeof AgenticLoop,
  };

  return {
    holder,
    constructions,
    setClient: (c) => {
      client = c;
    },
    rebuild: (overrides) => rebuildLoop({ ...baseDeps, ...overrides }),
  };
}

/** A distinct, identity-comparable fake client value. */
export function makeClient(tag: string): AgenticLoopOptions['agentClient'] {
  return { __tag: tag } as unknown as AgenticLoopOptions['agentClient'];
}
