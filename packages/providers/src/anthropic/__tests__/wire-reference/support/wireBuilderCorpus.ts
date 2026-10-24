/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ContentBlock,
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SeededRandom } from '../../../../openai/__tests__/support/chatBodyCorpus.js';

/** A PNG header that announces `width` x `height`; enough for the image budget. */
export function pngOf(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

export const CURRENT_MODEL = 'claude-sonnet-4';
export const CURRENT_BASE_URL = 'https://api.anthropic.com';

const IDS = ['a', 'b', 'c', 'd'];
const TEXTS = [
  'hello',
  'line one\nline two',
  'quotes " and \\ backslash',
  'lone high \ud800 surrogate',
  'separators \u2028 and \u2029',
  '',
  '   ',
  'emoji \ud83d\ude00',
];
const TOOLS = ['read_file', 'oauth_search', 'run_shell'];

function imageBlock(random: SeededRandom): MediaBlock {
  const [width, height] = random.pick<[number, number]>([
    [10, 10],
    [3000, 20],
    [4096, 4096],
    [1500, 1500],
  ]);
  return {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: pngOf(width, height),
  };
}

function mediaBlock(random: SeededRandom): MediaBlock {
  switch (random.int(6)) {
    case 0:
      return {
        type: 'media',
        mimeType: 'application/pdf',
        encoding: 'base64',
        data: 'JVBERi0x',
        filename: random.chance(0.5) ? 'doc.pdf' : undefined,
      };
    case 1:
      return {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'url',
        data: 'https://example.com/a.png',
      };
    case 2:
      return {
        type: 'media',
        mimeType: 'video/mp4',
        encoding: 'base64',
        data: 'AAAAGGZ0eXA=',
      };
    default:
      return imageBlock(random);
  }
}

function text(random: SeededRandom): ContentBlock {
  if (random.chance(0.15))
    return { type: 'code', code: 'let a = 1;', language: 'ts' };
  return { type: 'text', text: random.pick(TEXTS) };
}

/**
 * A call whose id is not in `used` (and is added to it). The array route's
 * adjacency pass breaks on two calls with one id in one assistant message
 * (it throws, or removes a block that is not the result), and consecutive AI
 * rows merge into one message, so a run of AI rows never repeats an id. The
 * same id still comes back in later runs.
 */
function call(random: SeededRandom, used: Set<string>): ContentBlock[] {
  const free = IDS.filter((id) => !used.has(id));
  if (free.length === 0) return [];
  const id = random.pick(free);
  used.add(id);
  return [callBlock(random, `call_${id}`)];
}

function callBlock(random: SeededRandom, id: string): ContentBlock {
  return {
    type: 'tool_call',
    id,
    name: random.pick(TOOLS),
    parameters: random.pick<unknown>([
      {},
      { path: '/tmp/x', 3: 'three', 1: 'one' },
      '{"already":"json"}',
      'not json',
      null,
      ['array'],
    ]),
  };
}

function response(random: SeededRandom): ContentBlock {
  return {
    type: 'tool_response',
    callId: `call_${random.pick(IDS)}`,
    toolName: random.pick(TOOLS),
    result: random.pick<unknown>(['done', { ok: true }, 'x'.repeat(40), '']),
    error: random.chance(0.2) ? 'it failed' : undefined,
  };
}

function thinking(random: SeededRandom, kind: number): ContentBlock {
  const thought = `thought ${random.int(1000)}`;
  if (kind === 0)
    return {
      type: 'thinking',
      thought,
      sourceField: 'thinking',
      signature: 's',
    };
  if (kind === 1) return { type: 'thinking', thought, sourceField: 'thinking' };
  return { type: 'thinking', thought, sourceField: 'reasoning_content' };
}

function stamp(random: SeededRandom, row: IContent): IContent {
  const model = random.pick([undefined, CURRENT_MODEL, CURRENT_MODEL, 'other']);
  const baseUrl = random.pick([undefined, CURRENT_BASE_URL, 'https://other']);
  const anchored = random.chance(0.1);
  if (model === undefined && baseUrl === undefined && !anchored) return row;
  return {
    ...row,
    metadata: {
      ...(model === undefined ? {} : { model }),
      ...(baseUrl === undefined ? {} : { providerBaseURL: baseUrl }),
      ...(anchored ? { cacheAnchor: true } : {}),
    },
  };
}

function aiBlocks(
  random: SeededRandom,
  used: Set<string> = new Set(),
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (random.chance(0.3)) blocks.push(thinking(random, random.int(3)));
  if (random.chance(0.6)) blocks.push(text(random));
  const calls = random.chance(0.5) ? 1 + random.int(3) : 0;
  for (let index = 0; index < calls; index++)
    blocks.push(...call(random, used));
  return blocks;
}

function toolRow(random: SeededRandom): IContent {
  const blocks: ContentBlock[] = [];
  if (random.chance(0.25)) blocks.push(text(random));
  const answers = 1 + random.int(2);
  for (let index = 0; index < answers; index++) blocks.push(response(random));
  const media = random.chance(0.3) ? 1 + random.int(2) : 0;
  for (let index = 0; index < media; index++) blocks.push(mediaBlock(random));
  return { speaker: 'tool', blocks };
}

/** A row that gives a following run of AI rows something to merge into. */
function chainRows(random: SeededRandom, used: Set<string>): IContent[] {
  const rows: IContent[] = [
    stamp(random, {
      speaker: 'ai',
      blocks: [
        thinking(random, 0),
        ...(random.chance(0.3) ? [thinking(random, 0)] : []),
      ],
    }),
  ];
  const following = random.int(4);
  for (let index = 0; index < following; index++) {
    const blocks = aiBlocks(random, used);
    if (random.chance(0.2)) blocks.push(response(random), mediaBlock(random));
    rows.push(stamp(random, { speaker: 'ai', blocks }));
  }
  return rows;
}

function rowsFor(random: SeededRandom, run: Set<string>): IContent[] {
  switch (random.int(16)) {
    case 0:
    case 1:
      return [{ speaker: 'human', blocks: [text(random)] }];
    case 2:
      return [{ speaker: 'human', blocks: [text(random), mediaBlock(random)] }];
    case 3:
      return [
        {
          speaker: 'human',
          blocks: [
            response(random),
            ...(random.chance(0.5) ? [text(random)] : []),
          ],
        },
      ];
    case 4:
    case 5:
    case 6:
    case 7:
      return [stamp(random, { speaker: 'ai', blocks: aiBlocks(random, run) })];
    case 8:
    case 9:
      return chainRows(random, run);
    case 10:
      return [{ speaker: 'ai', blocks: [] }];
    case 11:
      return [
        {
          speaker: 'ai',
          blocks: [
            response(random),
            ...(random.chance(0.5) ? [text(random)] : []),
          ],
        },
      ];
    default:
      return [toolRow(random)];
  }
}

/**
 * A reproducible history drawn from a small id pool, so duplicate call ids,
 * orphan results, results that arrive after other messages, unanswered calls,
 * consecutive roles, thinking-only runs (with and without results of their
 * own), foreign-model thinking, images and documents all occur.
 */
export function wireHistory(seed: number): IContent[] {
  const random = new SeededRandom(seed);
  const rows: IContent[] = [];
  if (random.chance(0.15)) rows.push(toolRow(random));
  const length = 3 + random.int(16);
  // Call ids already issued by the run of AI rows that has not been broken yet.
  const run = new Set<string>();
  while (rows.length < length) {
    const added = rowsFor(random, run);
    if (added.some((row) => row.speaker !== 'ai')) run.clear();
    rows.push(...added);
  }
  return rows;
}
