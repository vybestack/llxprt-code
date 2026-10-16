/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SeededRandom } from '../../../../openai/__tests__/support/chatBodyCorpus.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { buildProviderDumpBodyStream } from '../../../../utils/providerRequestConversion.js';
import { streamPrettyJson } from '../../../../utils/streamPrettyJson.js';

export function sourceOf(history: readonly IContent[]): HistoryDumpSource {
  return {
    async *rows(): AsyncIterable<IContent> {
      yield* structuredClone([...history]);
    },
  };
}

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}
function call(id: string): ContentBlock {
  return { type: 'tool_call', id, name: 'tool', parameters: { id } };
}
function ai(...blocks: ContentBlock[]): IContent {
  return { speaker: 'ai', blocks };
}
function answer(id: string): ContentBlock {
  return { type: 'tool_response', callId: id, toolName: 'tool', result: id };
}
function tool(...blocks: ContentBlock[]): IContent {
  return { speaker: 'tool', blocks };
}
function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

export interface ScaleScenario {
  readonly name: string;
  /** What the quadratic table did per unit of work, so a reader knows why it is here. */
  readonly stressed: string;
  readonly build: (units: number) => IContent[];
}

/**
 * Histories whose size grows by `units`. Each one makes a different pass of the
 * table do work for every unit: the id lookups, the displaced-result pulls,
 * the unlink inside one message, the predecessor search of a removal and the
 * existence check of the missing-result pass.
 */
export const SCALE_SCENARIOS: readonly ScaleScenario[] = [
  {
    name: 'call and answer pairs',
    stressed: 'orphan filter: one tool_use lookup per result',
    build: (units) =>
      range(units).flatMap((index) => [
        human(`question ${index}`),
        ai(call(`pair_${index}`)),
        tool(answer(`pair_${index}`)),
      ]),
  },
  {
    name: 'parallel calls answered in one message',
    stressed: 'one message holding every call and every result',
    build: (units) => [
      human('go'),
      ai(...range(units).map((index) => call(`parallel_${index}`))),
      tool(...range(units).map((index) => answer(`parallel_${index}`))),
    ],
  },
  {
    name: 'results displaced to the end of the history',
    stressed: 'adjacency pass: pull each result from a later message',
    build: (units) => [
      ...range(units).flatMap((index) => [
        ai(call(`late_${index}`)),
        human(`interrupt ${index}`),
      ]),
      tool(...range(units).map((index) => answer(`late_${index}`))),
    ],
  },
  {
    name: 'orphan results between user messages',
    stressed: 'orphan filter: remove each emptied message',
    build: (units) =>
      range(units).flatMap((index) => [
        human(`question ${index}`),
        tool(answer(`orphan_${index}`)),
        ai({ type: 'text', text: `reply ${index}` }),
      ]),
  },
  {
    name: 'calls whose next message is not a user message',
    stressed: 'missing-result pass: result existence check per call',
    build: (units) =>
      range(units).flatMap((index) => [
        ai(call(`dangling_${index}`)),
        ai({ type: 'text', text: `reply ${index}` }),
        human(`question ${index}`),
      ]),
  },
];

const MODELS: ReadonlyArray<string | undefined> = [
  undefined,
  'claude-sonnet-4',
  'claude-opus-5-5',
];
const POLICIES = ['none', 'all', 'allButLast'] as const;
const ID_POOL = ['a', 'b', 'c', 'd', 'e', 'f'];

function randomRow(random: SeededRandom): IContent {
  const id = (): string => `id_${random.pick(ID_POOL)}`;
  switch (random.int(9)) {
    case 0:
    case 1:
      return human(`human ${random.int(1000)}`);
    case 2:
      return ai({ type: 'text', text: `ai ${random.int(1000)}` });
    case 3:
      return ai(call(id()));
    case 4:
      return ai(call(id()), call(id()), call(id()));
    case 5:
      return ai({ type: 'text', text: 'before calls' }, call(id()), call(id()));
    case 6:
      return ai({
        type: 'thinking',
        thought: `thought ${random.int(1000)}`,
        sourceField: 'thinking',
        signature: 'sig',
      });
    case 7:
      return tool(answer(id()));
    default:
      return random.chance(0.5)
        ? tool(answer(id()), answer(id()))
        : tool(answer(id()), {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'YQ==',
          });
  }
}

/**
 * Short histories drawn from a small id pool, so duplicate call ids, orphan
 * results, results that arrive after other messages, unanswered calls,
 * consecutive roles and thinking-only runs all occur.
 */
export function randomHistory(seed: number): IContent[] {
  const random = new SeededRandom(seed);
  return range(3 + random.int(18)).map(() => randomRow(random));
}

export interface DumpCase {
  readonly seed: number;
  readonly policy: (typeof POLICIES)[number];
  readonly model: string | undefined;
}

export function dumpCase(seed: number): DumpCase {
  return {
    seed,
    policy: POLICIES[seed % POLICIES.length],
    model: MODELS[Math.floor(seed / POLICIES.length) % MODELS.length],
  };
}

/** The `/dump` bytes for Anthropic: what the table feeds, end to end. */
export async function dumpBytes(
  history: readonly IContent[],
  policy: DumpCase['policy'] = 'none',
  model?: string,
): Promise<string> {
  const body = buildProviderDumpBodyStream({
    providerName: 'anthropic',
    history: sourceOf(history),
    policy: {
      'reasoning.stripFromContext': policy,
      'reasoning.includeInContext': true,
    },
    model,
  });
  let bytes = '';
  for await (const chunk of streamPrettyJson(body)) bytes += chunk;
  return bytes;
}
