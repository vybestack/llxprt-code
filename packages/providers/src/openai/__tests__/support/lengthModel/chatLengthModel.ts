/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the length checks of the OpenAI chat transducer. For one
 * history and one set of settings it builds the unit facts, replays the drop
 * fact, composes the per-unit summaries, and reports the predicted byte
 * length of the `messages` array (system message, commas and brackets
 * included) together with the associativity and coverage results. The caller
 * compares the prediction with the bytes today's builders wrote.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  checkAssociativity,
  leftFold,
  type AssociativityResult,
  type Monoid,
} from '../../../../__tests__/support/lengthModel/associativity.js';
import { jsonBytes } from '../../../../__tests__/support/lengthModel/bytes.js';
import { droppedMessages, lastThinkingUnit, variantOf } from './chatDrops.js';
import {
  IDENTITY,
  START,
  compose,
  leaf,
  sameSummary,
  totalOf,
  type ChatSummary,
} from './chatTransducer.js';
import { chatUnitFacts, type ChatSettings } from './chatUnitFacts.js';
import {
  digitsClosed,
  digitsExact,
  digitsWithoutExceptions,
  idUseRecords,
  type ClosedForm,
} from './kimiIdFacts.js';

const CHAT_MONOID: Monoid<ChatSummary> = {
  identity: IDENTITY,
  compose,
  same: sameSummary,
};

export interface ChatModelOptions {
  /** The control without P: tool media flushes without the bytes of the parts. */
  readonly ignoreMediaParts?: boolean;
}

export interface KimiDigits {
  /** Walking every written id use. */
  readonly exact: number;
  /** The design's closed form with its exception list. */
  readonly closed: ClosedForm;
  /** The control that has no exception list. */
  readonly withoutExceptions: number;
}

export interface ChatAnalysis {
  /** Predicted bytes of the `messages` array. */
  readonly predicted: number;
  readonly messageCount: number;
  readonly kimiDigits: KimiDigits | undefined;
  readonly associativity: AssociativityResult;
  /** Boundary states the sequential run passes through. */
  readonly reached: ReadonlySet<number>;
  readonly withDropped: boolean;
  readonly withMedia: boolean;
  readonly mistralIdViolations: number;
}

function systemBytes(systemInstruction: string | null): number {
  return jsonBytes({ role: 'system', content: systemInstruction ?? '' });
}

function reachedStates(leaves: readonly ChatSummary[]): Set<number> {
  const reached = new Set<number>();
  let state = START;
  for (const summary of leaves) {
    state = summary.out[state];
    reached.add(state);
  }
  return reached;
}

/** `[`, the system message, then each message behind a comma, `]`. */
const BRACKETS = 2;

export function analyzeChat(
  rows: readonly IContent[],
  settings: ChatSettings,
  systemInstruction: string | null,
  seed: number,
  options: ChatModelOptions = {},
): ChatAnalysis {
  const { units, kimi, mistralIdViolations } = chatUnitFacts(rows, settings);
  const lastThinking = lastThinkingUnit(units);
  const variantOfUnit = (index: number) =>
    variantOf(settings.strip, index, lastThinking);
  const dropped = droppedMessages(units, variantOfUnit);
  const leafOptions = { ignoreMediaParts: options.ignoreMediaParts === true };
  const leaves = units.map((unit) =>
    leaf(unit, variantOfUnit(unit.index), dropped[unit.index], leafOptions),
  );
  const total = totalOf(leftFold(CHAT_MONOID, leaves));
  let kimiDigits: KimiDigits | undefined;
  if (kimi !== undefined) {
    const records = idUseRecords(units, variantOfUnit, dropped);
    kimiDigits = {
      exact: digitsExact(records, kimi),
      closed: digitsClosed(records, kimi),
      withoutExceptions: digitsWithoutExceptions(records, kimi),
    };
  }
  return {
    predicted:
      BRACKETS +
      systemBytes(systemInstruction) +
      total.bytes +
      (kimiDigits?.exact ?? 0),
    messageCount: total.messages + 1,
    kimiDigits,
    associativity: checkAssociativity(CHAT_MONOID, leaves, seed),
    reached: reachedStates(leaves),
    withDropped: dropped.some((set) => set.size > 0),
    withMedia: units.some(
      (unit) => unit.images[variantOfUnit(unit.index)].length > 0,
    ),
    mistralIdViolations,
  };
}
