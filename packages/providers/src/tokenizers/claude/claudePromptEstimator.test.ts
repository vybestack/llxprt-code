/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import * as tiktoken from '@dqbd/tiktoken';
import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { PROJECTION_REVISION } from '../../runtime/promptEnvelopeProjections.js';
import { ModelPromptEstimatorError } from '../ModelPromptEstimatorError.js';
import { ModelPromptEstimatorRegistry } from '../ModelPromptEstimatorRegistry.js';
import { applyClaudeCalibration } from './claudeCalibration.js';
import { extractClaudeContentFeatures } from './claudeContentFeatures.js';
import { isClaude5CalibratedProvider } from './claudeCalibrationAssets.js';
import {
  CLAUDE_5_FAMILY_SPECS,
  CLAUDE_FABLE_5_ESTIMATOR_FAMILY,
  CLAUDE_OPUS_5_CALIBRATION,
  CLAUDE_OPUS_5_ESTIMATOR_FAMILY,
} from './claudeCalibrationAssets.js';
import {
  CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS,
  estimateClaude5Prompt,
} from './claudePromptEstimator.js';

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

const OPUS_SPEC = CLAUDE_5_FAMILY_SPECS.find(
  (spec) => spec.canonicalModelFamily === 'claude-opus-5',
)!;
const FABLE_SPEC = CLAUDE_5_FAMILY_SPECS.find(
  (spec) => spec.canonicalModelFamily === 'claude-fable-5',
)!;

interface ProjectionInput {
  readonly promptText: string;
  readonly promptSegments?: readonly string[];
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
} {
  const calls: string[] = [];
  const load = () =>
    Promise.resolve({
      ...tiktoken,
      get_encoding: ((name: Parameters<typeof tiktoken.get_encoding>[0]) => {
        const encoder = tiktoken.get_encoding(name);
        return {
          ...encoder,
          encode: (
            text: string,
            allowed?: unknown,
            disallowed?: unknown,
          ): Uint32Array => {
            calls.push(text);
            return encoder.encode(text, allowed as never, disallowed as never);
          },
        };
      }) as typeof tiktoken.get_encoding,
    } as typeof tiktoken);
  return { load, encodeCalls: () => calls };
}

function expectedCount(promptText: string, baseTokens: number): number {
  return applyClaudeCalibration(
    baseTokens,
    extractClaudeContentFeatures(promptText),
    CLAUDE_OPUS_5_CALIBRATION,
  );
}

const CONTENT_SHAPES: Readonly<Record<string, string>> = {
  prose: JSON.stringify({
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'Explain photosynthesis briefly.' }],
  }),
  code: JSON.stringify({
    system: 'You are helpful.',
    messages: [
      {
        role: 'user',
        content: 'function f(a){return [a?.b ?? {c: 1}, `x${a}`];}',
      },
    ],
  }),
  json: JSON.stringify({
    system: 'You are helpful.',
    tools: [{ name: 'search', input_schema: { type: 'object' } }],
  }),
  unicode: JSON.stringify({
    system: 'You are helpful.',
    messages: [{ role: 'user', content: '日本語のテキスト。Русский текст.' }],
  }),
  emoji: JSON.stringify({
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'ship it 🚀👩‍👩‍👧‍👦 café' }],
  }),
};

