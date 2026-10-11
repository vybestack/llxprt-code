/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #854 (review F9): non-o200k families estimate a sealed disk prompt
 * without materializing a second, joined prompt string. Counts must equal the
 * whole-string array route exactly.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  RuntimePromptEstimateRequest,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import {
  countPromptTokens,
  PROJECTION_REVISION,
  type ProviderFinalizedPromptProjection,
} from '../runtime/promptEnvelopeProjections.js';
import { Gpt56SourceProjection } from './gpt56-source-projection.js';
import { withGpt56DiskSources } from './gpt56-disk-tokenizer-factory.js';
import { SourceFamilyInput } from './source-family-input.js';

const scratch = mkdtempSync(join(tmpdir(), 'source-family-'));
const baseFactory = createRuntimeTokenizerFactory();
let sequence = 0;

/** 3-byte and 4-byte characters so 64 KiB read blocks end inside a character. */
const BLOCK_STRADDLING_TEXT = `${'雪 mixed text. '.repeat(9000)}😀 tail\n\n  end`;
const TOOLS_TEXT = JSON.stringify([
  { type: 'function', function: { name: 'inspect', parameters: {} } },
]);
const DIMENSIONS = [
  { width: 64, height: 48 },
  { width: 1024, height: 768 },
];

interface Built {
  readonly projection: Gpt56SourceProjection;
  readonly expected: ProviderFinalizedPromptProjection;
}

