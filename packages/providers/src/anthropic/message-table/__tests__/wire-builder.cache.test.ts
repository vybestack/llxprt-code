/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  aiText,
  answerRow,
  callRow,
  text,
  thinkingOnly,
} from './support/wireBuilderRows.js';
import {
  CURRENT_BASE_URL,
  CURRENT_MODEL,
  pngOf,
} from './support/wireBuilderCorpus.js';
import {
  cachedCandidate,
  cachedOracle,
  describeDifference,
  type CacheSettings,
  type WireSettings,
} from './support/wireBuilderHarness.js';
import { settingsFor } from './support/wireBuilderSettings.js';
import { attachTailCacheControl } from '../cache-controls.js';
import { MessageTable } from '../message-table.js';
import { cacheHistory } from './support/wireCacheCorpus.js';

const TTLS: ReadonlyArray<CacheSettings['ttl']> = [undefined, '5m', '1h'];
const PREFIXES: ReadonlyArray<string | undefined> = [undefined, 'be careful'];

/** Every combination of caching, media purge and system placement. */
const EVERY_CACHE: readonly CacheSettings[] = TTLS.flatMap((ttl) =>
  [false, true].flatMap((mediaPurge) =>
    PREFIXES.map((contextPrefix) => ({ ttl, mediaPurge, contextPrefix })),
  ),
);

const PLAIN: WireSettings = {
  reasoningEnabled: false,
  currentModel: CURRENT_MODEL,
  currentBaseURL: CURRENT_BASE_URL,
};

interface Outcome {
  readonly difference: string | undefined;
  readonly preparation: string | undefined;
  readonly breakpoints: number;
}

async function compare(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings,
): Promise<Outcome> {
  const expected = cachedOracle(rows, settings, cache);
  const actual = await cachedCandidate(rows, settings, cache);
  const difference =
    describeDifference(expected.json, actual.json) ??
    (expected.evidence?.preparation === actual.evidence?.preparation
      ? undefined
      : `evidence ${expected.evidence?.preparation} but got ${actual.evidence?.preparation}`);
  return {
    difference,
    preparation: expected.evidence?.preparation,
    breakpoints: expected.json.split('"cache_control"').length - 1,
  };
}

interface Sweep {
  readonly found: string[];
  readonly preparations: Record<string, number>;
  readonly withBreakpoints: number;
  readonly cases: number;
}

async function sweep(
  seeds: Iterable<number>,
  history: (seed: number) => readonly IContent[],
  settingsOf: (seed: number) => WireSettings,
  caches: readonly CacheSettings[],
): Promise<Sweep> {
  const found: string[] = [];
  const preparations: Record<string, number> = {};
  let withBreakpoints = 0;
  let cases = 0;
  for (const seed of seeds) {
    const rows = history(seed);
    for (const [index, cache] of caches.entries()) {
      const outcome = await compare(rows, settingsOf(seed), cache);
      cases++;
      if (outcome.breakpoints > 0) withBreakpoints++;
      if (outcome.preparation !== undefined)
        preparations[outcome.preparation] =
          (preparations[outcome.preparation] ?? 0) + 1;
      if (outcome.difference !== undefined)
        found.push(
          `seed ${seed} / ${index} ${JSON.stringify(cache)}: ${outcome.difference}`,
        );
    }
  }
  return { found, preparations, withBreakpoints, cases };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index);
}

describe('cache controls on the table over seeded histories', () => {
  it('place every breakpoint where the array route does, anchors and purge boundaries included', async () => {
    const result = await sweep(
      range(0, 160),
      (seed) => cacheHistory(seed, { anchors: true, purgeBoundary: true }),
      settingsFor,
      EVERY_CACHE,
    );
    expect(result.found).toStrictEqual([]);
    // The corpus must reach the boundary outcomes, or the comparison proves little.
    expect(result.preparations['added']).toBeGreaterThan(5);
    expect(result.withBreakpoints).toBeGreaterThan(result.cases / 3);
  }, 180_000);

  it('agree with anchors off', async () => {
    const result = await sweep(
      range(200, 300),
      (seed) => cacheHistory(seed, { anchors: false, purgeBoundary: true }),
      settingsFor,
      EVERY_CACHE,
    );
    expect(result.found).toStrictEqual([]);
  }, 180_000);

  it('agree with no purge boundary', async () => {
    const result = await sweep(
      range(300, 400),
      (seed) => cacheHistory(seed, { anchors: true, purgeBoundary: false }),
      settingsFor,
      EVERY_CACHE,
    );
    expect(result.found).toStrictEqual([]);
  }, 180_000);
});

