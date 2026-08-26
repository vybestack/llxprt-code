/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Re-verifies each Claude 5 activation gate from that model's own sanitized
 * provider-usage corpus, running the real shipped calibration.
 *
 * Each model is checked entirely against its own corpus. Nothing here lets one
 * model's evidence justify the other's activation.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import {
  applyClaudeCalibration,
  relativeMapeImprovementPercent,
  type ClaudeCalibration,
} from './claudeCalibration.js';
import {
  CLAUDE_FABLE_5_CALIBRATION,
  CLAUDE_OPUS_5_CALIBRATION,
} from './claudeCalibrationAssets.js';

interface CorpusObservation {
  readonly id: number;
  readonly split: 'train' | 'heldout';
  readonly category: string;
  readonly envelope: string;
  readonly projectionBaseTokens: number;
  readonly codePoints: number;
  readonly nonAsciiCodePoints: number;
  readonly structuralCodePoints: number;
  readonly whitespaceCodePoints: number;
  readonly heuristicTokens: number;
  readonly providerPromptTokens: number;
  readonly cachedPromptTokens: number;
}

interface Corpus {
  readonly source: {
    readonly canonicalModel: string;
    readonly activeProvider: string;
    readonly endpointHost: string;
    readonly protocol: string;
    readonly projectionRevision: number;
    readonly groundTruth: string;
    readonly contents: string;
  };
  readonly observations: readonly CorpusObservation[];
}

function loadCorpus(model: string): Corpus {
  return JSON.parse(
    readFileSync(
      new URL(`./fixtures/${model}-provider-usage-v1.json`, import.meta.url),
      'utf8',
    ),
  ) as Corpus;
}

interface Prediction {
  readonly observation: CorpusObservation;
  readonly actual: number;
  readonly calibrated: number;
  readonly baseline: number;
}

