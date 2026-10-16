/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the Responses counterexamples: call ids that normalize
 * to one id, stateful parents and their cursor, the PDF aggregate limit and
 * a rejected parent that a second source must not reuse.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { PDF_AGGREGATE_MAX_BYTES } from '../../../../utils/mediaUtils.js';
import type { MediaBinding } from '../../wireBodyCapture.js';
import { formatById } from '../frozenCases.js';
import type { ExplicitCase, Observation } from './explicitCase.js';
import { bodyOf, observeForms } from './explicitObserve.js';
import { sendFresh, sendThrough, type Observed } from './explicitSend.js';
import {
  ai,
  callBlock,
  human,
  responseBlock,
  textBlock,
  tool,
} from './rowBuilders.js';

const BOTH_ROUTES = ['openai-responses', 'openai-responses-via-openai'];
const STATEFUL = { 'responses-stateful': true };
const REQUEST_URL = 'https://api.openai.com/v1';

function parented(
  row: IContent,
  id: string,
  providerBaseURL?: string,
): IContent {
  return {
    ...row,
    metadata: {
      id,
      responsesStored: true,
      ...(providerBaseURL === undefined ? {} : { providerBaseURL }),
    },
  };
}

function usesParent(
  observation: Observation,
  label: string,
  parent: string | undefined,
): void {
  const body = bodyOf(observation, label).body ?? '';
  const marker = '"previous_response_id":';
  if (parent === undefined) {
    if (body.includes(marker)) throw new Error(`${label} sent a parent`);
    return;
  }
  if (!body.includes(`${marker}"${parent}"`)) {
    throw new Error(`${label} did not send parent ${parent}`);
  }
}

function checkParent(parent: string | undefined) {
  return (observation: Observation): void => {
    for (const route of BOTH_ROUTES) {
      usesParent(observation, `${route}/raw`, parent);
    }
  };
}

function idCases(): ExplicitCase[] {
  return [
    {
      name: 'responses ids: call ids "" and "call_" in one unit',
      review: 'call ids "" and "call_" in one unit (263 bytes)',
      observe: () =>
        observeForms(BOTH_ROUTES, {
          rows: [
            human(textBlock('q')),
            ai(callBlock(''), callBlock('call_')),
            tool(responseBlock('call_')),
          ],
        }),
    },
  ];
}

function parentCases(): ExplicitCase[] {
  const question = human(textBlock('second question'));
  return [
    {
      name: 'responses parent: a wildcard endpoint is selected',
      review: 'a parent with a wildcard endpoint',
      observe: () =>
        observeForms(BOTH_ROUTES, {
          rows: [
            human(textBlock('first question')),
            parented(ai(textBlock('stored answer')), 'resp_wildcard'),
            question,
          ],
          ephemerals: STATEFUL,
        }),
      expectation: checkParent('resp_wildcard'),
    },
    {
      name: 'responses parent: a trailing-slash endpoint is selected',
      review: 'a parent with a trailing-slash URL',
      observe: () =>
        observeForms(BOTH_ROUTES, {
          rows: [
            human(textBlock('first question')),
            parented(
              ai(textBlock('stored answer')),
              'resp_slash',
              `${REQUEST_URL}/`,
            ),
            question,
          ],
          ephemerals: STATEFUL,
        }),
      expectation: checkParent('resp_slash'),
    },
    {
      name: 'responses parent: an adjacent result is sent after the parent unit',
      review: 'a parent with an adjacent result (cursor after the unit)',
      observe: () =>
        observeForms(BOTH_ROUTES, {
          rows: [
            human(textBlock('first question')),
            parented(ai(callBlock('call_x')), 'resp_call', REQUEST_URL),
            tool(responseBlock('call_x', 'ADJACENT-RESULT')),
            question,
          ],
          ephemerals: STATEFUL,
        }),
      expectation: checkParent('resp_call'),
    },
    {
      name: 'responses parent: no following content sends the full history',
      review: 'a parent with no following content',
      observe: () =>
        observeForms(BOTH_ROUTES, {
          rows: [
            human(textBlock('first question')),
            parented(ai(textBlock('stored answer')), 'resp_last', REQUEST_URL),
          ],
          ephemerals: STATEFUL,
        }),
      expectation: checkParent(undefined),
    },
  ];
}

