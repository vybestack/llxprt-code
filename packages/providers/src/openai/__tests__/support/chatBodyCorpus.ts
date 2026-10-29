/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ContentBlock,
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** Small deterministic generator (mulberry32) so a failing seed replays. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(below: number): number {
    return Math.floor(this.next() * below);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(values.length)];
  }
}

const TEXTS = [
  'hello',
  'a longer line of user text with "quotes" and \\ backslashes',
  'line one\nline two',
  'lone high \ud800 surrogate',
  'lone low \udc00 surrogate',
  'separators \u2028 and \u2029 here',
  'control \u0001\u001f chars',
  'emoji \ud83d\ude00 pair',
  '',
  ' ',
];

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TOOL_NAMES = ['read_file', 'get_weather', 'run_shell', 'search'];

function randomId(random: SeededRandom): string {
  const tail = random.int(1_000_000).toString(36);
  return random.pick([
    `call_${tail}abcdef`,
    `toolu_01${tail}`,
    `functions.read_file:${random.int(9)}`,
    `hist_tool_${tail}`,
    `ab${tail}`.padEnd(9, 'x'),
    `weird id ${tail}`,
    `call_${tail}`,
  ]);
}

function mediaBlock(random: SeededRandom): MediaBlock {
  const kind = random.int(6);
  if (kind === 0)
    return {
      type: 'media',
      mimeType: 'application/pdf',
      encoding: 'base64',
      data: 'JVBERi0x',
      filename: random.chance(0.5) ? 'doc.pdf' : undefined,
    };
  if (kind === 1)
    return {
      type: 'media',
      mimeType: 'video/mp4',
      encoding: 'base64',
      data: 'AAAAGGZ0eXA=',
    };
  if (kind === 2)
    return {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'url',
      data: 'https://example.com/a.png',
    };
  return {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: PNG,
  };
}

function toolCallArguments(random: SeededRandom): unknown {
  return random.pick<unknown>([
    {},
    { path: '/tmp/x', depth: random.int(5) },
    '{"already":"json"}',
    'not json',
    '',
    null,
    ['array', 'value'],
    { nested: { text: random.pick(TEXTS) } },
  ]);
}

function thinkingBlock(random: SeededRandom): ContentBlock {
  return {
    type: 'thinking',
    thought: random.pick(TEXTS),
    sourceField: random.pick(['thinking', 'reasoning_content'] as const),
  };
}

interface IssuedCall {
  readonly id: string;
  readonly name: string;
}

function aiRow(random: SeededRandom, issued: IssuedCall[]): IContent {
  const blocks: ContentBlock[] = [];
  if (random.chance(0.4)) blocks.push(thinkingBlock(random));
  if (random.chance(0.6))
    blocks.push({ type: 'text', text: random.pick(TEXTS) });
  const calls = random.chance(0.5) ? 1 + random.int(3) : 0;
  for (let call = 0; call < calls; call++) {
    const id =
      issued.length > 0 && random.chance(0.15)
        ? random.pick(issued).id
        : randomId(random);
    const name = random.pick(TOOL_NAMES);
    issued.push({ id, name });
    blocks.push({
      type: 'tool_call',
      id,
      name,
      parameters: toolCallArguments(random),
    });
  }
  return { speaker: 'ai', blocks };
}

function toolRow(random: SeededRandom, issued: IssuedCall[]): IContent {
  const blocks: ContentBlock[] = [];
  const answers = 1 + random.int(3);
  for (let answer = 0; answer < answers; answer++) {
    const known =
      issued.length > 0 && random.chance(0.8)
        ? random.pick(issued.slice(-4))
        : { id: randomId(random), name: random.pick(TOOL_NAMES) };
    blocks.push({
      type: 'tool_response',
      callId: known.id,
      toolName: known.name,
      result: random.pick<unknown>([
        random.pick(TEXTS),
        { ok: true, lines: random.int(100) },
        'x'.repeat(random.int(300)),
      ]),
      error: random.chance(0.15) ? 'it failed' : undefined,
    });
  }
  const media = random.chance(0.3) ? 1 + random.int(3) : 0;
  for (let item = 0; item < media; item++) blocks.push(mediaBlock(random));
  return { speaker: 'tool', blocks };
}

function humanRow(random: SeededRandom): IContent {
  const blocks: ContentBlock[] = [{ type: 'text', text: random.pick(TEXTS) }];
  if (random.chance(0.25)) blocks.push(mediaBlock(random));
  if (random.chance(0.1)) blocks.unshift(thinkingBlock(random));
  return { speaker: 'human', blocks };
}

/** A row the history store would hand over without a block list. */
export function blocklessRow(speaker: IContent['speaker']): IContent {
  return JSON.parse(JSON.stringify({ speaker }));
}

/**
 * A reproducible history mixing every shape the chat conversion has a rule
 * for: tool calls that are answered, orphaned or repeated, results with no
 * call, runs of tool rows with media, thinking blocks, rows without blocks.
 */
export function seededHistory(seed: number): IContent[] {
  const random = new SeededRandom(seed);
  const issued: IssuedCall[] = [];
  const rows: IContent[] = [];
  const length = 4 + random.int(18);
  for (let row = 0; row < length; row++) {
    const kind = random.int(10);
    if (kind < 2) rows.push(humanRow(random));
    else if (kind < 5) rows.push(aiRow(random, issued));
    else if (kind < 8) rows.push(toolRow(random, issued));
    else if (kind === 8) rows.push(blocklessRow(random.pick(['ai', 'human'])));
    else rows.push({ speaker: 'ai', blocks: [thinkingBlock(random)] });
  }
  return rows;
}
