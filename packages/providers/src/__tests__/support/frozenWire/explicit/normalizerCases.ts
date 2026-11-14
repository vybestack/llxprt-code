/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the normalizer counterexamples. Each case records the
 * unit stream core normalization produces (a hash of its sorted-key JSON,
 * with the JSON next to it) and the bytes each provider writes for it.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ExplicitCase, Observation } from './explicitCase.js';
import { observeForms, unitStreamOf } from './explicitObserve.js';
import {
  ai,
  callBlock,
  human,
  responseBlock,
  textBlock,
  tool,
} from './rowBuilders.js';

const ROUTES = ['openai-chat-plain', 'openai-responses', 'anthropic-cache-off'];

async function observeUnits(rows: IContent[]): Promise<Observation> {
  return {
    units: await unitStreamOf(rows),
    ...(await observeForms(ROUTES, {
      rows,
      ephemerals: { 'reasoning.enabled': false },
    })),
  };
}

export interface NormalizerScenario {
  readonly name: string;
  /** The design's wording of the counterexample, for the reader. */
  readonly review: string;
  readonly rows: IContent[];
}

export function normalizerScenarios(): NormalizerScenario[] {
  return [
    {
      name: 'normalizer: [human(text q, call a), ai(call a)] answers the call in the human row',
      review: 'a synthetic response at the human call',
      rows: [human(textBlock('q'), callBlock('a')), ai(callBlock('a'))],
    },
    {
      name: 'normalizer: [human(text q, call X), tool(response X)] keeps the tool unit',
      review: 'the tool row is re-emitted after the human row',
      rows: [
        human(textBlock('q'), callBlock('X')),
        tool(responseBlock('X', 'RESULT-X')),
      ],
    },
    {
      name: 'normalizer: a call in a human row with its result in the same row',
      review: 'a call in a human row with its result',
      rows: [
        human(textBlock('q'), callBlock('X'), responseBlock('X', 'RESULT-X')),
      ],
    },
    {
      name: 'normalizer: a call in a tool row with its result in the same row',
      review: 'a call in a non-AI row with its result',
      rows: [
        human(textBlock('q')),
        tool(callBlock('X'), responseBlock('X', 'RESULT-X')),
      ],
    },
  ];
}

export function normalizerCases(): ExplicitCase[] {
  return normalizerScenarios().map((scenario) => ({
    name: scenario.name,
    review: scenario.review,
    observe: () => observeUnits(scenario.rows),
  }));
}