const REJECTION = (): Response =>
  new Response(
    JSON.stringify({
      error: { message: "Previous response with id 'resp_dead' not found." },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );

async function rejectedParent(): Promise<Observation> {
  const format = formatById('openai-responses');
  const provider = format.route.createProvider();
  const base = [
    human(textBlock('q0')),
    parented(ai(textBlock('a0')), 'resp_ok', REQUEST_URL),
    human(textBlock('q1')),
    parented(ai(textBlock('a1')), 'resp_dead', REQUEST_URL),
    human(textBlock('q2')),
  ];
  const first = await sendThrough(format, provider, {
    rows: base,
    ephemerals: STATEFUL,
    respond: (index) => (index === 0 ? REJECTION() : format.route.respond()),
  });
  const second = await sendThrough(format, provider, {
    rows: [...base, ai(textBlock('a2')), human(textBlock('q3'))],
    ephemerals: STATEFUL,
  });
  return { 'first source': first, 'second source, same provider': second };
}

function rejectedCases(): ExplicitCase[] {
  return [
    {
      name: 'responses parent: a rejected parent is not reused by a second source',
      review:
        'a rejected parent with a second source on the same provider instance',
      observe: rejectedParent,
      expectation: (observation) => {
        const first = observation['first source'];
        if (!Array.isArray(first) || first.length !== 2) {
          throw new Error('the rejected send should retry once');
        }
        usesParent(observation, 'second source, same provider', 'resp_ok');
      },
    },
  ];
}

const pdfBlock = (bytes: number): IContent['blocks'][number] => ({
  type: 'media',
  mimeType: 'application/pdf',
  encoding: 'base64',
  data: Buffer.alloc(bytes, 7).toString('base64'),
  filename: 'x.pdf',
});

async function pdfSend(
  secondBytes: number,
  pdfEnabled: boolean,
): Promise<Observation> {
  const half = Math.floor(PDF_AGGREGATE_MAX_BYTES / 2);
  const directory = await mkdtemp(join(tmpdir(), 'frozen-wire-pdf-'));
  const binding: MediaBinding = {
    resolver: new RequestMediaResolver(
      new LocalMediaStore({ rootDirectory: directory, quotaBytes: 1 << 20 }),
    ),
    budgetBytes: 1 << 30,
  };
  try {
    const sent: Observed[] = await sendFresh(
      formatById('openai-responses'),
      {
        rows: [
          human(pdfBlock(half)),
          human(pdfBlock(secondBytes)),
          human(textBlock('summarize')),
        ],
        ephemerals: { 'media.pdf.enabled': pdfEnabled },
      },
      binding,
    );
    return { 'openai-responses': sent };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function pdfCases(): ExplicitCase[] {
  const half = Math.floor(PDF_AGGREGATE_MAX_BYTES / 2);
  return [
    {
      name: 'responses pdf: two documents just below the 50,000,000 byte limit are sent',
      review: 'the 50,000,000-byte PDF threshold, below',
      observe: () => pdfSend(half - 3, true),
    },
    {
      name: 'responses pdf: two documents just above the 50,000,000 byte limit throw',
      review: 'the 50,000,000-byte PDF threshold, above',
      observe: () => pdfSend(half + 3, true),
      expectation: (observation) => {
        if (!JSON.stringify(observation).includes('threw')) {
          throw new Error('the oversized aggregate should be rejected');
        }
      },
    },
    {
      name: 'responses pdf: the same oversized documents are sent as notices when PDF input is disabled',
      review: 'PDF disabled',
      observe: () => pdfSend(half + 3, false),
    },
  ];
}

export function responsesCases(): ExplicitCase[] {
  return [...idCases(), ...parentCases(), ...rejectedCases(), ...pdfCases()];
}
