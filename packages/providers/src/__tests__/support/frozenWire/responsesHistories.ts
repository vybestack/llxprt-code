/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: random Responses histories in the style of
 * `messageTableHistories.ts`. Short, drawn from a small id pool with
 * provider-normalization collisions (`''`, `call_`, `call_a`, `hist_tool_a`,
 * `toolu_a`), orphans, duplicates, encrypted reasoning with and without
 * genuine ids, PDFs, other media, rows that carry calls in non-AI speakers
 * and blockless rows.
 */

import type {
  ContentBlock,
  IContent,
  MediaBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SeededRandom } from '../../../openai/__tests__/support/chatBodyCorpus.js';

export const RESPONSES_ID_POOL: readonly string[] = [
  'a',
  'b',
  'c',
  'd',
  '',
  'call_',
  'call_a',
  'hist_tool_a',
  'toolu_a',
  'x!y',
  'call_xy',
  'toolu_xy',
  'hist_tool_x-y',
];

const TEXTS: readonly string[] = [
  'hello',
  'a "quoted" line \\ with backslash',
  'line one\nline two',
  'lone high \ud800 surrogate',
  'separators \u2028 and \u2029',
  'control \u0001\u001f',
  'emoji \ud83d\ude00 pair',
  '',
  ' ',
];

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function media(random: SeededRandom): MediaBlock {
  const kind = random.int(7);
  if (kind <= 1) {
    return {
      type: 'media',
      mimeType: 'application/pdf',
      encoding: 'base64',
      data: 'JVBERi0xLjQK',
      filename: random.chance(0.5) ? 'doc.pdf' : undefined,
    };
  }
  if (kind === 2) {
    return {
      type: 'media',
      mimeType: 'audio/wav',
      encoding: 'base64',
      data: 'UklGRg==',
    };
  }
  if (kind === 3) {
    return {
      type: 'media',
      mimeType: 'video/mp4',
      encoding: 'url',
      data: 'https://example.com/v.mp4',
    };
  }
  if (kind === 4) {
    return {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'url',
      data: 'https://example.com/a.png',
    };
  }
  return {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: PNG,
    caption: random.chance(0.3) ? 'cap' : undefined,
  };
}

function thinking(random: SeededRandom): ThinkingBlock {
  const base: ThinkingBlock = {
    type: 'thinking',
    thought: random.pick(TEXTS),
    sourceField: 'thinking',
  };
  const kind = random.int(4);
  if (kind === 0) return base;
  if (kind === 1) {
    return { ...base, encryptedContent: `ENC${random.int(100000)}` };
  }
  if (kind === 2) {
    return {
      ...base,
      encryptedContent: `ENC${random.int(100)}`,
      providerMetadata: {
        'openai.responses.reasoningId': `rs_genuine_${random.int(1000)}`,
      },
    };
  }
  return {
    ...base,
    encryptedContent: 'ENC',
    providerMetadata: {
      'openai.responses.reasoningId': `notrs_${random.int(10)}`,
    },
  };
}

function call(random: SeededRandom): ToolCallBlock {
  return {
    type: 'tool_call',
    id: random.pick(RESPONSES_ID_POOL),
    name: random.pick(['read_file', 'run', '']),
    parameters: random.pick<unknown>([
      {},
      { path: '/x' },
      'raw string',
      null,
      undefined,
      [1, 2],
    ]),
  };
}

function response(random: SeededRandom): ToolResponseBlock {
  return {
    type: 'tool_response',
    callId: random.pick(RESPONSES_ID_POOL),
    toolName: random.pick(['read_file', 'run', '']),
    result: random.pick<unknown>([
      'ok',
      { ok: true },
      null,
      'x'.repeat(random.int(200)),
      5,
    ]),
    error: random.chance(0.15) ? 'boom' : undefined,
    isComplete: random.chance(0.5) ? true : undefined,
  };
}

function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

function humanRow(random: SeededRandom, kind: number): IContent {
  if (kind < 3) {
    return { speaker: 'human', blocks: [textBlock(random.pick(TEXTS))] };
  }
  if (kind === 3) {
    return {
      speaker: 'human',
      blocks: [textBlock(random.pick(TEXTS)), media(random)],
    };
  }
  if (kind === 4) return { speaker: 'human', blocks: [media(random)] };
  return { speaker: 'human', blocks: [textBlock('q'), call(random)] };
}

function aiRow(random: SeededRandom, kind: number): IContent {
  switch (kind) {
    case 6:
    case 7:
      return { speaker: 'ai', blocks: [textBlock(random.pick(TEXTS))] };
    case 8:
      return { speaker: 'ai', blocks: [thinking(random), thinking(random)] };
    case 9:
      return {
        speaker: 'ai',
        blocks: [thinking(random), textBlock('after thinking')],
      };
    case 10:
    case 11:
      return { speaker: 'ai', blocks: [call(random)] };
    case 12:
      return {
        speaker: 'ai',
        blocks: [call(random), call(random), call(random)],
      };
    default:
      return {
        speaker: 'ai',
        blocks: [
          thinking(random),
          textBlock('before calls'),
          call(random),
          call(random),
        ],
      };
  }
}

function toolRow(random: SeededRandom, kind: number): IContent {
  if (kind === 14 || kind === 15) {
    return { speaker: 'tool', blocks: [response(random)] };
  }
  if (kind === 16) {
    return { speaker: 'tool', blocks: [response(random), response(random)] };
  }
  if (kind === 17) {
    return { speaker: 'tool', blocks: [response(random), media(random)] };
  }
  if (random.chance(0.5)) {
    return { speaker: 'tool', blocks: [call(random), response(random)] };
  }
  return {
    speaker: 'ai',
    blocks: [textBlock('ai with response'), response(random)],
  };
}

function row(random: SeededRandom): IContent {
  const kind = random.int(20);
  if (kind <= 5) return humanRow(random, kind);
  if (kind <= 13) return aiRow(random, kind);
  if (kind <= 18) return toolRow(random, kind);
  return { speaker: random.pick(['ai', 'human'] as const), blocks: [] };
}

export function responsesHistory(seed: number): IContent[] {
  const random = new SeededRandom(seed * 7919 + 13);
  const count = 3 + random.int(16);
  return Array.from({ length: count }, () => row(random));
}
