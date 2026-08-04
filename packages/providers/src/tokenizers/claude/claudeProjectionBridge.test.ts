/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Opus 5 corpus was recorded under the `responses-fields-v1` projection,
 * while the calibration is declared against finalized projection revision 3.
 * That pairing is only legitimate if both projections produce the same
 * prompt text for the requests in the corpus, so it is proved here rather
 * than assumed.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import {
  PROJECTION_REVISION,
  projectAnthropicPromptEnvelope,
  type ProviderFinalizedPromptProjection,
} from '../../runtime/promptEnvelopeProjections.js';
import { CLAUDE_OPUS_5_CALIBRATION } from './claudeCalibrationAssets.js';

/** The historical `responses-fields-v1` prompt projection, verbatim. */
const RESPONSES_FIELDS_V1_KEYS = ['system', 'messages', 'tools'] as const;

function projectResponsesFieldsV1(body: Record<string, unknown>): string {
  const projected: Record<string, unknown> = {};
  for (const key of RESPONSES_FIELDS_V1_KEYS) {
    if (body[key] !== undefined) projected[key] = body[key];
  }
  return JSON.stringify(projected);
}

function currentPromptText(body: Record<string, unknown>): string {
  const projection = projectAnthropicPromptEnvelope(body);
  return (projection.finalizedProjection as ProviderFinalizedPromptProjection)
    .promptText;
}

interface CorpusObservation {
  readonly category: string;
  readonly promptText: string;
}

const corpus = JSON.parse(
  readFileSync(
    new URL('./fixtures/claude-opus-5-provider-usage-v1.json', import.meta.url),
    'utf8',
  ),
) as {
  readonly source: { readonly sourceProjectionVersion: string };
  readonly observations: readonly CorpusObservation[];
};

function bodyForPrompt(prompt: string): Record<string, unknown> {
  return {
    model: 'claude-opus-5',
    system: 'You are a careful assistant. Answer precisely.',
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        name: 'search',
        description: 'Search the workspace',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    ],
    max_tokens: 1024,
    temperature: 0,
  };
}

describe('corpus projection bridge', () => {
  it('records the projection version the corpus was collected under', () => {
    expect(corpus.source.sourceProjectionVersion).toBe(
      CLAUDE_OPUS_5_CALIBRATION.provenance.sourceProjectionVersion,
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.projectionRevision).toBe(
      PROJECTION_REVISION,
    );
  });

  it('produces identical prompt text for every corpus observation', () => {
    expect(corpus.observations.length).toBeGreaterThan(0);
    for (const observation of corpus.observations) {
      // The stored text is the JSON-escaped prompt, so decode it back to the
      // raw prompt the request actually carried.
      const prompt = JSON.parse(observation.promptText) as string;
      const body = bodyForPrompt(prompt);
      expect(currentPromptText(body)).toBe(projectResponsesFieldsV1(body));
    }
  });

  it('keeps the stored prompt text embedded verbatim in the current projection', () => {
    for (const observation of corpus.observations) {
      const prompt = JSON.parse(observation.promptText) as string;
      expect(currentPromptText(bodyForPrompt(prompt))).toContain(
        observation.promptText,
      );
    }
  });

  it('agrees on bodies that omit optional prompt-bearing keys', () => {
    const bodies: ReadonlyArray<Record<string, unknown>> = [
      { model: 'claude-opus-5', messages: [{ role: 'user', content: 'hi' }] },
      {
        model: 'claude-opus-5',
        system: 'sys only',
        messages: [{ role: 'user', content: '日本語 🚀' }],
      },
      {
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: '{"a":[1,2]}' }],
        tools: [],
      },
    ];
    for (const body of bodies) {
      expect(currentPromptText(body)).toBe(projectResponsesFieldsV1(body));
    }
  });

  it('ignores non-prompt-bearing fields in both projections', () => {
    const withExtras = {
      ...bodyForPrompt('hello'),
      stream: true,
      metadata: { user_id: 'x' },
    };
    expect(currentPromptText(withExtras)).toBe(
      currentPromptText(bodyForPrompt('hello')),
    );
  });

  it('documents the one case where the bridge does not hold', () => {
    // Revision 3 replaces base64 media payloads; the historical projection did
    // not. The corpus is media-free, so this divergence cannot affect it, but
    // it is the reason the bridge is scoped to media-free bodies.
    const withMedia = {
      model: 'claude-opus-5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
            },
          ],
        },
      ],
    };
    expect(currentPromptText(withMedia)).not.toBe(
      projectResponsesFieldsV1(withMedia),
    );
    for (const observation of corpus.observations) {
      expect(observation.promptText).not.toContain(';base64,');
    }
  });
});
