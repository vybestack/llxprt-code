/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { SeededRandom } from '../../../../openai/__tests__/support/chatBodyCorpus.js';
import { CURRENT_BASE_URL, CURRENT_MODEL } from './wireBuilderCorpus.js';
import type { StripPolicy, WireSettings } from './wireBuilderHarness.js';

const STRIPS: ReadonlyArray<StripPolicy | undefined> = [
  undefined,
  'none',
  'all',
  'allButLast',
];

/** Every setting the conversion reads, drawn reproducibly from the seed. */
export function settingsFor(seed: number): WireSettings {
  const random = new SeededRandom(seed * 7919 + 13);
  return {
    reasoningEnabled: random.chance(0.6),
    strip: random.pick(STRIPS),
    includeInContext: random.pick([undefined, true, false]),
    currentModel: random.pick([undefined, CURRENT_MODEL]),
    currentBaseURL: random.pick([undefined, CURRENT_BASE_URL]),
    supportsUrlImages: random.pick([undefined, true, false]),
    isOAuth: random.chance(0.3),
    imageBudget: random.chance(0.4) ? { maxDimension: 2000 } : undefined,
  };
}

export function everyReasoningSetting(
  base: Partial<WireSettings> = {},
): WireSettings[] {
  return [true, false].flatMap((reasoningEnabled) =>
    (['none', 'all', 'allButLast'] as const).flatMap((strip) =>
      [true, false].map((includeInContext) => ({
        currentModel: CURRENT_MODEL,
        currentBaseURL: CURRENT_BASE_URL,
        ...base,
        reasoningEnabled,
        strip,
        includeInContext,
      })),
    ),
  );
}
