/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Re-verifies the Opus 5 activation gate from the sanitized provider-usage
 * corpus, running the real base counter, the real one-pass feature extractor
 * and the real shipped calibration. Nothing here is precomputed except the
 * live provider `promptTokens` themselves.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { get_encoding } from '@dqbd/tiktoken';
import { AnthropicTokenizer } from '../AnthropicTokenizer.js';
import { applyClaudeCalibration } from './claudeCalibration.js';
import { extractClaudeContentFeatures } from './claudeContentFeatures.js';
import { CLAUDE_OPUS_5_CALIBRATION } from './claudeCalibrationAssets.js';

interface CorpusObservation {
  readonly id: number;
  readonly category: string;
  readonly split: 'control' | 'train' | 'heldout';
  readonly promptText: string;
  readonly providerPromptTokens: number;
  readonly cachedPromptTokens: number;
}

interface Corpus {
  readonly source: {
    readonly canonicalModel: string;
    readonly protocol: string;
    readonly endpointHost: string;
    readonly groundTruth: string;
  };
  readonly observations: readonly CorpusObservation[];
}

const corpus = JSON.parse(
  readFileSync(
    new URL('./fixtures/claude-opus-5-provider-usage-v1.json', import.meta.url),
    'utf8',
  ),
) as Corpus;

const encoder = get_encoding('o200k_base');
const heuristic = new AnthropicTokenizer();

interface Prediction {
  readonly category: string;
  readonly actual: number;
  readonly calibrated: number;
  readonly baseline: number;
}

async function buildHeldOutPredictions(): Promise<readonly Prediction[]> {
  const controls = new Map<string, CorpusObservation>();
  for (const observation of corpus.observations) {
    if (observation.split === 'control') {
      controls.set(observation.category, observation);
    }
  }

  const calibratedOf = (text: string): number =>
    applyClaudeCalibration(
      encoder.encode(text, [], []).length,
      extractClaudeContentFeatures(text),
      CLAUDE_OPUS_5_CALIBRATION,
    );

  const predictions: Prediction[] = [];
  for (const observation of corpus.observations) {
    if (observation.split !== 'heldout') continue;
    const control = controls.get(observation.category);
    if (control === undefined) {
      throw new Error(`no control for category ${observation.category}`);
    }
    const actual =
      observation.providerPromptTokens - control.providerPromptTokens;
    if (actual <= 0) {
      throw new Error(
        `held-out observation ${observation.id} is not larger than its control`,
      );
    }
    predictions.push({
      category: observation.category,
      actual,
      calibrated:
        calibratedOf(observation.promptText) - calibratedOf(control.promptText),
      baseline:
        (await heuristic.countTokens(observation.promptText, 'claude-opus-5')) -
        (await heuristic.countTokens(control.promptText, 'claude-opus-5')),
    });
  }
  return predictions;
}

function mape(
  predictions: readonly Prediction[],
  select: (p: Prediction) => number,
): number {
  return (
    (predictions.reduce(
      (sum, p) => sum + Math.abs((select(p) - p.actual) / p.actual),
      0,
    ) /
      predictions.length) *
    100
  );
}

function rmse(
  predictions: readonly Prediction[],
  select: (p: Prediction) => number,
): number {
  return Math.sqrt(
    predictions.reduce((sum, p) => sum + (select(p) - p.actual) ** 2, 0) /
      predictions.length,
  );
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

function underestimationP95(
  predictions: readonly Prediction[],
  select: (p: Prediction) => number,
): number {
  return percentile(
    predictions.map((p) =>
      Math.max(0, ((p.actual - select(p)) / p.actual) * 100),
    ),
    0.95,
  );
}

const TOLERANCE = 1e-3;

describe('Claude Opus 5 activation gate', () => {
  it('uses a corpus of live Anthropic prompt-token observations', () => {
    expect(corpus.source.canonicalModel).toBe('claude-opus-5');
    expect(corpus.source.protocol).toBe('anthropic-messages');
    expect(corpus.source.endpointHost).toBe('api.anthropic.com');
    expect(corpus.source.groundTruth).toContain('cached prompt tokens');
    expect(corpus.observations.length).toBe(
      CLAUDE_OPUS_5_CALIBRATION.provenance.corpusObservations,
    );
  });

  it('covers prose, code, JSON, Unicode and mixed Markdown content', () => {
    expect(
      [...new Set(corpus.observations.map((o) => o.category))].sort(),
    ).toEqual(['code', 'json', 'mixed', 'prose', 'unicode']);
  });

  it('reproduces the recorded held-out metrics from the shipped calibration', async () => {
    const predictions = await buildHeldOutPredictions();
    const recorded = CLAUDE_OPUS_5_CALIBRATION.heldOut;
    expect(predictions.length).toBe(recorded.sampleCount);
    expect(mape(predictions, (p) => p.calibrated)).toBeCloseTo(
      recorded.mapePercent,
      3,
    );
    expect(rmse(predictions, (p) => p.calibrated)).toBeCloseTo(
      recorded.rmse,
      3,
    );
    expect(underestimationP95(predictions, (p) => p.calibrated)).toBeCloseTo(
      recorded.underestimationP95Percent,
      3,
    );
  });

  it('reproduces the recorded baseline metrics from the existing Claude heuristic', async () => {
    const predictions = await buildHeldOutPredictions();
    const recorded = CLAUDE_OPUS_5_CALIBRATION.heldOut;
    expect(mape(predictions, (p) => p.baseline)).toBeCloseTo(
      recorded.baselineMapePercent,
      3,
    );
    expect(rmse(predictions, (p) => p.baseline)).toBeCloseTo(
      recorded.baselineRmse,
      3,
    );
    expect(underestimationP95(predictions, (p) => p.baseline)).toBeCloseTo(
      recorded.baselineUnderestimationP95Percent,
      3,
    );
  });

  it('improves held-out MAPE by at least ten percent relative to that heuristic', async () => {
    const predictions = await buildHeldOutPredictions();
    const calibratedMape = mape(predictions, (p) => p.calibrated);
    const baselineMape = mape(predictions, (p) => p.baseline);
    const relativeImprovement =
      ((baselineMape - calibratedMape) / baselineMape) * 100;
    expect(relativeImprovement).toBeGreaterThanOrEqual(10);
    expect(relativeImprovement).toBeCloseTo(
      CLAUDE_OPUS_5_CALIBRATION.heldOut.relativeMapeImprovementPercent,
      3,
    );
  });

  it('does not worsen p95 underestimation relative to that heuristic', async () => {
    const predictions = await buildHeldOutPredictions();
    expect(underestimationP95(predictions, (p) => p.calibrated)).toBeLessThan(
      underestimationP95(predictions, (p) => p.baseline) + TOLERANCE,
    );
  });

  it('beats the heuristic on every held-out category, not only on average', async () => {
    const predictions = await buildHeldOutPredictions();
    for (const prediction of predictions) {
      const calibratedError = Math.abs(
        (prediction.calibrated - prediction.actual) / prediction.actual,
      );
      const baselineError = Math.abs(
        (prediction.baseline - prediction.actual) / prediction.actual,
      );
      expect(calibratedError).toBeLessThan(baselineError);
    }
  });
});
