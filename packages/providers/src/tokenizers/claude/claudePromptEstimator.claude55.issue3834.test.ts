/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PROJECTION_REVISION } from '../../runtime/promptEnvelopeProjections.js';
import {
  CLAUDE_5_FAMILY_SPECS,
  CLAUDE_OPUS_5_ESTIMATOR_FAMILY,
  CLAUDE_FABLE_5_ESTIMATOR_FAMILY,
  CLAUDE_OPUS_5_CALIBRATION,
  CLAUDE_FABLE_5_CALIBRATION,
  CLAUDE_OPUS_5_5_ESTIMATOR_FAMILY,
  CLAUDE_SONNET_5_5_ESTIMATOR_FAMILY,
  CLAUDE_HAIKU_5_5_ESTIMATOR_FAMILY,
  CLAUDE_OPUS_5_5_CALIBRATION,
  CLAUDE_SONNET_5_5_CALIBRATION,
  CLAUDE_HAIKU_5_5_CALIBRATION,
} from './claudeCalibrationAssets.js';
import { ModelPromptEstimatorRegistry } from '../ModelPromptEstimatorRegistry.js';
import {
  CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS,
  createClaudeRuntimeTokenizer,
} from './claudePromptEstimator.js';

const registry = new ModelPromptEstimatorRegistry([
  ...CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS,
]);
const promptText = JSON.stringify({
  system: 'You are helpful.',
  messages: [{ role: 'user', content: 'Explain photosynthesis briefly.' }],
});

function request(
  model: string,
  activeProvider = 'claudecode',
): RuntimePromptEstimateRequest {
  return {
    activeProvider,
    canonicalModel: model,
    protocol: 'anthropic-messages',
    wireMethod: 'messages/v1',
    finalizedProjection: {
      kind: 'llxprt-provider-prompt-v3',
      protocol: 'anthropic-messages',
      promptText,
    },
    projectionRevision: PROJECTION_REVISION,
    legacyEstimate: () => Promise.resolve(4242),
  };
}

