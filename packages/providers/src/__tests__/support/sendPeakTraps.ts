/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: controls for the peak-during-send probe.
 *
 * `ISSUE854_SEND_TRAP` makes the probe hold the structures the no-array work
 * removes, so the probe's own bounds can be shown to fail. The traps wrap the
 * probe's row selection and live in test support only; no production code
 * carries a trap hook.
 *
 * - `array`: reads every row into an `IContent[]` and holds it for the send.
 * - `fill`: does what the lazy Responses fill path did before step C3 deleted
 *   it (issue #3858): reads every row into an array, patches it with the
 *   synthetic tool responses (two more copies) and builds the whole
 *   `ResponsesInputItem[]`.
 * - `estimate`: reads every row into an `IContent[]` when the probe estimates
 *   the projected prompt, holds it while the estimator runs and lets go before
 *   the request is sent, so only the estimate window can show it. It applies
 *   to a plan that includes the estimate step.
 * - `retain`: reads every row into an `IContent[]` for each send of the
 *   probe's accumulation run and never lets go of it, so every send leaves a
 *   whole history behind. This is the per-send leak the retained-growth gate
 *   exists to catch. It is armed for the accumulation run only.
 * - `retain-row` and `retain-metadata`: keep one row or one 4 KiB metadata
 *   object per send, proving that leaks below the byte allowance are rejected.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { SyntheticToolResponseHandler } from '../../openai/syntheticToolResponses.js';
import { buildOpenAIResponsesInput } from '../../openai-responses/OpenAIResponsesInputBuilder.js';

export type SendTrap =
  | 'array'
  | 'fill'
  | 'estimate'
  | 'retain'
  | 'retain-row'
  | 'retain-metadata';

export const SEND_TRAP_ENV = 'ISSUE854_SEND_TRAP';

/** An unset or empty value means no trap; anything unknown is an error. */
export function parseSendTrap(value: string | undefined): SendTrap | undefined {
  if (value === undefined || value === '') return undefined;
  switch (value) {
    case 'array':
    case 'fill':
    case 'estimate':
    case 'retain':
    case 'retain-row':
    case 'retain-metadata':
      return value;
    default:
      break;
  }
  throw new Error(
    `${SEND_TRAP_ENV} must be "array", "fill", "estimate", "retain", "retain-row" or "retain-metadata", got: ${value}`,
  );
}

export interface TrapHold {
  /** Drops everything the trap holds. */
  release(): void;
}

async function collect(rows: AsyncIterable<IContent>): Promise<IContent[]> {
  const all: IContent[] = [];
  for await (const row of rows) all.push(row);
  return all;
}

/** Histories the `retain` trap keeps alive for the rest of the process. */
const retainedAcrossSends: unknown[] = [];

export async function armSendTrap(
  trap: SendTrap,
  rows: AsyncIterable<IContent>,
): Promise<TrapHold> {
  if (trap === 'retain-row') {
    for await (const row of rows) {
      retainedAcrossSends.push(row);
      break;
    }
    return { release: () => undefined };
  }
  if (trap === 'retain-metadata') {
    retainedAcrossSends.push({
      requestId: retainedAcrossSends.length,
      detail: `request-${retainedAcrossSends.length}-${'x'.repeat(4096)}`,
    });
    return { release: () => undefined };
  }
  const all = await collect(rows);
  if (trap === 'retain') {
    retainedAcrossSends.push(all);
    return { release: () => undefined };
  }
  const state: { held: readonly unknown[] | undefined } = { held: [all] };
  if (trap === 'fill') {
    const patched = SyntheticToolResponseHandler.patchMessageHistory(all);
    const input = buildOpenAIResponsesInput(patched, {
      includeReasoningInContext: false,
      mediaPdfEnabled: true,
      outputLimits: parseOutputLimits({}),
      debug: () => {},
    });
    state.held = [all, patched, input];
  }
  return {
    release(): void {
      state.held = undefined;
    },
  };
}
