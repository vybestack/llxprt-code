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
 * - `fill`: does what the lazy Responses fill path does (issue #3858): reads
 *   every row into an array, patches it with the synthetic tool responses
 *   (two more copies) and builds the whole `ResponsesInputItem[]`.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { SyntheticToolResponseHandler } from '../../openai/syntheticToolResponses.js';
import { buildOpenAIResponsesInput } from '../../openai-responses/OpenAIResponsesInputBuilder.js';

export type SendTrap = 'array' | 'fill';

export const SEND_TRAP_ENV = 'ISSUE854_SEND_TRAP';

/** An unset or empty value means no trap; anything unknown is an error. */
export function parseSendTrap(value: string | undefined): SendTrap | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'array' || value === 'fill') return value;
  throw new Error(`${SEND_TRAP_ENV} must be "array" or "fill", got: ${value}`);
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

export async function armSendTrap(
  trap: SendTrap,
  rows: AsyncIterable<IContent>,
): Promise<TrapHold> {
  const all = await collect(rows);
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
