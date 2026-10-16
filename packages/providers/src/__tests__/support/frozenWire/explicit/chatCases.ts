/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the chat id counterexamples. The Kimi and Mistral
 * mappers derive wire ids from facts about the whole history (names, order
 * of eligible occurrences, collisions), so each case is sent on all three
 * chat routes.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ExplicitCase } from './explicitCase.js';
import { observeForms } from './explicitObserve.js';
import {
  ai,
  callBlock,
  human,
  responseBlock,
  textBlock,
  tool,
} from './rowBuilders.js';

const CHAT = ['openai-chat-plain', 'openai-chat-kimi', 'openai-chat-mistral'];
const KIMI = ['openai-chat-kimi'];

/** Nine alphanumeric characters pass through the Mistral mapper unchanged. */
const MISTRAL_ID = 'toolu_alpha-1';
/** The mapper's first candidate for MISTRAL_ID (salt 0). */
const FIRST_CANDIDATE = '4SftZvDMX';
/** Its second candidate (salt 1), used when the first is already taken. */
const SECOND_CANDIDATE = '4Uq1sY29c';

function pair(id: string, name = 'read_file'): IContent[] {
  return [ai(callBlock(id, name)), tool(responseBlock(id))];
}

function kimiCases(): ExplicitCase[] {
  return [
    {
      name: 'chat ids: Kimi human-call dropped-output case',
      review:
        '[human(text q, call X), tool(response X), ai(call Y), tool(Y)] on Kimi',
      observe: () =>
        observeForms(CHAT, {
          rows: [
            human(textBlock('q'), callBlock('X')),
            tool(responseBlock('X')),
            ...pair('Y'),
          ],
        }),
    },
    {
      name: 'chat ids: later eligible duplicate with another name',
      review:
        'a later eligible duplicate with another name, in separate journal rows',
      observe: () =>
        observeForms(KIMI, {
          rows: [
            human(textBlock('q')),
            ...pair('X', 'alpha'),
            ...pair('X', 'beta'),
          ],
        }),
    },
    {
      name: 'chat ids: later eligible duplicate with earlier call rows in two journal rows',
      review:
        'a later eligible duplicate with another name, earlier call rows in two journal rows',
      observe: () =>
        observeForms(KIMI, {
          rows: [
            human(textBlock('q')),
            ai(callBlock('X', 'alpha')),
            ai(callBlock('X', 'gamma')),
            tool(responseBlock('X')),
            ...pair('X', 'beta'),
          ],
        }),
    },
    {
      name: 'chat ids: later eligible duplicate within one row',
      review: 'a later eligible duplicate with another name, in the same row',
      observe: () =>
        observeForms(KIMI, {
          rows: [
            human(textBlock('q')),
            ai(callBlock('X', 'alpha'), callBlock('X', 'beta')),
            tool(responseBlock('X')),
          ],
        }),
    },
    {
      name: 'chat ids: unnamed duplicate',
      review: 'an unnamed duplicate',
      observe: () =>
        observeForms(KIMI, {
          rows: [
            human(textBlock('q')),
            ...pair('X', 'alpha'),
            ...pair('X', ''),
          ],
        }),
    },
  ];
}

function mistralCases(): ExplicitCase[] {
  return [
    {
      name: 'chat ids: Mistral salt collision keeps its holder',
      review:
        'the Mistral salt collision (4Uq1sY29c against 4SftZvDMX), holder present',
      observe: () =>
        observeForms(['openai-chat-mistral'], {
          rows: [
            human(textBlock('q')),
            ...pair(FIRST_CANDIDATE),
            ...pair(MISTRAL_ID),
          ],
        }),
      expectation: (observation) => {
        const text = JSON.stringify(observation['openai-chat-mistral/raw']);
        if (!text.includes(SECOND_CANDIDATE)) {
          throw new Error('the colliding id should take its second candidate');
        }
      },
    },
    {
      name: 'chat ids: Mistral salt collision whose first holder is removed',
      review:
        'the Mistral salt collision whose first holder is removed: the survivor takes its first candidate',
      observe: () =>
        observeForms(['openai-chat-mistral'], {
          rows: [human(textBlock('q')), ...pair(MISTRAL_ID)],
        }),
      expectation: (observation) => {
        const text = JSON.stringify(observation['openai-chat-mistral/raw']);
        if (!text.includes(FIRST_CANDIDATE)) {
          throw new Error('the survivor should take its first candidate');
        }
      },
    },
  ];
}

export function chatIdCases(): ExplicitCase[] {
  return [...kimiCases(), ...mistralCases()];
}