describe('Claude Opus 5 calibrated prompt estimator', () => {
  it('reports calibrated provenance bound to the base counter and calibration', async () => {
    const result = await estimateClaude5Prompt(
      request({ promptText: CONTENT_SHAPES.prose }),
      OPUS_SPEC,
    );
    expect(result.method).toBe('calibrated');
    expect(result.family).toBe(CLAUDE_OPUS_5_ESTIMATOR_FAMILY);
    expect(result.estimatorVersion).toBe(
      CLAUDE_OPUS_5_CALIBRATION.estimatorVersion,
    );
    expect(result.assetRevision).toContain('o200k_base');
    expect(result.assetRevision).toContain(
      `calibration:${CLAUDE_OPUS_5_CALIBRATION.estimatorVersion}`,
    );
    expect(result.projectionRevision).toBe(PROJECTION_REVISION);
  });

  it('never reports an exact method for any content shape', async () => {
    for (const promptText of Object.values(CONTENT_SHAPES)) {
      const result = await estimateClaude5Prompt(
        request({ promptText }),
        OPUS_SPEC,
      );
      expect(result.method).not.toBe('exact');
      expect(result.method).toBe('calibrated');
    }
  });

  it('performs exactly one base tokenization of the projection text', async () => {
    const { load, encodeCalls } = countingLoader();
    const promptText = CONTENT_SHAPES.json;
    await estimateClaude5Prompt(
      request({
        promptText,
        promptSegments: ['a', 'b', 'c', 'd'],
      }),
      OPUS_SPEC,
      { loadModule: load },
    );
    expect(encodeCalls()).toEqual([promptText]);
  });

  it.each(Object.entries(CONTENT_SHAPES))(
    'scans %s content for features exactly once',
    async (_name, promptText) => {
      const scanned: string[] = [];
      const countingExtractor = (text: string) => {
        scanned.push(text);
        return extractClaudeContentFeatures(text);
      };
      await estimateClaude5Prompt(
        request({ promptText, promptSegments: [promptText, 'tail'] }),
        OPUS_SPEC,
        { extractFeatures: countingExtractor },
      );
      expect(scanned).toEqual([promptText]);
    },
  );

  it('derives the count from one base reading and one feature reading of the same text', async () => {
    const { load, encodeCalls } = countingLoader();
    const scanned: string[] = [];
    const promptText = CONTENT_SHAPES.unicode;
    const result = await estimateClaude5Prompt(
      request({ promptText }),
      OPUS_SPEC,
      {
        loadModule: load,
        extractFeatures: (text: string) => {
          scanned.push(text);
          return extractClaudeContentFeatures(text);
        },
      },
    );
    const encoder = tiktoken.get_encoding('o200k_base');
    const baseTokens = encoder.encode(promptText, [], []).length;
    expect(encodeCalls()).toEqual([promptText]);
    expect(scanned).toEqual([promptText]);
    expect(result.count).toBe(expectedCount(promptText, baseTokens));
  });

  it('selects the same base counter for every content shape', async () => {
    const results: RuntimePromptEstimateResult[] = [];
    for (const promptText of Object.values(CONTENT_SHAPES)) {
      results.push(
        await estimateClaude5Prompt(request({ promptText }), OPUS_SPEC),
      );
    }
    const revisions = new Set(results.map((r) => r.assetRevision));
    const versions = new Set(results.map((r) => r.estimatorVersion));
    expect(revisions.size).toBe(1);
    expect(versions.size).toBe(1);
  });

  it('is unaffected by how the projection is chunked into segments', async () => {
    const promptText = CONTENT_SHAPES.emoji;
    const chunkings: ReadonlyArray<readonly string[]> = [
      [promptText],
      [promptText.slice(0, 3), promptText.slice(3)],
      [promptText.slice(0, 17), promptText.slice(17, 40), promptText.slice(40)],
    ];
    const results = [];
    for (const promptSegments of chunkings) {
      const { load, encodeCalls } = countingLoader();
      const result = await estimateClaude5Prompt(
        request({ promptText, promptSegments }),
        OPUS_SPEC,
        { loadModule: load },
      );
      expect(encodeCalls()).toEqual([promptText]);
      results.push(result);
    }
    expect(new Set(results.map((r) => r.count)).size).toBe(1);
    expect(new Set(results.map((r) => r.assetRevision)).size).toBe(1);
  });

  it('estimates an empty projection as zero', async () => {
    const result = await estimateClaude5Prompt(
      request({ promptText: '' }),
      OPUS_SPEC,
    );
    expect(result.count).toBe(0);
  });

  it('scales with prompt size', async () => {
    const small = await estimateClaude5Prompt(
      request({ promptText: CONTENT_SHAPES.prose }),
      OPUS_SPEC,
    );
    const large = await estimateClaude5Prompt(
      request({ promptText: CONTENT_SHAPES.prose.repeat(40) }),
      OPUS_SPEC,
    );
    expect(large.count).toBeGreaterThan(small.count * 20);
  });

  it('rejects a projection produced by a different projection revision', async () => {
    const error = await captureRejection(
      estimateClaude5Prompt(
        request(
          { promptText: CONTENT_SHAPES.prose },
          {
            projectionRevision: PROJECTION_REVISION + 1,
          },
        ),
        OPUS_SPEC,
      ),
    );
    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect((error as ModelPromptEstimatorError).code).toBe('asset-unavailable');
  });

  it('rejects a malformed finalized projection', async () => {
    const error = await captureRejection(
      estimateClaude5Prompt(
        request(
          { promptText: 'x' },
          { finalizedProjection: { kind: 'wrong' } },
        ),
        OPUS_SPEC,
      ),
    );
    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect((error as ModelPromptEstimatorError).code).toBe(
      'projection-unavailable',
    );
  });

  it('reports an unavailable base-counter asset instead of guessing', async () => {
    const error = await captureRejection(
      estimateClaude5Prompt(
        request({ promptText: CONTENT_SHAPES.prose }),
        OPUS_SPEC,
        { loadModule: () => Promise.reject(new Error('assets missing')) },
      ),
    );
    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect((error as ModelPromptEstimatorError).code).toBe('asset-unavailable');
  });

  it('refuses to estimate from a spec with no calibration', async () => {
    const error = await captureRejection(
      estimateClaude5Prompt(
        request(
          { promptText: CONTENT_SHAPES.prose },
          {
            canonicalModel: 'claude-fable-5',
          },
        ),
        FABLE_SPEC,
      ),
    );
    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect((error as ModelPromptEstimatorError).code).toBe('asset-unavailable');
    expect((error as ModelPromptEstimatorError).remediation).toBe(
      FABLE_SPEC.withheldReason!,
    );
  });
});

