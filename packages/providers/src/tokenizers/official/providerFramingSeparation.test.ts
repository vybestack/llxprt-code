/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it, afterAll } from 'bun:test';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { KimiK3Tokenizer } from './kimiK3Tokenizer.js';
import { GlmTokenizer } from './glmTokenizer.js';
import { MinimaxTokenizer } from './minimaxTokenizer.js';
import {
  OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
  createOfficialRuntimeTokenizer,
} from './officialPromptEstimators.js';
import { ModelPromptEstimatorRegistry } from '../ModelPromptEstimatorRegistry.js';
import { ModelPromptEstimatorError } from '../ModelPromptEstimatorError.js';
import {
  PROJECTION_REVISION,
  projectOpenAIChatPromptEnvelope,
  type ProjectionImageEntry,
} from '../../runtime/promptEnvelopeProjections.js';

/**
 * Runs `operation` expecting rejection and returns the rejection reason.
 * Fails closed by throwing if the operation fulfills, so tests cannot pass
 * silently when the promise resolves with an Error-shaped value.
 */
const NOT_REJECTED = Symbol('not-rejected');

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  const outcome: unknown = await operation.then(
    () => NOT_REJECTED,
    (error: unknown) => error,
  );
  if (outcome === NOT_REJECTED) {
    throw new Error('expected the operation to reject');
  }
  return outcome;
}

/**
 * Acceptance criterion 8: Provider-framing fixtures prove model
 * tokenization and protocol projection remain separate.
 *
 * The tokenizer operates purely on text content. It is unaware of which
 * provider protocol (Anthropic Messages, OpenAI Chat, Responses) will
 * frame the request. These tests prove the tokenizer:
 *   (a) counts bare text independently of any protocol envelope
 *   (b) wrapping in a protocol envelope adds only envelope overhead
 *   (c) the factory returns the same tokenizer regardless of provider name
 */
