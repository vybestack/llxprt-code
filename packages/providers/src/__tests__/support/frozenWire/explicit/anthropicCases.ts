/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the Anthropic counterexamples of the design's phase 0
 * list, ordering and repair. Each case records today's request bytes on the
 * Anthropic route, for the rows as given and for the normalized stream. The
 * scenarios are data so the length model test can run the same histories.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  aiText,
  answerRow,
  callRow,
  text,
  thinkingOnly,
} from '../../../../anthropic/__tests__/wire-reference/support/wireBuilderRows.js';
import type { ExplicitCase, Observation } from './explicitCase.js';
import { bodyOf, observeForms } from './explicitObserve.js';
import type { ExplicitSend } from './explicitSend.js';

const NO_REASONING = { 'reasoning.enabled': false };

export interface AnthropicScenario {
  readonly name: string;
  /** The design's wording of the counterexample, for the reader. */
  readonly review: string;
  readonly formatId: string;
  readonly send: ExplicitSend;
  readonly expectation?: (observation: Observation) => void;
}

/** `sizes[i]` consecutive rows of one role; roles alternate human, AI. */
export function runsOf(sizes: readonly number[]): IContent[] {
  const rows: IContent[] = [];
  sizes.forEach((count, run) => {
    for (let row = 0; row < count; row += 1) {
      rows.push(run % 2 === 0 ? text('x') : aiText('x'));
    }
  });
  return rows;
}

function anchored(value: string, anchor: boolean): IContent {
  return { ...text(value), metadata: anchor ? { cacheAnchor: true } : {} };
}

function resultRow(id: string, result: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      { type: 'tool_response', callId: id, toolName: 'read_file', result },
    ],
  };
}

function humanResultRow(id: string, result: string): IContent {
  return { speaker: 'human', blocks: resultRow(id, result).blocks };
}

function memberBytes(expected: number) {
  return (observation: Observation): void => {
    for (const form of ['raw', 'normalized']) {
      const { member } = bodyOf(observation, `anthropic-cache-off/${form}`);
      if (member !== expected) {
        throw new Error(
          `${form}: messages are ${member} bytes, not ${expected}`,
        );
      }
    }
  };
}

function resultTexts(observation: Observation): void {
  const body = bodyOf(observation, 'anthropic-cache-off/raw').body ?? '';
  const written = body.match(/ONE|TWO/g);
  if (JSON.stringify(written) !== JSON.stringify(['ONE', 'ONE', 'TWO'])) {
    throw new Error(`results were written as ${JSON.stringify(written)}`);
  }
}

const SECOND_THINKING: IContent = {
  speaker: 'ai',
  blocks: [
    {
      type: 'thinking',
      thought: 'second',
      sourceField: 'thinking',
      signature: 's',
    },
    { type: 'text', text: 'answer' },
  ],
};

const ANCHOR_ROWS: IContent[] = [
  anchored('A', true),
  anchored('B', false),
  aiText('reply'),
  text('end'),
];

const CHAIN_POLICY = {
  'reasoning.stripFromContext': 'allButLast',
  model: 'claude-sonnet-4',
};

function orderingScenarios(): AnthropicScenario[] {
  const off = 'anthropic-cache-off';
  return [
    {
      name: 'anthropic ordering: tool use stays before later text when its result exists later',
      review:
        'a merged assistant message with a tool use followed by later text and a result that exists later',
      formatId: off,
      send: {
        rows: [
          text('q'),
          callRow('X'),
          aiText('later text'),
          text('interrupt'),
          answerRow('X'),
        ],
        ephemerals: NO_REASONING,
      },
    },
    {
      name: 'anthropic ordering: interrupted result [human q, AI call X, AI text after]',
      review: 'the interrupted-result case',
      formatId: off,
      send: {
        rows: [text('q'), callRow('X'), aiText('after')],
        ephemerals: NO_REASONING,
      },
    },
    {
      name: 'anthropic ordering: twelve-row pair A, runs 1,1,1,1,4,3,1',
      review: 'the 12-row pair that writes 411 and 461 bytes (this one 411)',
      formatId: off,
      send: { rows: runsOf([1, 1, 1, 1, 4, 3, 1]), ephemerals: NO_REASONING },
      expectation: memberBytes(411),
    },
    {
      name: 'anthropic ordering: twelve-row pair B, runs 1,2,2,2,3,1,1',
      review: 'the 12-row pair that writes 411 and 461 bytes (this one 461)',
      formatId: off,
      send: { rows: runsOf([1, 2, 2, 2, 3, 1, 1]), ephemerals: NO_REASONING },
      expectation: memberBytes(461),
    },
  ];
}

