/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { projectOpenAIResponsesPromptEnvelope } from '../runtime/promptEnvelopeProjections.js';
import { estimateGpt56Prompt } from './Gpt56O200kPromptEstimator.js';

interface UsageObservation {
  readonly category: CorpusCategory;
  readonly controlTokens: number;
  readonly heldoutTokens: number;
  readonly providerDelta: number;
}

type CorpusCategory = 'prose' | 'code' | 'json' | 'unicode' | 'mixed';

const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/gpt56-provider-usage-v1.json', import.meta.url),
    'utf8',
  ),
) as { readonly observations: readonly UsageObservation[] };

const replyDirective =
  ' Reply with exactly the two characters OK and nothing else.';

function buildPrompt(category: CorpusCategory, scale: number): string {
  return buildPayload(category, scale) + replyDirective;
}

function buildPayload(category: CorpusCategory, scale: number): string {
  switch (category) {
    case 'prose':
      return 'The quick brown fox jumps over the lazy dog while a merchant inspects each ledger entry for accuracy before sealing the envelope and dispatching it via the afternoon courier service. '.repeat(
        scale * 3,
      );
    case 'code':
      return Array.from(
        { length: scale * 4 },
        () =>
          'function computeChecksum(values) { return values.reduce((acc, v) => (acc * 31 + v) >>> 0, 0); } // deterministic checksum',
      ).join('\n');
    case 'json':
      return buildJsonPayload(scale);
    case 'unicode':
      return '日本語のテキストです。한국어 텍스트입니다. Русский текст. Ελληνικό κείμενο. العربية. '.repeat(
        scale * 2,
      );
    case 'mixed':
      return buildMixedPayload(scale);
    default: {
      const exhaustive: never = category;
      throw new Error(`Unknown corpus category: ${String(exhaustive)}`);
    }
  }
}

function buildJsonPayload(scale: number): string {
  const entries = Array.from(
    { length: scale * 5 },
    (_, index) =>
      `{"id":${index},"name":"item_${index}","tags":["alpha","beta"],"meta":{"weight":${index}.5,"enabled":true}}`,
  );
  return `[${entries.join(',')}]`;
}

function buildMixedPayload(scale: number): string {
  const block = `Repeat-safe block ${scale}: <tool name="search"><query>tokenization boundary ${scale}</query></tool> — "punctuation; semicolons; brackets [a] {b} (c)" — unicode 日本語 — done.`;
  return Array.from({ length: scale * 3 }, () => block).join('\n');
}

function request(promptText: string) {
  const projection = projectOpenAIResponsesPromptEnvelope({
    model: 'gpt-5.6-sol',
    input: promptText,
  });
  return {
    activeProvider: 'codex-alias',
    canonicalModel: 'gpt-5.6-sol',
    protocol: projection.protocol,
    wireMethod: projection.method,
    finalizedProjection: projection.finalizedProjection,
    projectionRevision: projection.projectionRevision,
    legacyEstimate: () => Promise.reject(new Error('legacy path invoked')),
  };
}

describe('issue 2253 GPT-5.6 provider usage parity', () => {
  it.each(fixture.observations)(
    'matches the $category held-out provider increment exactly',
    async (observation) => {
      const control = await estimateGpt56Prompt(
        request(buildPrompt(observation.category, 1)),
      );
      const heldout = await estimateGpt56Prompt(
        request(buildPrompt(observation.category, 5)),
      );

      expect(control.count).toBe(observation.controlTokens);
      expect(heldout.count).toBe(observation.heldoutTokens);
      expect(heldout.count - control.count).toBe(observation.providerDelta);
    },
  );
});