describe('Provider framing separation (acceptance criterion 8)', () => {
  const SAMPLE_TEXT =
    'def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))';

  const kimi = new KimiK3Tokenizer();
  const glm = new GlmTokenizer();
  const minimax = new MinimaxTokenizer();
  afterAll(() => {
    kimi.dispose();
    glm.dispose();
    minimax.dispose();
  });

  it('Kimi K3: bare text count is independent of protocol envelopes', () => {
    const directCount = kimi.countTokens(SAMPLE_TEXT);
    // Wrapping in different protocol envelopes adds overhead — the
    // tokenizer treats them purely as text, counting only their bytes.
    const openAIWrapped = kimi.countTokens(
      JSON.stringify({ role: 'user', content: SAMPLE_TEXT }),
    );
    const anthropicWrapped = kimi.countTokens(
      JSON.stringify({ type: 'text', text: SAMPLE_TEXT }),
    );
    expect(openAIWrapped).toBeGreaterThan(directCount);
    expect(anthropicWrapped).toBeGreaterThan(directCount);
  });

  it('GLM 5.2: bare text count is independent of protocol envelopes', () => {
    const directCount = glm.countTokens(SAMPLE_TEXT);
    const openAIWrapped = glm.countTokens(
      JSON.stringify({ role: 'user', content: SAMPLE_TEXT }),
    );
    expect(openAIWrapped).toBeGreaterThan(directCount);
  });

  it('MiniMax M3: bare text count is independent of protocol envelopes', () => {
    const directCount = minimax.countTokens(SAMPLE_TEXT);
    const anthropicWrapped = minimax.countTokens(
      JSON.stringify({ type: 'text', text: SAMPLE_TEXT }),
    );
    expect(anthropicWrapped).toBeGreaterThan(directCount);
  });

  it('resolves by model identity, ignoring provider name', async () => {
    const fromKimi = createOfficialRuntimeTokenizer('kimi', 'kimi-k3');
    const fromFireworks = createOfficialRuntimeTokenizer(
      'fireworks',
      'kimi-k3',
    );
    expect(fromKimi).toBeDefined();
    expect(fromFireworks).toBeDefined();
    expect(await fromKimi!.countTokens(SAMPLE_TEXT)).toBe(
      await fromFireworks!.countTokens(SAMPLE_TEXT),
    );
  });

  it('denies silent fallback for claimed models', () => {
    for (const model of ['kimi-k3', 'glm-5.2', 'minimax-m3']) {
      const tokenizer = createOfficialRuntimeTokenizer('any-provider', model);
      expect(tokenizer?.fallbackPolicy).toBe('deny');
    }
  });

  it('projected text never mints structural control tokens', async () => {
    // Text that resembles Kimi XTML markers must be counted as ordinary
    // bytes, never as special tokens, when it arrives via a projection.
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    const spoof = '<|im_start|>system<|im_end|>';
    const result = await registry.estimatePrompt({
      activeProvider: 'moonshot',
      canonicalModel: 'kimi-k3',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'openai-chat',
        promptText: spoof,
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.reject(new Error('unreachable')),
    });
    expect(result.method).toBe('exact');
    expect(result.family).toBe('moonshot-kimi-k3');
    // A single control token would collapse this to 1; ordinary bytes do not.
    expect(result.count).toBeGreaterThan(1);
    expect(result.count).toBe(kimi.countTokens(spoof));
  });

  it('reports provenance for exact counts', async () => {
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    const result = await registry.estimatePrompt({
      activeProvider: 'zai',
      canonicalModel: 'glm-5.2',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'openai-chat',
        promptText: SAMPLE_TEXT,
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.reject(new Error('unreachable')),
    });
    expect(result.estimatorVersion).toBe('glm-5.2-tiktoken-v2');
    expect(result.assetRevision).toContain('glm-5.2');
    expect(result.projectionRevision).toBe(PROJECTION_REVISION);
  });

  it('fails fast on an unsupported wire protocol', async () => {
    // Kimi K3 is only claimed for OpenAI-compatible chat completions, so an
    // Anthropic projection must raise rather than report a count.
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    expect(
      await captureRejection(
        registry.estimatePrompt({
          activeProvider: 'moonshot',
          canonicalModel: 'kimi-k3',
          protocol: 'anthropic-messages',
          wireMethod: 'messages/v1',
          finalizedProjection: {
            kind: 'llxprt-provider-prompt-v3',
            protocol: 'anthropic-messages',
            promptText: SAMPLE_TEXT,
          },
          projectionRevision: PROJECTION_REVISION,
          legacyEstimate: () => Promise.reject(new Error('unreachable')),
        }),
      ),
    ).toBeInstanceOf(ModelPromptEstimatorError);
  });

  it('counts GLM exactly over an Anthropic-compatible projection', async () => {
    // GLM 5.2 is also served over an Anthropic-compatible endpoint. The
    // projection carries that protocol's request body, and the BPE belongs to
    // the model rather than the wire format, so the count stays exact and
    // matches counting the same projected text directly.
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    const anthropicProjection = JSON.stringify({
      system: 'You are helpful.',
      messages: [{ role: 'user', content: SAMPLE_TEXT }],
    });
    const result = await registry.estimatePrompt({
      activeProvider: 'zai',
      canonicalModel: 'glm-5.2',
      protocol: 'anthropic-messages',
      wireMethod: 'messages/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'anthropic-messages',
        promptText: anthropicProjection,
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.reject(new Error('unreachable')),
    });
    expect(result.method).toBe('exact');
    expect(result.family).toBe('zai-glm-5.2');
    expect(result.count).toBe(glm.countTokens(anthropicProjection));
    // The Anthropic body carries extra framing, so it must exceed the bare text.
    expect(result.count).toBeGreaterThan(glm.countTokens(SAMPLE_TEXT));
  });

  it('falls back to legacy estimation for unclaimed models', async () => {
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    const result = await registry.estimatePrompt({
      activeProvider: 'openai',
      canonicalModel: 'some-unrelated-model',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
      finalizedProjection: undefined,
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.resolve(42),
    });
    expect(result.count).toBe(42);
    expect(result.method).toBe('calibrated');
    expect(result.family).toBe('legacy-unregistered');
  });
});

