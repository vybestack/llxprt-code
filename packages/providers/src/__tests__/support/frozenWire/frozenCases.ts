/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the frozen wire corpus generator.
 *
 * One corpus per provider format. Every case is a seed: the history comes
 * from a support generator that already exists in the tree and the settings
 * are one draw from the seed (`settingsFor(seed)` style). Both are pure
 * functions of the seed, so the corpus regenerates exactly. The only inputs
 * that are not literals are the clock (pinned by the test through
 * `setSystemTime`, which fixes the `rs_<time>_<n>` reasoning ids) and the
 * provider ids that the builders derive from the history.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  SeededRandom,
  seededHistory,
} from '../../../openai/__tests__/support/chatBodyCorpus.js';
import { randomHistory } from '../../../anthropic/__tests__/wire-reference/support/messageTableHistories.js';
import { wireHistory } from '../../../anthropic/__tests__/wire-reference/support/wireBuilderCorpus.js';
import { cacheHistory } from '../../../anthropic/__tests__/wire-reference/support/wireCacheCorpus.js';
import { WIRE_ROUTES, type WireRoute } from '../wireBodyCapture.js';
import { normalizedRows } from './normalizedRows.js';
import { responsesHistory } from './responsesHistories.js';

/** Seeds per format; the corpus covers seeds `0 .. SEEDS_PER_FORMAT - 1`. */
export const SEEDS_PER_FORMAT = 5000;

export const ANTHROPIC_CURRENT_MODEL = 'claude-sonnet-4';

export type RowForm = 'raw' | 'normalized';
export type CacheMode = 'off' | '5m' | '1h';
export type PurgeMode = 'off' | 'remove' | 'summary';

/** Everything the draw decides about a request besides its history. */
export interface FrozenSettings {
  readonly form: RowForm;
  readonly model: string;
  readonly ephemerals: Readonly<Record<string, unknown>>;
  readonly providerSettings: Readonly<Record<string, unknown>>;
  readonly systemInstruction: string | null;
}

export interface FrozenCase {
  readonly seed: number;
  readonly settings: FrozenSettings;
  readonly rows: readonly IContent[];
}

type Family = 'chat' | 'responses' | 'anthropic';

export interface FrozenFormat {
  readonly id: string;
  readonly family: Family;
  readonly route: WireRoute;
  /** The body member that holds the history the builders produce. */
  readonly historyMember: 'messages' | 'input';
  readonly cache?: CacheMode;
  /** Anthropic: draw the cache and purge modes from the seed. */
  readonly purgeCorpus: boolean;
}

function routeById(id: string): WireRoute {
  const route = WIRE_ROUTES.find((candidate) => candidate.id === id);
  if (route === undefined) throw new Error(`no wire route ${id}`);
  return route;
}

function anthropicRoute(id: string, mode: CacheMode): WireRoute {
  return {
    ...routeById('anthropic-cache-off'),
    id,
    providerSettings: { 'prompt-caching': mode },
  };
}

function chatFormat(id: string): FrozenFormat {
  return {
    id,
    family: 'chat',
    route: routeById(id),
    historyMember: 'messages',
    purgeCorpus: false,
  };
}

function responsesFormat(id: string): FrozenFormat {
  return {
    id,
    family: 'responses',
    route: routeById(id),
    historyMember: 'input',
    purgeCorpus: false,
  };
}

function anthropicFormat(
  id: string,
  cache: CacheMode,
  purgeCorpus: boolean,
): FrozenFormat {
  return {
    id,
    family: 'anthropic',
    route: anthropicRoute(id, cache),
    historyMember: 'messages',
    cache,
    purgeCorpus,
  };
}

export const FROZEN_FORMATS: readonly FrozenFormat[] = [
  chatFormat('openai-chat-plain'),
  chatFormat('openai-chat-kimi'),
  chatFormat('openai-chat-mistral'),
  responsesFormat('openai-responses-via-openai'),
  responsesFormat('openai-responses'),
  anthropicFormat('anthropic-cache-off', 'off', false),
  anthropicFormat('anthropic-cache-5m', '5m', false),
  anthropicFormat('anthropic-cache-1h', '1h', false),
  anthropicFormat('anthropic-purge-boundary', 'off', true),
];

export function formatById(id: string): FrozenFormat {
  const format = FROZEN_FORMATS.find((candidate) => candidate.id === id);
  if (format === undefined) throw new Error(`no frozen format ${id}`);
  return format;
}

const STRIPS: ReadonlyArray<string | undefined> = [
  undefined,
  'none',
  'all',
  'allButLast',
];