/** The array route's projection and the sealed files for the same prompt. */
function build(written: string, options: { raw?: boolean } = {}): Built {
  // A lone surrogate does not survive the UTF-8 file; expect what was stored.
  const messages = Buffer.from(written, 'utf8').toString('utf8');
  const directory = join(scratch, `case-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  const messagesPath = join(directory, 'messages');
  const toolsPath = join(directory, 'tools');
  const costsPath = join(directory, 'image-costs.jsonl');
  writeFileSync(messagesPath, written);
  writeFileSync(toolsPath, TOOLS_TEXT);
  writeFileSync(
    costsPath,
    DIMENSIONS.map((dimensions) =>
      JSON.stringify({
        cost: estimateImageTokens({
          provider: 'openai-chat',
          model: 'source-model',
          dimensions,
        }),
        dimensions,
      }),
    )
      .map((line) => `${line}\n`)
      .join(''),
  );
  const projection = new Gpt56SourceProjection({
    protocol: 'openai-chat',
    directory,
    segments: [
      {
        promptKey: 'messages',
        source: { path: messagesPath },
        ...(options.raw === true ? { rawString: true as const } : {}),
      },
      { promptKey: 'tools', source: { path: toolsPath } },
    ],
    imageCosts: {
      source: { path: costsPath },
      provider: 'openai-chat',
      model: 'source-model',
    },
  });
  const messagesMember =
    options.raw === true ? JSON.stringify(messages) : messages;
  return {
    projection,
    expected: Object.freeze({
      kind: 'llxprt-provider-prompt-v3',
      protocol: 'openai-chat',
      promptText: `{"messages":${messagesMember},"tools":${TOOLS_TEXT}}`,
      promptSegments: Object.freeze([messages, TOOLS_TEXT]),
      imageEntries: Object.freeze(
        DIMENSIONS.map((dimensions) => Object.freeze({ dimensions })),
      ),
    }),
  };
}

function request(
  model: string,
  finalizedProjection: unknown,
  legacyEstimate: () => Promise<number>,
): RuntimePromptEstimateRequest {
  return {
    activeProvider: 'zai',
    canonicalModel: model,
    protocol: 'openai-chat',
    wireMethod: 'chat/completions/v1',
    finalizedProjection,
    projectionRevision: PROJECTION_REVISION,
    legacyEstimate,
  };
}

async function arrayEstimate(model: string, built: Built) {
  return baseFactory.estimatePrompt(
    request(model, built.expected, () =>
      Promise.resolve(countPromptTokens(built.expected.promptText)),
    ),
  );
}

async function sourceEstimate(
  model: string,
  built: Built,
  factory: RuntimeTokenizerFactory = withGpt56DiskSources(baseFactory, scratch),
) {
  return factory.estimatePrompt(
    request(model, built.projection, () =>
      Promise.reject(new Error('source route must not use the array legacy')),
    ),
  );
}

/** Total characters of every string reachable from a value. */
function reachableStringChars(
  value: unknown,
  seen = new Set<object>(),
): number {
  if (typeof value === 'string') return value.length;
  if (typeof value !== 'object' || value === null || seen.has(value)) return 0;
  seen.add(value);
  let total = 0;
  for (const key of Reflect.ownKeys(value)) {
    total += reachableStringChars(Reflect.get(value, key), seen);
  }
  return total;
}

const officialModels = ['glm-5.2', 'minimax-m3', 'kimi-k3'];
const legacyModels = ['unregistered-model-x', 'deepseek-v4-pro'];

describe('non-o200k families over sealed segments (issue #854)', () => {
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  for (const model of [...officialModels, ...legacyModels]) {
    for (const [name, text, raw] of [
      ['block-straddling multibyte text', BLOCK_STRADDLING_TEXT, false],
      ['raw string segment with escapes', 'a "q" \\ \n\t 雪 \ud800 b', true],
      ['empty messages', '', false],
    ] as const) {
      it(`${model}: ${name} equals the whole-string array count`, async () => {
        const built = build(text, { raw });
        try {
          const expected = await arrayEstimate(model, built);
          const actual = await sourceEstimate(model, built);
          expect(actual).toStrictEqual(expected);
          expect(actual.count).toBeGreaterThan(0);
        } finally {
          await built.projection.dispose();
        }
      });
    }
  }

  it('official families count one segment at a time with image costs added', async () => {
    const built = build('plain text', {});
    try {
      const result = await sourceEstimate('glm-5.2', built);
      const textOnly = await baseFactory.estimatePrompt(
        request('glm-5.2', { ...built.expected, imageEntries: [] }, () =>
          Promise.reject(new Error('unreachable')),
        ),
      );
      const imageTokens = DIMENSIONS.reduce(
        (sum, dimensions) =>
          sum +
          estimateImageTokens({
            provider: 'openai',
            model: 'glm-5.2',
            dimensions,
          }),
        0,
      );
      expect(imageTokens).toBeGreaterThan(0);
      expect(result.count).toBe(textOnly.count + imageTokens);
    } finally {
      await built.projection.dispose();
    }
  });

  it('hands the registry the sealed segments, never prompt text (retention trap)', async () => {
    const built = build(BLOCK_STRADDLING_TEXT, {});
    const seen: unknown[] = [];
    const trapFactory: RuntimeTokenizerFactory = {
      ...baseFactory,
      estimatePrompt: (req) => {
        seen.push(req.finalizedProjection);
        return baseFactory.estimatePrompt(req);
      },
    };
    try {
      for (const model of [...officialModels, ...legacyModels]) {
        seen.length = 0;
        await sourceEstimate(
          model,
          built,
          withGpt56DiskSources(trapFactory, scratch),
        );
        expect(seen).toHaveLength(1);
        expect(seen[0]).toBeInstanceOf(SourceFamilyInput);
        // Paths and flags only; the context-sized text is never on the graph.
        expect(reachableStringChars(seen[0])).toBeLessThan(10_000);
      }
      // Control: the same census flags the array route's retained text.
      expect(reachableStringChars(built.expected)).toBeGreaterThan(
        2 * BLOCK_STRADDLING_TEXT.length,
      );
    } finally {
      await built.projection.dispose();
    }
  });

  it('keeps the lease for the estimate and releases it afterwards', async () => {
    const built = build('lease', {});
    await sourceEstimate('glm-5.2', built);
    // The estimate released its own lease, so disposal completes immediately.
    await built.projection.dispose();
    expect(() => built.projection.acquire()).toThrow('disposed');
  });
});