describe('@issue:3834 Claude 5.5 estimator identities', () => {
  it.each([
    [
      'claude-opus-5-5',
      CLAUDE_OPUS_5_5_ESTIMATOR_FAMILY,
      CLAUDE_OPUS_5_5_CALIBRATION,
    ],
    [
      'claude-sonnet-5-5',
      CLAUDE_SONNET_5_5_ESTIMATOR_FAMILY,
      CLAUDE_SONNET_5_5_CALIBRATION,
    ],
    [
      'claude-haiku-5-5',
      CLAUDE_HAIKU_5_5_ESTIMATOR_FAMILY,
      CLAUDE_HAIKU_5_5_CALIBRATION,
    ],
  ] as const)(
    'routes %s to its own estimator calibration',
    async (model, family, calibration) => {
      const warning = vi
        .spyOn(DebugLogger.prototype, 'warn')
        .mockImplementation(() => {});
      try {
        const result = await registry.estimatePrompt(request(model));
        expect(registry.claimsModel(model)).toBe(true);
        expect(result.family).toBe(family);
        expect(result.estimatorVersion).toBe(calibration.estimatorVersion);
        const varied = await registry.estimatePrompt({
          ...request(model),
          finalizedProjection: {
            kind: 'llxprt-provider-prompt-v3',
            protocol: 'anthropic-messages',
            promptText: `${promptText}
${'distinct input '.repeat(300)}`,
          },
        });
        expect(varied.count).toBeGreaterThan(result.count);
        expect(result.count).toBeGreaterThan(0);
        expect(warning).not.toHaveBeenCalled();
      } finally {
        warning.mockRestore();
      }
    },
  );

  it('preserves Opus 5, Fable 5, and Fable 5.1 family and warning behavior', async () => {
    const warning = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      for (const [model, family, calibration, expectedWarnings] of [
        [
          'claude-opus-5',
          CLAUDE_OPUS_5_ESTIMATOR_FAMILY,
          CLAUDE_OPUS_5_CALIBRATION,
          0,
        ],
        [
          'claude-fable-5',
          CLAUDE_FABLE_5_ESTIMATOR_FAMILY,
          CLAUDE_FABLE_5_CALIBRATION,
          0,
        ],
        [
          'claude-fable-5-1',
          CLAUDE_FABLE_5_ESTIMATOR_FAMILY,
          CLAUDE_FABLE_5_CALIBRATION,
          1,
        ],
      ] as const) {
        const result = await registry.estimatePrompt(request(model));
        expect(result.family).toBe(family);
        expect(result.estimatorVersion).toBe(calibration.estimatorVersion);
        expect(warning).toHaveBeenCalledTimes(expectedWarnings);
        warning.mockClear();
      }
    } finally {
      warning.mockRestore();
    }
  });

  it('keeps the documented Opus 5 lookalike outside sanctioned calibration identity', () => {
    const opus = CLAUDE_5_FAMILY_SPECS.find(
      (spec) => spec.canonicalModelFamily === 'claude-opus-5',
    );
    expect(opus?.claim.test('claude-opus-5-mini')).toBe(true);
    expect(opus?.matches('claude-opus-5-mini')).toBe(false);
  });

  it('keeps Opus 5.5 claim routing independent of family spec order', async () => {
    const reversed = new ModelPromptEstimatorRegistry(
      [...CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS].reverse(),
    );
    const result = await reversed.estimatePrompt(request('claude-opus-5-5'));
    expect(result.family).toBe(CLAUDE_OPUS_5_5_ESTIMATOR_FAMILY);
    expect(result.estimatorVersion).toBe(
      CLAUDE_OPUS_5_5_CALIBRATION.estimatorVersion,
    );
  });

  it.each([
    [
      'claude-opus-5-5',
      CLAUDE_OPUS_5_5_ESTIMATOR_FAMILY,
      CLAUDE_OPUS_5_5_CALIBRATION,
    ],
    [
      'claude-sonnet-5-5',
      CLAUDE_SONNET_5_5_ESTIMATOR_FAMILY,
      CLAUDE_SONNET_5_5_CALIBRATION,
    ],
    [
      'claude-haiku-5-5',
      CLAUDE_HAIKU_5_5_ESTIMATOR_FAMILY,
      CLAUDE_HAIKU_5_5_CALIBRATION,
    ],
  ] as const)(
    'constructs runtime tokenizer for %s with its own estimator version',
    (model, family, calibration) => {
      const tokenizer = createClaudeRuntimeTokenizer('claudecode', model);
      expect(tokenizer).toBeDefined();
      expect(tokenizer?.fallbackPolicy).toBe('deny');
      expect(tokenizer?.countTokens).toBeDefined();
      expect(registry.claimsModel(model)).toBe(true);
      const spec = CLAUDE_5_FAMILY_SPECS.find(
        (candidate) => candidate.canonicalModelFamily === model,
      );
      expect(spec?.family).toBe(family);
      expect(spec?.calibration?.estimatorVersion).toBe(
        calibration.estimatorVersion,
      );
    },
  );

  it('keeps sanctioned Opus 5 IDs separate from Opus 5.5', () => {
    for (const model of [
      'claude-opus-5',
      'claude-opus-5-latest',
      'claude-opus-5-20260731',
    ]) {
      expect(registry.getEstimatorFamily(model)).toBe(
        CLAUDE_OPUS_5_ESTIMATOR_FAMILY,
      );
    }
    expect(registry.getEstimatorFamily('claude-opus-5-5')).toBe(
      CLAUDE_OPUS_5_5_ESTIMATOR_FAMILY,
    );
  });

  it('does not give third-party providers any new Claude calibration', async () => {
    for (const model of [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]) {
      const result = await registry.estimatePrompt(request(model, 'zai'));
      expect(result.family).toBe('legacy-unregistered');
      expect(result.count).toBe(4242);
    }
  });

  it.each(['zai', 'openrouter', 'litellm', 'openai-compatible-proxy'])(
    'does not give provider %s a 5.5 calibration measured on another endpoint',
    async (activeProvider) => {
      for (const model of [
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-haiku-5-5',
      ]) {
        const result = await registry.estimatePrompt(
          request(model, activeProvider),
        );
        expect(result.family).toBe('legacy-unregistered');
        expect(result.count).toBe(4242);
      }
    },
  );
});