function predict(
  corpus: Corpus,
  calibration: ClaudeCalibration,
  split: 'train' | 'heldout',
): readonly Prediction[] {
  return corpus.observations
    .filter((observation) => observation.split === split)
    .map((observation) => {
      if (observation.providerPromptTokens <= 0) {
        throw new Error(`observation ${observation.id} has no provider count`);
      }
      return {
        observation,
        actual: observation.providerPromptTokens,
        calibrated: applyClaudeCalibration(
          observation.projectionBaseTokens,
          observation,
          calibration,
        ),
        baseline: observation.heuristicTokens,
      };
    });
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

const MODELS = [
  {
    name: 'claude-opus-5',
    calibration: CLAUDE_OPUS_5_CALIBRATION,
    corpus: loadCorpus('claude-opus-5'),
  },
  {
    name: 'claude-fable-5',
    calibration: CLAUDE_FABLE_5_CALIBRATION,
    corpus: loadCorpus('claude-fable-5'),
  },
] as const;

describe.each(MODELS)('$name activation gate', ({ calibration, corpus }) => {
  it('uses a corpus of live Anthropic prompt-token observations for this model', () => {
    expect(corpus.source.canonicalModel).toBe(calibration.canonicalModelFamily);
    expect(corpus.source.protocol).toBe(calibration.protocol);
    expect(corpus.source.endpointHost).toBe(
      calibration.provenance.endpointHost,
    );
    expect(corpus.source.projectionRevision).toBe(
      calibration.projectionRevision,
    );
    expect(corpus.source.groundTruth).toContain('cached prompt tokens');
    expect(corpus.observations.length).toBe(
      calibration.provenance.corpusObservations,
    );
  });

  it('retains counts only, never prompt text', () => {
    expect(corpus.source.contents).toContain('counts only');
    for (const observation of corpus.observations) {
      expect(Object.keys(observation)).not.toContain('promptText');
      expect(Object.keys(observation)).not.toContain('prompt');
    }
  });

  it('covers prose, code, JSON, Unicode, emoji, combining marks and mixed Markdown', () => {
    expect(
      [...new Set(corpus.observations.map((o) => o.category))].sort(),
    ).toStrictEqual([
      'code',
      'combining',
      'emoji',
      'json',
      'mixed',
      'prose',
      'unicode',
    ]);
  });

  it('covers varying system and tool envelope sizes', () => {
    const envelopes = [...new Set(corpus.observations.map((o) => o.envelope))];
    expect(envelopes.length).toBeGreaterThanOrEqual(3);
    const bases = corpus.observations.map((o) => o.projectionBaseTokens);
    // The envelope really varies the fixed framing, not just the payload.
    expect(Math.max(...bases) - Math.min(...bases)).toBeGreaterThan(3000);
  });

  it('holds out observations that were never trained on', () => {
    const heldOut = corpus.observations.filter((o) => o.split === 'heldout');
    expect(heldOut.length).toBe(calibration.heldOut.sampleCount);
    expect(heldOut.length).toBeGreaterThan(0);
    expect(
      corpus.observations.filter((o) => o.split === 'train').length,
    ).toBeGreaterThan(0);
  });

  it('reproduces the recorded held-out metrics from the shipped calibration', () => {
    const predictions = predict(corpus, calibration, 'heldout');
    const recorded = calibration.heldOut;
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

  it('reproduces the recorded baseline metrics from the existing Claude heuristic', () => {
    const predictions = predict(corpus, calibration, 'heldout');
    const recorded = calibration.heldOut;
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

  it('improves held-out MAPE by at least ten percent relative to that heuristic', () => {
    const predictions = predict(corpus, calibration, 'heldout');
    const improvement =
      ((mape(predictions, (p) => p.baseline) -
        mape(predictions, (p) => p.calibrated)) /
        mape(predictions, (p) => p.baseline)) *
      100;
    expect(improvement).toBeGreaterThanOrEqual(10);
    expect(improvement).toBeCloseTo(
      relativeMapeImprovementPercent(calibration.heldOut),
      3,
    );
  });

  it('does not worsen p95 underestimation relative to that heuristic', () => {
    const predictions = predict(corpus, calibration, 'heldout');
    expect(
      underestimationP95(predictions, (p) => p.calibrated),
    ).toBeLessThanOrEqual(underestimationP95(predictions, (p) => p.baseline));
  });

  it('beats the heuristic on every held-out observation, not only on average', () => {
    for (const prediction of predict(corpus, calibration, 'heldout')) {
      const calibratedError = Math.abs(
        (prediction.calibrated - prediction.actual) / prediction.actual,
      );
      const baselineError = Math.abs(
        (prediction.baseline - prediction.actual) / prediction.actual,
      );
      expect(calibratedError).toBeLessThan(baselineError);
    }
  });

  it('records the base-counter range it was actually measured over', () => {
    const [low, high] = calibration.provenance.validatedBaseTokenRange;
    const bases = corpus.observations.map((o) => o.projectionBaseTokens);
    expect(low).toBe(Math.min(...bases));
    expect(high).toBe(Math.max(...bases));
  });

  it('never underestimates inside the validated range', () => {
    for (const prediction of predict(corpus, calibration, 'heldout')) {
      const relativeError =
        (prediction.calibrated - prediction.actual) / prediction.actual;
      expect(relativeError).toBeGreaterThan(-0.02);
    }
  });

  it('does not let the base-counter floor bind inside the validated range', () => {
    for (const split of ['train', 'heldout'] as const) {
      for (const prediction of predict(corpus, calibration, split)) {
        expect(prediction.calibrated).toBeGreaterThan(
          prediction.observation.projectionBaseTokens,
        );
      }
    }
  });
});

describe('Claude 5 model independence', () => {
  it('gives each model its own corpus, coefficients and held-out results', () => {
    expect(CLAUDE_OPUS_5_CALIBRATION.provenance.corpusId).not.toBe(
      CLAUDE_FABLE_5_CALIBRATION.provenance.corpusId,
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.estimatorVersion).not.toBe(
      CLAUDE_FABLE_5_CALIBRATION.estimatorVersion,
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.baseTokenCoefficient).not.toBe(
      CLAUDE_FABLE_5_CALIBRATION.baseTokenCoefficient,
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.intercept).not.toBe(
      CLAUDE_FABLE_5_CALIBRATION.intercept,
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.heldOut.mapePercent).not.toBe(
      CLAUDE_FABLE_5_CALIBRATION.heldOut.mapePercent,
    );
  });

  it('measured genuinely different provider counts for the two models', () => {
    const opus = loadCorpus('claude-opus-5').observations;
    const fable = loadCorpus('claude-fable-5').observations;
    const fableById = new Map(fable.map((o) => [o.id, o]));
    const differing = opus.filter(
      (o) =>
        fableById.get(o.id)!.providerPromptTokens !== o.providerPromptTokens,
    );
    expect(differing.length).toBeGreaterThan(0);
  });

  it('clears each gate using only that model own corpus', () => {
    for (const { calibration, corpus } of MODELS) {
      expect(corpus.source.canonicalModel).toBe(
        calibration.canonicalModelFamily,
      );
      const predictions = predict(corpus, calibration, 'heldout');
      const improvement =
        ((mape(predictions, (p) => p.baseline) -
          mape(predictions, (p) => p.calibrated)) /
          mape(predictions, (p) => p.baseline)) *
        100;
      expect(improvement).toBeGreaterThanOrEqual(10);
    }
  });

  /**
   * The two models turn out to tokenize almost identically. That is a finding
   * about Anthropic's tokenizer, and it is only trustworthy because each model
   * was measured and gated separately: had Fable 5 simply been handed Opus 5's
   * numbers, this test could not tell the two situations apart.
   */
  it('records that the two independently fitted models agree closely', () => {
    const opusCorpus = loadCorpus('claude-opus-5');
    const fableCorpus = loadCorpus('claude-fable-5');
    const crossOpus = mape(
      predict(opusCorpus, CLAUDE_FABLE_5_CALIBRATION, 'heldout'),
      (p) => p.calibrated,
    );
    const crossFable = mape(
      predict(fableCorpus, CLAUDE_OPUS_5_CALIBRATION, 'heldout'),
      (p) => p.calibrated,
    );
    expect(crossOpus).toBeLessThan(2);
    expect(crossFable).toBeLessThan(2);
  });
});
