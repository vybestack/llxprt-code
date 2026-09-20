/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3663 regression: the Claude 5 calibrated estimator must read the
 * projection's imageEntries and charge each image its anthropic-formula
 * cost. The image cost is added after calibration because the formula
 * already returns provider-billed tokens while the coefficients were
 * fitted on text-only envelopes. The final case runs the turn end to end:
 * a handcrafted PNG through convertToAnthropicMessages and
 * projectAnthropicPromptEnvelope into estimateClaude5Prompt, compared
 * against a text-only baseline.
 */

import { describe, expect, it } from 'bun:test';
import * as tiktoken from '@dqbd/tiktoken';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertToAnthropicMessages } from '../../anthropic/AnthropicMessageNormalizer.js';
import {
  PROJECTION_REVISION,
  projectAnthropicPromptEnvelope,
  type ProjectionImageEntry,
} from '../../runtime/promptEnvelopeProjections.js';
import { applyClaudeCalibration } from './claudeCalibration.js';
import { extractClaudeContentFeatures } from './claudeContentFeatures.js';
import {
  CLAUDE_5_FAMILY_SPECS,
  CLAUDE_FABLE_5_CALIBRATION,
  CLAUDE_OPUS_5_CALIBRATION,
  type Claude5FamilySpec,
} from './claudeCalibrationAssets.js';
import { estimateClaude5Prompt } from './claudePromptEstimator.js';

/** The prose fixture from claudePromptEstimator.test.ts, copied verbatim. */
const PROSE_PROMPT_TEXT = JSON.stringify({
  system: 'You are helpful.',
  messages: [{ role: 'user', content: 'Explain photosynthesis briefly.' }],
});

function familySpec(canonicalModelFamily: string): Claude5FamilySpec {
  const spec = CLAUDE_5_FAMILY_SPECS.find(
    (candidate) => candidate.canonicalModelFamily === canonicalModelFamily,
  );
  if (spec === undefined) {
    throw new Error(
      `CLAUDE_5_FAMILY_SPECS is missing the ${canonicalModelFamily} family`,
    );
  }
  return spec;
}

const OPUS_SPEC = familySpec('claude-opus-5');
const FABLE_SPEC = familySpec('claude-fable-5');

interface ProjectionInput {
  readonly promptText: string;
  readonly promptSegments?: readonly string[];
  readonly imageEntries?: readonly ProjectionImageEntry[];
  readonly protocol?: PromptEnvelopeProtocol;
}

function request(
  projection: ProjectionInput,
  overrides: Partial<RuntimePromptEstimateRequest> = {},
): RuntimePromptEstimateRequest {
  const protocol = projection.protocol ?? 'anthropic-messages';
  return {
    activeProvider: 'anthropic',
    canonicalModel: 'claude-opus-5',
    protocol,
    wireMethod: 'messages/v1',
    finalizedProjection: {
      kind: 'llxprt-provider-prompt-v3',
      protocol,
      promptText: projection.promptText,
      promptSegments: projection.promptSegments,
      imageEntries: projection.imageEntries,
    },
    projectionRevision: PROJECTION_REVISION,
    legacyEstimate: () => Promise.resolve(4242),
    ...overrides,
  };
}

/**
 * Wraps the real codec so the number of base tokenizations per estimate is
 * observable without replacing the tokenizer under test.
 */
function countingLoader(): {
  readonly load: () => Promise<typeof tiktoken>;
  readonly encodeCalls: () => readonly string[];
  readonly dispose: () => void;
} {
  const calls: string[] = [];
  const minted: Array<ReturnType<typeof tiktoken.get_encoding>> = [];
  const load = (): Promise<typeof tiktoken> =>
    Promise.resolve({
      ...tiktoken,
      get_encoding: (
        encoding: Parameters<typeof tiktoken.get_encoding>[0],
        _extend_special_tokens?: Record<string, number>,
      ): ReturnType<typeof tiktoken.get_encoding> => {
        const encoder = tiktoken.get_encoding(encoding);
        minted.push(encoder);
        const realEncode = encoder.encode.bind(encoder);
        encoder.encode = (
          text: string,
          allowed_special?: 'all' | string[],
          disallowed_special?: 'all' | string[],
        ): Uint32Array => {
          calls.push(text);
          return realEncode(text, allowed_special, disallowed_special);
        };
        return encoder;
      },
    });
  return {
    load,
    encodeCalls: () => calls,
    // The estimator holds each encoder while the estimate runs, so disposal
    // must wait until the test's awaits have settled.
    dispose: () => {
      for (const encoder of minted) {
        encoder.free();
      }
    },
  };
}

function expectedCount(promptText: string, baseTokens: number): number {
  return applyClaudeCalibration(
    baseTokens,
    extractClaudeContentFeatures(promptText),
    CLAUDE_OPUS_5_CALIBRATION,
  );
}

