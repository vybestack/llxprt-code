/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0 (design 13.1 item 5d): the Anthropic media purge
 * boundary. A history row can carry a boundary tag; when semantic purge is
 * on, prompt caching is on and the tag sits exactly on the last cacheable
 * block before the oldest image, the request preparation puts one more
 * `cache_control` on that block. Each case records the bytes of the real
 * send, for raw and normalized rows, and what the array route's purge pass
 * returned for the same rows.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { cachedOracle } from '../../../../anthropic/message-table/__tests__/support/wireBuilderHarness.js';
import { pngOf } from '../../../../anthropic/message-table/__tests__/support/wireBuilderCorpus.js';
import { formatById } from '../frozenCases.js';
import { normalizedRows } from '../normalizedRows.js';
import type {
  ExplicitCase,
  Observation,
  PreparationObservation,
} from './explicitCase.js';
import { bodyOf } from './explicitObserve.js';
import { sendFresh, type ExplicitSend, type Observed } from './explicitSend.js';
import {
  ai,
  callBlock,
  human,
  imageBlock,
  responseBlock,
  textBlock,
  tool,
} from './rowBuilders.js';

type Cache = 'off' | '5m' | '1h';
type Expected = 'added' | 'reused' | 'none';

const CACHES: readonly Cache[] = ['off', '5m', '1h'];
const OAUTH_TOKEN = 'sk-ant-oat01-test-token';
const PURGE_FORMAT = 'anthropic-purge-boundary';
const MODEL = 'claude-opus-5';
const BASE_URL = 'https://api.anthropic.com';

const image = (): ReturnType<typeof imageBlock> => imageBlock(pngOf(10, 10));

function tagged(
  row: IContent,
  blockIndex: number,
  extra: Partial<NonNullable<IContent['metadata']>> = {},
): IContent {
  return {
    ...row,
    metadata: {
      ...row.metadata,
      semanticMediaPurgeBoundary: {
        blockIndex,
        boundaryId: Object.freeze({}),
      },
      ...extra,
    },
  };
}

function anchored(row: IContent): IContent {
  return { ...row, metadata: { ...row.metadata, cacheAnchor: true } };
}

export interface PurgeScenario {
  readonly position: string;
  readonly rows: readonly IContent[];
  /** What the purge pass is expected to do when caching is on. */
  readonly expected: Expected;
  /** The real send throws this instead of writing a body. */
  readonly sendThrows?: string;
  /** Context prefix under OAuth placement: puts a breakpoint in the messages. */
  readonly oauthPrefix?: string;
}

const TAIL = [ai(textBlock('seen')), human(textBlock('tail'))];

export const PURGE_SCENARIOS: readonly PurgeScenario[] = [
  {
    position: 'a string-content message',
    expected: 'added',
    rows: [
      human(textBlock('q')),
      tagged(ai(textBlock('reply')), 0),
      human(image()),
      ...TAIL,
    ],
  },
  {
    position: 'an array block in the image message',
    expected: 'added',
    rows: [
      human(textBlock('q')),
      ai(textBlock('reply')),
      tagged(human(textBlock('look'), image()), 0),
      ...TAIL,
    ],
  },
  {
    position: 'a block inside a merged run',
    expected: 'added',
    rows: [
      human(textBlock('p1')),
      tagged(human(textBlock('p2')), 0),
      human(image()),
      ...TAIL,
    ],
  },
  {
    position:
      'the first block of a message, previous cacheable block in an earlier message',
    expected: 'added',
    rows: [
      human(textBlock('q')),
      tagged(ai(textBlock('r1'), textBlock('r2')), 1),
      human(image()),
      ...TAIL,
    ],
  },
  {
    position: 'a message with no cacheable block before the image',
    expected: 'none',
    rows: [
      human(image()),
      tagged(ai(textBlock('seen')), 0),
      human(textBlock('tail')),
    ],
  },
  {
    position: 'no image',
    expected: 'none',
    rows: [
      human(textBlock('q')),
      tagged(ai(textBlock('reply')), 0),
      human(textBlock('tail')),
    ],
  },
  {
    // The array route applies none; the real send refuses the request.
    position: 'two boundary tags',
    expected: 'none',
    sendThrows: 'conflicting semantic purge boundaries',
    rows: [
      tagged(human(textBlock('q')), 0),
      tagged(ai(textBlock('reply')), 0),
      human(image()),
      ...TAIL,
    ],
  },
  {
    position: 'all three breakpoint slots in use',
    expected: 'none',
    oauthPrefix: 'Be careful.',
    rows: [
      anchored(human(textBlock('q'))),
      tagged(ai(textBlock('reply')), 0),
      human(image()),
      ...TAIL,
    ],
  },
  {
    position: 'a block that already carries cache_control',
    expected: 'reused',
    rows: [
      human(textBlock('q')),
      ai(callBlock('a')),
      tagged(anchored(tool(responseBlock('a'))), 0),
      human(image(), textBlock('x')),
      ...TAIL,
    ],
  },
  {
    // The anchor pass turns the string into a block array before the purge
    // pass looks for string-content tags, so this boundary is never found.
    position: 'a string-content boundary that is also the anchor',
    expected: 'none',
    rows: [
      human(textBlock('q')),
      tagged(anchored(ai(textBlock('reply'))), 0),
      human(image()),
      ...TAIL,
    ],
  },
];