describe('Claude 5 registry composition', () => {
  const registry = new ModelPromptEstimatorRegistry([
    ...CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS,
  ]);

  it('restricts the calibrated family to the providers it was measured on', () => {
    expect(isClaude5CalibratedProvider('anthropic')).toBe(true);
    expect(isClaude5CalibratedProvider('claudecode')).toBe(true);
    expect(isClaude5CalibratedProvider('zai')).toBe(false);
    expect(
      CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS.every(
        (registration) => registration.appliesToProvider !== undefined,
      ),
    ).toBe(true);
  });

  it('registers Opus 5 only', () => {
    expect(
      CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS.map((r) => r.family),
    ).toEqual([CLAUDE_OPUS_5_ESTIMATOR_FAMILY]);
    expect(
      CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS.some(
        (r) => r.family === CLAUDE_FABLE_5_ESTIMATOR_FAMILY,
      ),
    ).toBe(false);
  });

  it('claims sanctioned Opus 5 aliases and snapshots', () => {
    for (const model of [
      'claude-opus-5',
      'claude-opus-5-latest',
      'claude-opus-5-20260731',
    ]) {
      expect(registry.claimsModel(model)).toBe(true);
      expect(registry.getEstimatorFamily(model)).toBe(
        CLAUDE_OPUS_5_ESTIMATOR_FAMILY,
      );
    }
  });

  it('leaves Fable 5 unclaimed so it keeps its existing path', async () => {
    expect(registry.claimsModel('claude-fable-5')).toBe(false);
    const result = await registry.estimatePrompt(
      request(
        { promptText: CONTENT_SHAPES.prose },
        {
          canonicalModel: 'claude-fable-5',
        },
      ),
    );
    expect(result.family).toBe('legacy-unregistered');
    expect(result.count).toBe(4242);
  });

  it('does not apply Opus 5 coefficients to Fable 5', async () => {
    const opus = await registry.estimatePrompt(
      request({ promptText: CONTENT_SHAPES.prose }),
    );
    const fable = await registry.estimatePrompt(
      request(
        { promptText: CONTENT_SHAPES.prose },
        {
          canonicalModel: 'claude-fable-5',
        },
      ),
    );
    expect(fable.family).not.toBe(opus.family);
    expect(fable.estimatorVersion).not.toBe(opus.estimatorVersion);
    expect(fable.count).not.toBe(opus.count);
  });

  it('rejects an Opus 5 lookalike with an actionable identity error', async () => {
    const error = await captureRejection(
      registry.estimatePrompt(
        request(
          { promptText: CONTENT_SHAPES.prose },
          {
            canonicalModel: 'claude-opus-5-mini',
          },
        ),
      ),
    );
    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect((error as ModelPromptEstimatorError).code).toBe(
      'unresolved-model-identity',
    );
  });

  it.each(['openai-chat', 'openai-responses'] as const)(
    'rejects the unsupported %s protocol',
    async (protocol) => {
      const error = await captureRejection(
        registry.estimatePrompt(
          request({ promptText: CONTENT_SHAPES.prose, protocol }, { protocol }),
        ),
      );
      expect(error).toBeInstanceOf(ModelPromptEstimatorError);
      expect((error as ModelPromptEstimatorError).code).toBe(
        'unsupported-protocol',
      );
    },
  );

  it.each(['anthropic', 'claudecode', 'ANTHROPIC'])(
    'applies the Anthropic-measured calibration for provider %s',
    async (activeProvider) => {
      const result = await registry.estimatePrompt(
        request({ promptText: CONTENT_SHAPES.prose }, { activeProvider }),
      );
      expect(result.family).toBe(CLAUDE_OPUS_5_ESTIMATOR_FAMILY);
      expect(result.method).toBe('calibrated');
    },
  );

  it.each(['zai', 'openrouter', 'litellm', 'openai-compatible-proxy'])(
    'does not give provider %s a calibration measured on another endpoint',
    async (activeProvider) => {
      const result = await registry.estimatePrompt(
        request({ promptText: CONTENT_SHAPES.prose }, { activeProvider }),
      );
      expect(result.family).toBe('legacy-unregistered');
      expect(result.count).toBe(4242);
    },
  );

  it('still rejects an unsanctioned model id on a calibrated provider', async () => {
    const error = await captureRejection(
      registry.estimatePrompt(
        request(
          { promptText: CONTENT_SHAPES.prose },
          {
            activeProvider: 'claudecode',
            canonicalModel: 'claude-opus-5-mini',
          },
        ),
      ),
    );
    expect((error as ModelPromptEstimatorError).code).toBe(
      'unresolved-model-identity',
    );
  });

  it('does not claim other Claude models', () => {
    for (const model of [
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
      'claude-opus-50',
    ]) {
      expect(registry.claimsModel(model)).toBe(false);
    }
  });
});