function image(): IContent['blocks'][number] {
  return {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: pngOf(10, 10),
  };
}

function tagged(
  row: IContent,
  blockIndex: number,
  boundaryId: object,
): IContent {
  return {
    ...row,
    metadata: {
      ...row.metadata,
      semanticMediaPurgeBoundary: { blockIndex, boundaryId },
    },
  };
}

function anchored(row: IContent): IContent {
  return { ...row, metadata: { ...row.metadata, cacheAnchor: true } };
}

async function expectEqual(
  label: string,
  rows: readonly IContent[],
  settings: readonly WireSettings[],
): Promise<string[]> {
  const found: string[] = [];
  for (const setting of settings)
    for (const cache of EVERY_CACHE) {
      const outcome = await compare(rows, setting, cache);
      if (outcome.difference !== undefined)
        found.push(
          `${label} ${JSON.stringify(setting)} ${JSON.stringify(cache)}: ${outcome.difference}`,
        );
    }
  return found;
}

const SETTINGS: readonly WireSettings[] = [
  PLAIN,
  { ...PLAIN, reasoningEnabled: true },
  { ...PLAIN, reasoningEnabled: true, strip: 'allButLast' },
  { ...PLAIN, currentModel: 'claude-3-opus-20240229' },
];

describe('cache controls on the table over targeted histories', () => {
  it('put the last-message breakpoint on strings, tool results and non-thinking blocks', async () => {
    const histories: Record<string, IContent[]> = {
      'string at the tail': [text('q'), aiText('answer'), text('last')],
      'blank string at the tail': [text('q'), aiText('   ')],
      'tool result at the tail': [text('q'), callRow('a'), answerRow('a')],
      'tool results at the tail, one empty': [
        text('q'),
        callRow('a', 'b'),
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'a',
              toolName: 'read_file',
              result: 'full',
            },
            {
              type: 'tool_response',
              callId: 'b',
              toolName: 'read_file',
              result: '',
            },
          ],
        },
      ],
      'thinking at the tail': [
        text('q'),
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'visible' },
            {
              type: 'thinking',
              thought: 'last thought',
              sourceField: 'thinking',
              signature: 's',
            },
          ],
        },
      ],
      'only thinking at the tail': [text('q'), thinkingOnly('alone')],
      'tool call at the tail': [text('q'), callRow('a')],
      'empty tail': [text('q'), { speaker: 'ai', blocks: [] }],
      'merged user messages': [
        text('one'),
        text('two'),
        callRow('a'),
        text('between'),
        answerRow('a'),
        text('three'),
      ],
    };
    const found: string[] = [];
    for (const [label, rows] of Object.entries(histories))
      found.push(...(await expectEqual(label, rows, SETTINGS)));
    expect(found).toStrictEqual([]);
    const thinkingTail = cachedOracle(
      histories['thinking at the tail'],
      PLAIN,
      {
        ttl: '5m',
      },
    ).json;
    expect(thinkingTail).toContain('"text":"visible","cache_control"');
  });

  it('keep the anchor where the converter tagged it, flush or merge or not', async () => {
    const histories: Record<string, IContent[]> = {
      'anchor on the first row': [
        anchored(text('head')),
        aiText('a'),
        text('q'),
      ],
      'anchor on a blank string': [
        anchored(text('  ')),
        aiText('a'),
        text('q'),
      ],
      'anchor on the last row': [
        text('q'),
        aiText('a'),
        anchored(text('last')),
      ],
      'anchor on an AI row with tool calls': [
        text('q'),
        anchored(callRow('a')),
        answerRow('a'),
        text('after'),
      ],
      'anchor on the first of two tool rows': [
        text('q'),
        callRow('a', 'b'),
        anchored(answerRow('a')),
        answerRow('b'),
        text('after'),
      ],
      'anchor on the second of two tool rows': [
        text('q'),
        callRow('a', 'b'),
        answerRow('a'),
        anchored(answerRow('b')),
        text('after'),
      ],
      'anchor on tool rows at the end': [
        text('q'),
        callRow('a'),
        anchored(answerRow('a')),
      ],
      'anchor on a human row with only a tool response': [
        text('q'),
        callRow('a'),
        anchored({
          speaker: 'human',
          blocks: [
            {
              type: 'tool_response',
              callId: 'a',
              toolName: 'read_file',
              result: 'r',
            },
          ],
        }),
        callRow('b'),
        answerRow('b'),
        text('after'),
      ],
      'anchor on a row that merges into its neighbour': [
        anchored(text('one')),
        text('two'),
        aiText('a'),
      ],
      'anchor on a string that a displaced result is pulled into': [
        text('q'),
        callRow('a'),
        anchored(text('interrupt')),
        answerRow('a'),
      ],
      'anchor on the last row of a thinking run': [
        text('q'),
        thinkingOnly('t'),
        aiText('then'),
        anchored(callRow('a')),
        answerRow('a'),
      ],
      'anchor on the middle row of a thinking run': [
        text('q'),
        thinkingOnly('t'),
        anchored(aiText('then')),
        callRow('a'),
        answerRow('a'),
      ],
      'two anchors': [
        anchored(text('first')),
        aiText('a'),
        anchored(text('second')),
      ],
    };
    const found: string[] = [];
    for (const [label, rows] of Object.entries(histories))
      found.push(...(await expectEqual(label, rows, SETTINGS)));
    expect(found).toStrictEqual([]);
  });

  it('give empty rows their placeholder without anchoring or caching it as content', async () => {
    const empty = (speaker: 'ai' | 'human'): IContent => ({
      speaker,
      blocks: [],
    });
    // A thinking block with no signature and no thought converts to nothing,
    // so a run that starts with it and ends in an empty row has no blocks.
    const unsignedEmptyThinking = (): IContent => ({
      speaker: 'ai',
      blocks: [{ type: 'thinking', thought: '', sourceField: 'thinking' }],
    });
    const histories: Record<string, IContent[]> = {
      'anchored empty AI row between questions': [
        text('q'),
        anchored(empty('ai')),
        text('q2'),
        aiText('a'),
      ],
      'anchored empty AI row first': [
        anchored(empty('ai')),
        text('q'),
        aiText('a'),
      ],
      'anchored blank AI text between questions': [
        text('q'),
        anchored(aiText('   ')),
        text('q2'),
        aiText('a'),
      ],
      'anchored empty human row': [
        text('q'),
        aiText('a'),
        anchored(empty('human')),
        aiText('b'),
        text('q2'),
      ],
      'unanchored empty rows': [
        empty('human'),
        empty('ai'),
        text('q'),
        empty('ai'),
        text('q2'),
        aiText('a'),
      ],
      'anchored run that converts to nothing': [
        text('q'),
        unsignedEmptyThinking(),
        anchored({ speaker: 'ai', blocks: [] }),
        text('q2'),
        aiText('a'),
      ],
      'unanchored run that converts to nothing': [
        text('q'),
        unsignedEmptyThinking(),
        { speaker: 'ai', blocks: [] },
        text('q2'),
        aiText('a'),
      ],
      'anchored empty AI row before an image': [
        text('q'),
        anchored(empty('ai')),
        { speaker: 'human', blocks: [image()] },
      ],
    };
    const found: string[] = [];
    for (const [label, rows] of Object.entries(histories))
      found.push(...(await expectEqual(label, rows, SETTINGS)));
    expect(found).toStrictEqual([]);
  });

  it('add, reuse or skip the purge boundary breakpoint like the array route', async () => {
    const boundaryId = Object.freeze({});
    const picture: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'look' }, image()],
    };
    const imageFirst: IContent = {
      speaker: 'human',
      blocks: [image(), { type: 'text', text: 'x' }],
    };
    const toolBoundary = (): IContent => ({
      ...answerRow('a'),
      metadata: { semanticMediaPurgeBoundary: { blockIndex: 0, boundaryId } },
    });
    const histories: Record<string, IContent[]> = {
      'boundary on the text before the image': [
        text('q'),
        aiText('seen'),
        tagged(picture, 0, boundaryId),
        aiText('ok'),
      ],
      'boundary on the message before an image-first message': [
        text('q'),
        tagged(aiText('seen'), 0, boundaryId),
        imageFirst,
        aiText('ok'),
      ],
      'boundary on a string row before an image-first message': [
        aiText('a'),
        tagged(text('plain prefix'), 0, boundaryId),
        imageFirst,
        aiText('ok'),
      ],
      'boundary on an anchored tool result': [
        text('q'),
        callRow('a'),
        anchored(toolBoundary()),
        imageFirst,
        aiText('ok'),
      ],
      'boundary on a tool result whose run is anchored later': [
        text('q'),
        callRow('a', 'b'),
        toolBoundary(),
        anchored(answerRow('b')),
        imageFirst,
        aiText('ok'),
      ],
      'boundary on a string row that is also the anchor': [
        text('q'),
        anchored(tagged(aiText('seen'), 0, boundaryId)),
        imageFirst,
        aiText('ok'),
      ],
      'boundary is the tail': [
        text('q'),
        aiText('seen'),
        picture,
        tagged(aiText('mid'), 0, boundaryId),
      ],
      'boundary not before the image': [
        text('q'),
        tagged(aiText('mid'), 0, boundaryId),
        aiText('seen'),
        picture,
        aiText('ok'),
      ],
      'boundary and no image': [
        tagged(text('prefix'), 0, boundaryId),
        aiText('seen'),
        text('q'),
      ],
      'image and no boundary': [text('p'), aiText('seen'), picture],
      'boundary on a tool result before an image-first message': [
        text('q'),
        callRow('a'),
        toolBoundary(),
        imageFirst,
        aiText('ok'),
      ],
      'boundary on a tool result that a later message displaces': [
        text('q'),
        callRow('a'),
        text('interrupt'),
        toolBoundary(),
        imageFirst,
        aiText('ok'),
      ],
    };
    const found: string[] = [];
    for (const [label, rows] of Object.entries(histories))
      found.push(...(await expectEqual(label, rows, SETTINGS)));
    expect(found).toStrictEqual([]);
    const outcome = (label: string): string | undefined =>
      cachedOracle(histories[label], PLAIN, { ttl: '5m', mediaPurge: true })
        .evidence?.preparation;
    expect(outcome('boundary on the text before the image')).toBe('added');
    expect(
      outcome('boundary on the message before an image-first message'),
    ).toBe('added');
    expect(outcome('boundary on an anchored tool result')).toBe('reused');
    expect(
      outcome('boundary on a string row that is also the anchor'),
    ).toBeUndefined();
    expect(outcome('boundary is the tail')).toBeUndefined();
    expect(outcome('boundary not before the image')).toBeUndefined();
    expect(
      outcome('boundary on a tool result before an image-first message'),
    ).toBe('added');
  });

  it('skip the boundary when the system prefix, the anchor and the tail use every slot', async () => {
    const boundaryId = Object.freeze({});
    const rows: IContent[] = [
      anchored(text('stable')),
      aiText('seen'),
      tagged(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'look' }, image()],
        },
        0,
        boundaryId,
      ),
      aiText('tail'),
    ];
    const cache: CacheSettings = {
      ttl: '1h',
      mediaPurge: true,
      contextPrefix: 'rules',
    };
    const expected = cachedOracle(rows, PLAIN, cache);
    const actual = await cachedCandidate(rows, PLAIN, cache);
    expect(actual.json).toBe(expected.json);
    expect(expected.evidence).toBeUndefined();
    expect(expected.json.split('"cache_control"').length - 1).toBe(3);
    const free = { ...cache, contextPrefix: undefined };
    expect(cachedOracle(rows, PLAIN, free).evidence?.preparation).toBe('added');
    expect(
      (await cachedCandidate(rows, PLAIN, free)).evidence?.preparation,
    ).toBe('added');
  });
});

describe('a string message that takes a breakpoint', () => {
  it('becomes one block and leaves its string-only cache tags behind', () => {
    const table = new MessageTable();
    try {
      const id = table.append({ role: 'user', content: 'tail' });
      const tagged = table.messages.read(id);
      tagged.anchorText = true;
      tagged.purgeText = true;
      table.messages.replace(id, tagged);
      attachTailCacheControl(table, '5m', { debug: () => undefined });
      const message = table.messages.read(id);
      expect(message.text).toBeUndefined();
      expect(message.anchorText).toBeUndefined();
      expect(message.purgeText).toBeUndefined();
      expect(JSON.stringify(table.blocks.read(message.head).block)).toBe(
        '{"type":"text","text":"tail","cache_control":{"type":"ephemeral","ttl":"5m"}}',
      );
    } finally {
      table.close();
    }
  });
});