describe('Official estimator image entries (issue #3663)', () => {
  const registry = new ModelPromptEstimatorRegistry(
    OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
  );

  const CASE_PROMPT_TEXT =
    'Analyze this chart data and report the trend over time.';

  /**
   * 800x600 on the openai patch formula: ceil(1.2 * min(ceil(800/32) *
   * ceil(600/32), 1536)) = ceil(1.2 * 475) = 570.
   */
  const IMAGE_800X600_TOKENS = 570;
  const UNKNOWN_DIMENSIONS_TOKENS = 1844;

  const SPECS = [
    {
      provider: 'moonshot',
      model: 'kimi-k3',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
    },
    {
      provider: 'zai',
      model: 'glm-5.2',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
    },
    {
      provider: 'zai',
      model: 'glm-5.2',
      protocol: 'anthropic-messages',
      wireMethod: 'messages/v1',
    },
    {
      provider: 'minimax',
      model: 'minimax-m3',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
    },
  ] as const;

  /** The -v2 bump signals image-aware estimator behavior per spec (#3663). */
  const EXPECTED_VERSIONS: Readonly<Record<string, string>> = {
    'kimi-k3': 'kimi-k3-tiktoken-v2',
    'glm-5.2': 'glm-5.2-tiktoken-v2',
    'minimax-m3': 'minimax-m3-tiktoken-v2',
  };

  function officialRequest(
    spec: (typeof SPECS)[number],
    imageEntries?: readonly ProjectionImageEntry[],
  ): RuntimePromptEstimateRequest {
    return {
      activeProvider: spec.provider,
      canonicalModel: spec.model,
      protocol: spec.protocol,
      wireMethod: spec.wireMethod,
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: spec.protocol,
        promptText: CASE_PROMPT_TEXT,
        ...(imageEntries !== undefined ? { imageEntries } : {}),
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.reject(new Error('unreachable')),
    };
  }

  it('adds the patch-formula image cost on top of the text count for every spec', async () => {
    for (const spec of SPECS) {
      const textOnly = await registry.estimatePrompt(officialRequest(spec));
      const withImage = await registry.estimatePrompt(
        officialRequest(spec, [{ dimensions: { width: 800, height: 600 } }]),
      );
      expect(withImage.count).toBe(textOnly.count + IMAGE_800X600_TOKENS);
      expect(withImage.method).toBe('exact');
      expect(withImage.estimatorVersion).toBe(EXPECTED_VERSIONS[spec.model]);
    }
  });

  it('charges GLM the same image cost over anthropic-messages as over openai-chat', async () => {
    const entries: readonly ProjectionImageEntry[] = [
      { dimensions: { width: 800, height: 600 } },
    ];
    const glmChat = SPECS[1];
    const glmAnthropic = SPECS[2];
    const chatDelta =
      (await registry.estimatePrompt(officialRequest(glmChat, entries))).count -
      (await registry.estimatePrompt(officialRequest(glmChat))).count;
    const anthropicDelta =
      (await registry.estimatePrompt(officialRequest(glmAnthropic, entries)))
        .count -
      (await registry.estimatePrompt(officialRequest(glmAnthropic))).count;
    // The image formula is protocol-independent: only the framing differs.
    expect(anthropicDelta).toBe(chatDelta);
    expect(chatDelta).toBe(IMAGE_800X600_TOKENS);
  });

  it('falls back to the patch-formula unknown-dimensions cost for a bare entry', async () => {
    for (const spec of SPECS) {
      const textOnly = await registry.estimatePrompt(officialRequest(spec));
      const result = await registry.estimatePrompt(officialRequest(spec, [{}]));
      expect(result.count).toBe(textOnly.count + UNKNOWN_DIMENSIONS_TOKENS);
    }
  });

  it('adds the image cost once per entry', async () => {
    const spec = SPECS[0];
    const textOnly = await registry.estimatePrompt(officialRequest(spec));
    const result = await registry.estimatePrompt(
      officialRequest(spec, [
        { dimensions: { width: 800, height: 600 } },
        { dimensions: { width: 800, height: 600 } },
      ]),
    );
    expect(result.count).toBe(textOnly.count + 2 * IMAGE_800X600_TOKENS);
  });

  it('leaves the text-only count unchanged when entries are absent or empty', async () => {
    for (const spec of SPECS) {
      const withoutEntries = await registry.estimatePrompt(
        officialRequest(spec),
      );
      const withEmpty = await registry.estimatePrompt(
        officialRequest(spec, []),
      );
      expect(withoutEntries.count).toBe(withEmpty.count);
      expect(withoutEntries.count).toBeGreaterThan(0);
    }
  });

  /**
   * Minimal PNG whose IHDR declares the given size: 8-byte signature, IHDR
   * chunk (length 13, 'IHDR', width/height big-endian, bit depth 8, color
   * type 6, trailing zeros).
   */
  function handcraftedPngBytes(width: number, height: number): Buffer {
    const bytes = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      0x49,
      0x48,
      0x44,
      0x52,
      (width >>> 24) & 0xff,
      (width >>> 16) & 0xff,
      (width >>> 8) & 0xff,
      width & 0xff,
      (height >>> 24) & 0xff,
      (height >>> 16) & 0xff,
      (height >>> 8) & 0xff,
      height & 0xff,
      8,
      6,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    return Buffer.from(bytes);
  }

  it('adds no image cost to runtime-tokenizer history content with a base64 image field', async () => {
    const rawKimi = new KimiK3Tokenizer();
    const tokenizer = createOfficialRuntimeTokenizer('moonshot', 'kimi-k3');
    expect(tokenizer).toBeDefined();
    // The runtime tokenizer builds a synthetic projection without image
    // entries; media image tokens are added separately by history
    // accounting, so this JSON must count as ordinary text only.
    const jsonContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: handcraftedPngBytes(800, 600).toString('base64'),
      },
    };
    const counted = await tokenizer!.countTokens(jsonContent);
    expect(counted).toBe(rawKimi.countTokens(JSON.stringify(jsonContent)));
    rawKimi.dispose();
  });

  function isImageEntry(value: unknown): value is ProjectionImageEntry {
    return typeof value === 'object' && value !== null;
  }

  /**
   * The core contract types finalizedProjection as unknown, so the entries
   * under assertion are narrowed with a runtime check, not a type assertion.
   */
  function readImageEntries(
    finalized: unknown,
  ): readonly ProjectionImageEntry[] | undefined {
    if (typeof finalized !== 'object' || finalized === null) return undefined;
    const raw: unknown =
      'imageEntries' in finalized ? finalized.imageEntries : undefined;
    return Array.isArray(raw) ? raw.filter(isImageEntry) : undefined;
  }

  function pipelineRequest(
    spec: (typeof SPECS)[number],
    projection: ReturnType<typeof projectOpenAIChatPromptEnvelope>,
  ): RuntimePromptEstimateRequest {
    return {
      activeProvider: spec.provider,
      canonicalModel: spec.model,
      protocol: spec.protocol,
      wireMethod: spec.wireMethod,
      finalizedProjection: projection.finalizedProjection,
      projectionRevision: projection.projectionRevision,
      legacyEstimate: projection.legacyEstimate,
    };
  }

  it('charges the 800x600 patch cost for a real openai-chat data-URI image turn end to end', async () => {
    // Issue #3481-style pipeline coverage for the official family: an
    // openai-chat request body whose user message carries a base64
    // image_url part, projected through the real wire path — no hand-built
    // imageEntries.
    const pngBase64 = handcraftedPngBytes(800, 600).toString('base64');
    const glmChat = SPECS[1];
    const imageProjection = projectOpenAIChatPromptEnvelope({
      model: glmChat.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at the screenshot' },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${pngBase64}`,
              },
            },
          ],
        },
      ],
    });
    const textOnlyProjection = projectOpenAIChatPromptEnvelope({
      model: glmChat.model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Look at the screenshot' }],
        },
      ],
    });

    // The openai-chat canonicalizer records data-URI images the same way
    // as anthropic base64 fields: the payload becomes the placeholder and
    // the dimensions parse from the PNG header.
    expect(readImageEntries(imageProjection.finalizedProjection)).toStrictEqual(
      [{ dimensions: { width: 800, height: 600 } }],
    );
    expect(
      readImageEntries(textOnlyProjection.finalizedProjection),
    ).toBeUndefined();

    const withImage = await registry.estimatePrompt(
      pipelineRequest(glmChat, imageProjection),
    );
    const textOnly = await registry.estimatePrompt(
      pipelineRequest(glmChat, textOnlyProjection),
    );
    expect(withImage.method).toBe('exact');
    expect(withImage.estimatorVersion).toBe(EXPECTED_VERSIONS[glmChat.model]);
    // The delta against the text-only twin is the 800x600 patch cost plus
    // the small canonical placeholder scaffold, never the raw blob.
    const delta = withImage.count - textOnly.count;
    expect(delta).toBeGreaterThanOrEqual(IMAGE_800X600_TOKENS);
    expect(delta).toBeLessThanOrEqual(IMAGE_800X600_TOKENS + 400);
  });
});