function sendFor(
  scenario: PurgeScenario,
  cache: Cache,
  rows: readonly IContent[],
): ExplicitSend {
  return {
    rows,
    ephemerals: {
      'reasoning.enabled': false,
      'media.semantic-purge': 'remove',
    },
    providerSettings: { 'prompt-caching': cache },
    ...(scenario.oauthPrefix === undefined
      ? {}
      : { authToken: OAUTH_TOKEN, systemInstruction: scenario.oauthPrefix }),
  };
}

/** The array route's purge pass over the same rows: the reference evidence. */
function arrayRoute(
  scenario: PurgeScenario,
  cache: Cache,
): PreparationObservation {
  const wired = cachedOracle(
    scenario.rows,
    {
      reasoningEnabled: false,
      currentModel: MODEL,
      currentBaseURL: BASE_URL,
      supportsUrlImages: true,
      isOAuth: scenario.oauthPrefix !== undefined,
    },
    {
      ...(cache === 'off' ? {} : { ttl: cache }),
      mediaPurge: true,
      ...(scenario.oauthPrefix === undefined
        ? {}
        : { contextPrefix: scenario.oauthPrefix }),
    },
  );
  return {
    preparation: wired.evidence?.preparation ?? 'none',
    messagesBytes: Buffer.byteLength(wired.json),
  };
}

/** Core normalization refuses rows that carry two boundary identities. */
async function normalizedSend(
  scenario: PurgeScenario,
  cache: Cache,
): Promise<Observed[]> {
  let rows: IContent[];
  try {
    rows = await normalizedRows(scenario.rows);
  } catch (error) {
    return [{ threw: error instanceof Error ? error.message : String(error) }];
  }
  return sendFresh(formatById(PURGE_FORMAT), sendFor(scenario, cache, rows));
}

async function observe(
  scenario: PurgeScenario,
  cache: Cache,
): Promise<Observation> {
  return {
    raw: await sendFresh(
      formatById(PURGE_FORMAT),
      sendFor(scenario, cache, scenario.rows),
    ),
    normalized: await normalizedSend(scenario, cache),
    'array route': arrayRoute(scenario, cache),
  };
}

function expectation(scenario: PurgeScenario, cache: Cache) {
  const expected: Expected = cache === 'off' ? 'none' : scenario.expected;
  return (observation: Observation): void => {
    const reference = observation['array route'] as PreparationObservation;
    if (reference.preparation !== expected) {
      throw new Error(
        `the purge pass returned ${reference.preparation}, not ${expected}`,
      );
    }
    if (scenario.sendThrows !== undefined) {
      if (!JSON.stringify(observation['raw']).includes(scenario.sendThrows)) {
        throw new Error(`the send should throw ${scenario.sendThrows}`);
      }
      return;
    }
    const written = bodyOf(observation, 'raw').member;
    if (written !== reference.messagesBytes) {
      throw new Error(
        `the send wrote ${written} message bytes, the array route ${reference.messagesBytes}`,
      );
    }
  };
}

export function purgeBoundaryCases(): ExplicitCase[] {
  return PURGE_SCENARIOS.flatMap((scenario) =>
    CACHES.map((cache) => ({
      name: `purge boundary: ${scenario.position}, cache ${cache}`,
      review: 'design 13.1 item 5d',
      observe: () => observe(scenario, cache),
      expectation: expectation(scenario, cache),
    })),
  );
}