function anchorAndChainScenarios(): AnthropicScenario[] {
  const off = 'anthropic-cache-off';
  return [
    {
      name: 'anthropic ordering: anchor on human A, 1h',
      review: 'the A/B anchor example',
      formatId: 'anthropic-cache-1h',
      send: { rows: ANCHOR_ROWS, ephemerals: NO_REASONING },
    },
    {
      name: 'anthropic ordering: anchor on human A, 5m',
      review: 'the A/B anchor example',
      formatId: 'anthropic-cache-5m',
      send: { rows: ANCHOR_ROWS, ephemerals: NO_REASONING },
    },
    {
      name: 'anthropic ordering: two thinking rows under allButLast, reasoning on',
      review:
        '[human q, AI thinking(first), AI thinking(second)+text] allButLast',
      formatId: off,
      send: {
        rows: [text('q'), thinkingOnly('first'), SECOND_THINKING],
        ephemerals: {
          'reasoning.enabled': true,
          'reasoning.stripFromContext':
            CHAIN_POLICY['reasoning.stripFromContext'],
        },
        model: CHAIN_POLICY.model,
      },
    },
    {
      name: 'anthropic ordering: two thinking rows under allButLast, reasoning off',
      review:
        '[human q, AI thinking(first), AI thinking(second)+text] allButLast',
      formatId: off,
      send: {
        rows: [text('q'), thinkingOnly('first'), SECOND_THINKING],
        ephemerals: {
          'reasoning.enabled': false,
          'reasoning.stripFromContext':
            CHAIN_POLICY['reasoning.stripFromContext'],
        },
        model: CHAIN_POLICY.model,
      },
    },
  ];
}

function repairScenarios(): AnthropicScenario[] {
  const off = 'anthropic-cache-off';
  const plain = (rows: IContent[]): ExplicitSend => ({
    rows,
    ephemerals: NO_REASONING,
  });
  return [
    {
      name: 'anthropic repair: two calls of one id take later results ONE, ONE, TWO',
      review:
        'two calls of one id in one assistant message with later results ONE and TWO',
      formatId: off,
      send: plain([
        text('q'),
        callRow('X', 'X'),
        text('next'),
        resultRow('X', 'ONE'),
        text('more'),
        resultRow('X', 'TWO'),
      ]),
      expectation: resultTexts,
    },
    {
      name: 'anthropic repair: a result in a human row',
      review: 'a result in a human row',
      formatId: off,
      send: plain([
        text('q'),
        callRow('X'),
        humanResultRow('X', 'HUMAN-ROW-RESULT'),
      ]),
    },
    {
      name: 'anthropic repair: a result in a human row displaced behind other text',
      review: 'a result in a human row',
      formatId: off,
      send: plain([
        text('q'),
        callRow('X'),
        text('interrupt'),
        humanResultRow('X', 'HUMAN-ROW-RESULT'),
      ]),
    },
    {
      name: 'anthropic repair: later assistant messages see the moved results',
      review: 'later messages seeing moved results',
      formatId: off,
      send: plain([
        text('q'),
        callRow('X'),
        text('n1'),
        callRow('X'),
        text('n2'),
        resultRow('X', 'R1'),
        resultRow('X', 'R2'),
      ]),
    },
    {
      name: 'anthropic repair: raw ids hist_tool_X against toolu_X keep the real result',
      review: 'raw ids hist_tool_X against toolu_X',
      formatId: off,
      send: plain([
        text('q'),
        callRow('hist_tool_X'),
        resultRow('toolu_X', 'REAL-RESULT'),
      ]),
    },
    {
      name: 'anthropic repair: raw ids hist_tool_X against toolu_X, result displaced',
      review: 'raw ids hist_tool_X against toolu_X',
      formatId: off,
      send: plain([
        text('q'),
        callRow('hist_tool_X'),
        text('interrupt'),
        resultRow('toolu_X', 'REAL-RESULT'),
      ]),
    },
  ];
}

export function anthropicScenarios(): AnthropicScenario[] {
  return [
    ...orderingScenarios(),
    ...anchorAndChainScenarios(),
    ...repairScenarios(),
  ];
}

export function anthropicCases(): ExplicitCase[] {
  return anthropicScenarios().map((scenario) => ({
    name: scenario.name,
    review: scenario.review,
    observe: () => observeForms([scenario.formatId], scenario.send),
    ...(scenario.expectation === undefined
      ? {}
      : { expectation: scenario.expectation }),
  }));
}