describe('Claude image entries (issue #3663)', () => {
  const IMAGE_PROMPT_TEXT = PROSE_PROMPT_TEXT;

  /**
   * 800x600 on the anthropic formula: no downscale (the 1568 long-edge and
   * 1092^2 pixel caps both clear), so ceil(480000 / 750) = 640 tokens.
   */
  const IMAGE_800X600_TOKENS = 640;

  /** 1586x991 binds both anthropic caps and lands on the 1590 worst case. */
  const CAPPED_IMAGE_TOKENS = 1590;

  /** Anthropic unknown-dimensions fallback cost: ceil(1092^2 / 750). */
  const UNKNOWN_DIMENSIONS_TOKENS = 1590;

  function imageRequest(
    imageEntries: readonly ProjectionImageEntry[],
    overrides: Partial<RuntimePromptEstimateRequest> = {},
  ): RuntimePromptEstimateRequest {
    return request({ promptText: IMAGE_PROMPT_TEXT, imageEntries }, overrides);
  }

  /** Calibrated text-only count via a real tiktoken encode of promptText. */
  function calibratedTextCount(promptText: string): number {
    const encoder = tiktoken.get_encoding('o200k_base');
    try {
      return expectedCount(
        promptText,
        encoder.encode(promptText, [], []).length,
      );
    } finally {
      encoder.free();
    }
  }

  it('adds the anthropic-formula image cost on top of the calibrated text count', async () => {
    const result = await estimateClaude5Prompt(
      imageRequest([{ dimensions: { width: 800, height: 600 } }]),
      OPUS_SPEC,
    );
    // The 640 image tokens are provider-billed; passing them through the
    // ~0.657 text-fitted base coefficient would shrink them to ~421.
    expect(result.count).toBe(
      calibratedTextCount(IMAGE_PROMPT_TEXT) + IMAGE_800X600_TOKENS,
    );
  });

  it('charges the capped cost when both anthropic image caps bind', async () => {
    const result = await estimateClaude5Prompt(
      imageRequest([{ dimensions: { width: 1586, height: 991 } }]),
      OPUS_SPEC,
    );
    expect(result.count).toBe(
      calibratedTextCount(IMAGE_PROMPT_TEXT) + CAPPED_IMAGE_TOKENS,
    );
  });

  it('falls back to the anthropic unknown-dimensions cost for a bare entry', async () => {
    const result = await estimateClaude5Prompt(imageRequest([{}]), OPUS_SPEC);
    expect(result.count).toBe(
      calibratedTextCount(IMAGE_PROMPT_TEXT) + UNKNOWN_DIMENSIONS_TOKENS,
    );
  });

  it('adds the image cost once per entry', async () => {
    const result = await estimateClaude5Prompt(
      imageRequest([
        { dimensions: { width: 800, height: 600 } },
        { dimensions: { width: 800, height: 600 } },
      ]),
      OPUS_SPEC,
    );
    expect(result.count).toBe(
      calibratedTextCount(IMAGE_PROMPT_TEXT) + 2 * IMAGE_800X600_TOKENS,
    );
  });

  it('leaves the calibrated text-only count unchanged without entries', async () => {
    const absent = await estimateClaude5Prompt(
      request({ promptText: IMAGE_PROMPT_TEXT }),
      OPUS_SPEC,
    );
    const empty = await estimateClaude5Prompt(imageRequest([]), OPUS_SPEC);
    expect(absent.count).toBe(calibratedTextCount(IMAGE_PROMPT_TEXT));
    expect(empty.count).toBe(calibratedTextCount(IMAGE_PROMPT_TEXT));
  });

  it('reports calibrated provenance with the image-aware -v2 version', async () => {
    const result = await estimateClaude5Prompt(
      imageRequest([{ dimensions: { width: 800, height: 600 } }]),
      OPUS_SPEC,
    );
    expect(result.method).toBe('calibrated');
    expect(result.estimatorVersion).toBe(
      CLAUDE_OPUS_5_CALIBRATION.estimatorVersion,
    );
    // The bump signals image-aware estimator behavior in usage-parity logs;
    // coefficients and held-out metrics are unchanged.
    expect(CLAUDE_OPUS_5_CALIBRATION.estimatorVersion).toBe(
      'claude-opus-5-o200k-calibrated-2026-08-04-v2',
    );
  });

  it('adds the image cost on top of the Fable calibration', async () => {
    const result = await estimateClaude5Prompt(
      imageRequest([{ dimensions: { width: 800, height: 600 } }], {
        canonicalModel: 'claude-fable-5',
      }),
      FABLE_SPEC,
    );
    const encoder = tiktoken.get_encoding('o200k_base');
    try {
      const baseTokens = encoder.encode(IMAGE_PROMPT_TEXT, [], []).length;
      expect(result.estimatorVersion).toBe(
        CLAUDE_FABLE_5_CALIBRATION.estimatorVersion,
      );
      expect(CLAUDE_FABLE_5_CALIBRATION.estimatorVersion).toBe(
        'claude-fable-5-o200k-calibrated-2026-08-04-v2',
      );
      expect(result.count).toBe(
        applyClaudeCalibration(
          baseTokens,
          extractClaudeContentFeatures(IMAGE_PROMPT_TEXT),
          CLAUDE_FABLE_5_CALIBRATION,
        ) + IMAGE_800X600_TOKENS,
      );
    } finally {
      encoder.free();
    }
  });

  it('keeps the one-encode/one-scan contract with image entries present', async () => {
    const { load, encodeCalls, dispose } = countingLoader();
    try {
      const scanned: string[] = [];
      const result = await estimateClaude5Prompt(
        imageRequest([{ dimensions: { width: 800, height: 600 } }]),
        OPUS_SPEC,
        {
          loadModule: load,
          extractFeatures: (text: string) => {
            scanned.push(text);
            return extractClaudeContentFeatures(text);
          },
        },
      );
      expect(encodeCalls()).toStrictEqual([IMAGE_PROMPT_TEXT]);
      expect(scanned).toStrictEqual([IMAGE_PROMPT_TEXT]);
      expect(result.count).toBe(
        calibratedTextCount(IMAGE_PROMPT_TEXT) + IMAGE_800X600_TOKENS,
      );
    } finally {
      dispose();
    }
  });

  /**
   * Minimal PNG whose IHDR declares the given size: 8-byte signature, IHDR
   * chunk (length 13, 'IHDR', width/height big-endian, bit depth 8, color
   * type 6, trailing zeros). Only the header is read by the projection's
   * dimension parser.
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

  function anthropicConversionOptions(): Parameters<
    typeof convertToAnthropicMessages
  >[1] {
    return {
      isOAuth: false,
      reasoningEnabled: false,
      config: {},
      unprefixToolName: (name: string) => name,
      logger: { debug: () => {} },
    };
  }

  interface FinalizedProjectionFacts {
    readonly promptText: string;
    readonly imageEntries: readonly ProjectionImageEntry[] | undefined;
  }

  function isImageEntry(value: unknown): value is ProjectionImageEntry {
    return typeof value === 'object' && value !== null;
  }

  /**
   * The core contract types finalizedProjection as unknown, so the members
   * under assertion are narrowed with runtime checks, not a type assertion.
   */
  function finalizedFacts(
    value: unknown,
  ): FinalizedProjectionFacts | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    if (!('promptText' in value) || typeof value.promptText !== 'string') {
      return undefined;
    }
    const rawEntries: unknown =
      'imageEntries' in value ? value.imageEntries : undefined;
    return {
      promptText: value.promptText,
      imageEntries: Array.isArray(rawEntries)
        ? rawEntries.filter(isImageEntry)
        : undefined,
    };
  }

  async function estimateAnthropicTurn(
    messages: ReturnType<typeof convertToAnthropicMessages>,
  ): Promise<{
    readonly count: number;
    readonly facts: FinalizedProjectionFacts;
  }> {
    const projection = projectAnthropicPromptEnvelope({
      model: 'claude-opus-5',
      system: 'You are helpful.',
      messages,
    });
    const facts = finalizedFacts(projection.finalizedProjection);
    if (facts === undefined) {
      throw new Error('projection produced no finalized prompt text');
    }
    const result = await estimateClaude5Prompt(
      {
        activeProvider: 'anthropic',
        canonicalModel: 'claude-opus-5',
        protocol: 'anthropic-messages',
        wireMethod: 'messages/v1',
        finalizedProjection: projection.finalizedProjection,
        projectionRevision: projection.projectionRevision,
        legacyEstimate: projection.legacyEstimate,
      },
      OPUS_SPEC,
    );
    return { count: result.count, facts };
  }

  it('charges the image cost for a real anthropic image turn end to end', async () => {
    const pngBase64 = handcraftedPngBytes(800, 600).toString('base64');
    const imageMessages = convertToAnthropicMessages(
      [
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'Look at the screenshot' },
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: pngBase64,
            },
          ],
        },
      ] satisfies IContent[],
      anthropicConversionOptions(),
    );
    const textOnlyMessages = convertToAnthropicMessages(
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Look at the screenshot' }],
        },
      ] satisfies IContent[],
      anthropicConversionOptions(),
    );

    const image = await estimateAnthropicTurn(imageMessages);
    expect(image.facts.imageEntries).toStrictEqual([
      { dimensions: { width: 800, height: 600 } },
    ]);
    expect(image.count).toBe(
      calibratedTextCount(image.facts.promptText) + IMAGE_800X600_TOKENS,
    );

    // The delta against the text-only baseline is the settled image cost
    // plus a small placeholder-scaffold difference, never the raw blob.
    const textOnly = await estimateAnthropicTurn(textOnlyMessages);
    expect(textOnly.facts.imageEntries).toBeUndefined();
    const delta = image.count - textOnly.count;
    expect(delta).toBeGreaterThanOrEqual(IMAGE_800X600_TOKENS);
    expect(delta).toBeLessThanOrEqual(IMAGE_800X600_TOKENS + 400);
  });
});