const SYSTEM_INSTRUCTIONS: ReadonlyArray<string | null> = [
  null,
  null,
  'You are a careful assistant.',
  'Edge "quotes" \\ and\nnewlines \u2028 and \ud83d\ude00',
];

/** A seed decorrelated from the one that draws the history. */
function settingsRandom(seed: number): SeededRandom {
  return new SeededRandom(seed * 104729 + 31);
}

function definedOnly(
  entries: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  );
}

function reasoningPolicy(random: SeededRandom): Record<string, unknown> {
  return definedOnly({
    'reasoning.stripFromContext': random.pick(STRIPS),
    'reasoning.includeInContext': random.pick<boolean | undefined>([
      undefined,
      true,
      false,
    ]),
  });
}

function drawForm(random: SeededRandom): RowForm {
  return random.chance(0.5) ? 'normalized' : 'raw';
}

function chatSettings(format: FrozenFormat, seed: number): FrozenSettings {
  const random = settingsRandom(seed);
  return {
    form: drawForm(random),
    model: format.route.model,
    ephemerals: reasoningPolicy(random),
    providerSettings: {},
    systemInstruction: random.pick(SYSTEM_INSTRUCTIONS),
  };
}

function responsesSettings(format: FrozenFormat, seed: number): FrozenSettings {
  const random = settingsRandom(seed);
  const form = drawForm(random);
  return {
    form,
    model: format.route.model,
    ephemerals: {
      ...reasoningPolicy(random),
      ...definedOnly({
        'media.pdf.enabled': random.pick<boolean | undefined>([
          undefined,
          true,
          false,
        ]),
      }),
    },
    providerSettings: {},
    systemInstruction: random.pick(SYSTEM_INSTRUCTIONS),
  };
}

function anthropicEphemerals(
  random: SeededRandom,
  purge: PurgeMode,
): Record<string, unknown> {
  return {
    ...definedOnly({
      'reasoning.enabled': random.chance(0.6),
      'max-image-dimension': random.chance(0.4) ? 2000 : undefined,
      'media.semantic-purge': purge === 'off' ? undefined : purge,
    }),
    ...reasoningPolicy(random),
  };
}

function anthropicSettings(format: FrozenFormat, seed: number): FrozenSettings {
  const random = settingsRandom(seed);
  const form = drawForm(random);
  const purge: PurgeMode = format.purgeCorpus
    ? random.pick<PurgeMode>(['remove', 'summary'])
    : 'off';
  const cache: CacheMode = format.purgeCorpus
    ? random.pick<CacheMode>(['off', '5m', '5m', '1h', '1h'])
    : (format.cache ?? 'off');
  return {
    form,
    model: random.pick([ANTHROPIC_CURRENT_MODEL, format.route.model]),
    ephemerals: anthropicEphemerals(random, purge),
    providerSettings: { 'prompt-caching': cache },
    systemInstruction: random.pick(SYSTEM_INSTRUCTIONS),
  };
}

export function settingsOf(format: FrozenFormat, seed: number): FrozenSettings {
  switch (format.family) {
    case 'chat':
      return chatSettings(format, seed);
    case 'responses':
      return responsesSettings(format, seed);
    case 'anthropic':
      return anthropicSettings(format, seed);
    default:
      throw new Error('unknown format family');
  }
}

/** A row the history store hands over without a block list has none. */
function withBlocks(row: IContent): IContent {
  return Reflect.has(row, 'blocks') ? row : { ...row, blocks: [] };
}

function anthropicHistory(format: FrozenFormat, seed: number): IContent[] {
  if (format.purgeCorpus) {
    return cacheHistory(seed, { anchors: true, purgeBoundary: true });
  }
  switch (seed % 3) {
    case 0:
      return wireHistory(seed);
    case 1:
      return randomHistory(seed);
    default:
      return cacheHistory(seed, { anchors: true, purgeBoundary: false });
  }
}

function openAiHistory(seed: number): IContent[] {
  switch (seed % 3) {
    case 0:
      return seededHistory(seed);
    case 1:
      return randomHistory(seed);
    default:
      return responsesHistory(seed);
  }
}

/** The raw rows of a seed, before the form of the settings is applied. */
export function rawHistoryOf(format: FrozenFormat, seed: number): IContent[] {
  const rows =
    format.family === 'anthropic'
      ? anthropicHistory(format, seed)
      : openAiHistory(seed);
  return rows.map(withBlocks);
}

export async function caseOf(
  format: FrozenFormat,
  seed: number,
): Promise<FrozenCase> {
  const settings = settingsOf(format, seed);
  const raw = rawHistoryOf(format, seed);
  const rows = settings.form === 'raw' ? raw : await normalizedRows(raw);
  return { seed, settings, rows };
}
