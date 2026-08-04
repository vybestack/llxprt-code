/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { PROJECTION_REVISION } from '../../runtime/promptEnvelopeProjections.js';
import { O200K_BASE_ASSET_REVISION } from '../o200kBaseCounter.js';
import {
  applyClaudeCalibration,
  isActivatableClaudeCalibration,
  relativeMapeImprovementPercent,
  CLAUDE_ACTIVATION_MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT,
  type ClaudeCalibration,
} from './claudeCalibration.js';
import { extractClaudeContentFeatures } from './claudeContentFeatures.js';
import {
  CLAUDE_5_FAMILY_SPECS,
  CLAUDE_FABLE_5_CALIBRATION,
  CLAUDE_OPUS_5_CALIBRATION,
  isActivatedClaude5Spec,
} from './claudeCalibrationAssets.js';

function calibrationWith(
  overrides: Partial<ClaudeCalibration>,
): ClaudeCalibration {
  return { ...CLAUDE_OPUS_5_CALIBRATION, ...overrides };
}

describe('Claude calibration application', () => {
  it('returns zero for empty content instead of a framing constant', () => {
    expect(
      applyClaudeCalibration(
        0,
        extractClaudeContentFeatures(''),
        calibrationWith({ intercept: 250 }),
      ),
    ).toBe(0);
  });

  it('is a deterministic rounded linear combination', () => {
    const features = extractClaudeContentFeatures('hello 日本語 {"a":1}');
    const calibration = calibrationWith({
      intercept: 3,
      baseTokenCoefficient: 2,
      featureCoefficients: [{ feature: 'codePoints', coefficient: 0.5 }],
    });
    const expected = Math.round(3 + 2 * 11 + 0.5 * features.codePoints);
    expect(applyClaudeCalibration(11, features, calibration)).toBe(expected);
    expect(applyClaudeCalibration(11, features, calibration)).toBe(expected);
  });

  it('sums every declared feature coefficient', () => {
    const features = extractClaudeContentFeatures('{"a": "日"}');
    const calibration = calibrationWith({
      intercept: 0,
      baseTokenCoefficient: 0,
      featureCoefficients: [
        { feature: 'codePoints', coefficient: 1 },
        { feature: 'nonAsciiCodePoints', coefficient: 10 },
        { feature: 'structuralCodePoints', coefficient: 100 },
        { feature: 'whitespaceCodePoints', coefficient: 1000 },
      ],
    });
    expect(applyClaudeCalibration(0, features, calibration)).toBe(
      features.codePoints +
        10 * features.nonAsciiCodePoints +
        100 * features.structuralCodePoints +
        1000 * features.whitespaceCodePoints,
    );
  });

  it('never returns a negative count', () => {
    const features = extractClaudeContentFeatures('short');
    expect(
      applyClaudeCalibration(
        0,
        features,
        calibrationWith({
          intercept: -1000,
          baseTokenCoefficient: 1,
          featureCoefficients: [],
        }),
      ),
    ).toBe(0);
  });

  /**
   * The fitted intercept is negative, which is correct inside the measured
   * request-size range but extrapolates absurdly below it. Every observation
   * in both corpora had a provider count above its base-counter reading, so
   * that reading is the floor.
   */
  it('never falls below the base-counter reading', () => {
    const features = extractClaudeContentFeatures('a short prompt');
    const tiny = calibrationWith({
      intercept: -1000,
      baseTokenCoefficient: 1,
      featureCoefficients: [],
    });
    expect(applyClaudeCalibration(50, features, tiny)).toBe(50);
    expect(
      applyClaudeCalibration(50, features, CLAUDE_OPUS_5_CALIBRATION),
    ).toBe(50);
  });

  it('leaves the floor inactive for realistic request sizes', () => {
    // English prose runs about four code points per o200k token, which is the
    // regime both corpora were measured in.
    const promptText = 'The quick brown fox jumps over the lazy dog. '.repeat(
      1500,
    );
    const features = extractClaudeContentFeatures(promptText);
    const baseTokens = Math.round(features.codePoints / 4);
    expect(baseTokens).toBeGreaterThan(15000);
    expect(
      applyClaudeCalibration(baseTokens, features, CLAUDE_OPUS_5_CALIBRATION),
    ).toBeGreaterThan(baseTokens);
  });

  it('grows monotonically with content', () => {
    const small = 'alpha';
    const large = small.repeat(50);
    const smallCount = applyClaudeCalibration(
      2,
      extractClaudeContentFeatures(small),
      CLAUDE_OPUS_5_CALIBRATION,
    );
    const largeCount = applyClaudeCalibration(
      100,
      extractClaudeContentFeatures(large),
      CLAUDE_OPUS_5_CALIBRATION,
    );
    expect(largeCount).toBeGreaterThan(smallCount);
  });
});

describe('Claude calibration activation gate', () => {
  it('accepts the shipped Opus 5 calibration', () => {
    expect(isActivatableClaudeCalibration(CLAUDE_OPUS_5_CALIBRATION)).toBe(
      true,
    );
  });

  it('rejects a calibration whose measured improvement misses the threshold', () => {
    const baselineMapePercent = 40;
    const justUnder = calibrationWith({
      heldOut: {
        ...CLAUDE_OPUS_5_CALIBRATION.heldOut,
        baselineMapePercent,
        mapePercent:
          baselineMapePercent *
          (1 -
            (CLAUDE_ACTIVATION_MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT - 0.1) /
              100),
      },
    });
    expect(relativeMapeImprovementPercent(justUnder.heldOut)).toBeCloseTo(
      CLAUDE_ACTIVATION_MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT - 0.1,
      6,
    );
    expect(isActivatableClaudeCalibration(justUnder)).toBe(false);
  });

  it('accepts a calibration that exactly meets the threshold', () => {
    const baselineMapePercent = 40;
    const atThreshold = calibrationWith({
      heldOut: {
        ...CLAUDE_OPUS_5_CALIBRATION.heldOut,
        baselineMapePercent,
        mapePercent:
          baselineMapePercent *
          (1 - CLAUDE_ACTIVATION_MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT / 100),
      },
    });
    expect(isActivatableClaudeCalibration(atThreshold)).toBe(true);
  });

  it('rejects a calibration that worsens p95 underestimation', () => {
    expect(
      isActivatableClaudeCalibration(
        calibrationWith({
          heldOut: {
            ...CLAUDE_OPUS_5_CALIBRATION.heldOut,
            underestimationP95Percent:
              CLAUDE_OPUS_5_CALIBRATION.heldOut
                .baselineUnderestimationP95Percent + 0.1,
          },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a calibration with no held-out observations', () => {
    expect(
      isActivatableClaudeCalibration(
        calibrationWith({
          heldOut: { ...CLAUDE_OPUS_5_CALIBRATION.heldOut, sampleCount: 0 },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a non-finite coefficient', () => {
    expect(
      isActivatableClaudeCalibration(
        calibrationWith({ baseTokenCoefficient: Number.NaN }),
      ),
    ).toBe(false);
  });

  it('rejects duplicate feature coefficients', () => {
    expect(
      isActivatableClaudeCalibration(
        calibrationWith({
          featureCoefficients: [
            { feature: 'codePoints', coefficient: 0.1 },
            { feature: 'codePoints', coefficient: 0.2 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects the invalid held-out metric value %p',
    (value) => {
      expect(
        isActivatableClaudeCalibration(
          calibrationWith({
            heldOut: {
              ...CLAUDE_OPUS_5_CALIBRATION.heldOut,
              underestimationP95Percent: value,
            },
          }),
        ),
      ).toBe(false);
    },
  );

  it('rejects a headline improvement that its own MAPE values do not support', () => {
    const dishonest = calibrationWith({
      heldOut: {
        ...CLAUDE_OPUS_5_CALIBRATION.heldOut,
        mapePercent: 37,
        baselineMapePercent: 38,
        relativeMapeImprovementPercent: 99,
      },
    });
    expect(relativeMapeImprovementPercent(dishonest.heldOut)).toBeCloseTo(
      2.6315,
      3,
    );
    expect(isActivatableClaudeCalibration(dishonest)).toBe(false);
  });

  it('derives the shipped improvement from the shipped MAPE values', () => {
    expect(
      relativeMapeImprovementPercent(CLAUDE_OPUS_5_CALIBRATION.heldOut),
    ).toBeCloseTo(
      CLAUDE_OPUS_5_CALIBRATION.heldOut.relativeMapeImprovementPercent,
      3,
    );
  });

  it('rejects a zero baseline that would make improvement undefined', () => {
    expect(
      isActivatableClaudeCalibration(
        calibrationWith({
          heldOut: {
            ...CLAUDE_OPUS_5_CALIBRATION.heldOut,
            baselineMapePercent: 0,
          },
        }),
      ),
    ).toBe(false);
  });
});

describe('Claude 5 calibration assets', () => {
  it('binds the Opus 5 calibration to its model, protocol and revisions', () => {
    expect(CLAUDE_OPUS_5_CALIBRATION.canonicalModelFamily).toBe(
      'claude-opus-5',
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.protocol).toBe('anthropic-messages');
    expect(CLAUDE_OPUS_5_CALIBRATION.projectionRevision).toBe(
      PROJECTION_REVISION,
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.baseCounterAssetRevision).toBe(
      O200K_BASE_ASSET_REVISION,
    );
  });

  it('records provider prompt tokens including cached tokens as the target', () => {
    expect(CLAUDE_OPUS_5_CALIBRATION.provenance.groundTruth).toContain(
      'cached prompt tokens',
    );
    expect(
      CLAUDE_OPUS_5_CALIBRATION.provenance.corpusObservations,
    ).toBeGreaterThan(0);
  });

  it('records the base-counter range each calibration was measured over', () => {
    for (const calibration of [
      CLAUDE_OPUS_5_CALIBRATION,
      CLAUDE_FABLE_5_CALIBRATION,
    ]) {
      const [low, high] = calibration.provenance.validatedBaseTokenRange;
      expect(low).toBeGreaterThan(0);
      expect(high).toBeGreaterThan(low);
    }
  });

  it('freezes the calibration and its coefficient table', () => {
    expect(Object.isFrozen(CLAUDE_OPUS_5_CALIBRATION)).toBe(true);
    expect(Object.isFrozen(CLAUDE_OPUS_5_CALIBRATION.featureCoefficients)).toBe(
      true,
    );
    expect(Object.isFrozen(CLAUDE_OPUS_5_CALIBRATION.heldOut)).toBe(true);
    expect(Object.isFrozen(CLAUDE_OPUS_5_CALIBRATION.provenance)).toBe(true);
  });

  it('fails loudly rather than degrading when a declared calibration is corrupt', () => {
    const opus = CLAUDE_5_FAMILY_SPECS.find(
      (spec) => spec.canonicalModelFamily === 'claude-opus-5',
    )!;
    expect(() =>
      isActivatedClaude5Spec({
        ...opus,
        calibration: calibrationWith({ baseTokenCoefficient: Number.NaN }),
      }),
    ).toThrow(/claude-opus-5/);
  });

  it('activates each model from its own calibration', () => {
    for (const family of ['claude-opus-5', 'claude-fable-5']) {
      const spec = CLAUDE_5_FAMILY_SPECS.find(
        (candidate) => candidate.canonicalModelFamily === family,
      );
      expect(spec).toBeDefined();
      expect(isActivatedClaude5Spec(spec!)).toBe(true);
      expect(spec!.calibration?.canonicalModelFamily).toBe(family);
      expect(spec!.withheldReason).toBeUndefined();
    }
  });

  it('withholds a model whose calibration is absent rather than borrowing one', () => {
    const opus = CLAUDE_5_FAMILY_SPECS.find(
      (spec) => spec.canonicalModelFamily === 'claude-opus-5',
    )!;
    const withheld = {
      ...opus,
      canonicalModelFamily: 'claude-hypothetical-6',
      calibration: undefined,
      withheldReason: 'no trustworthy observations for this model yet',
    };
    expect(isActivatedClaude5Spec(withheld)).toBe(false);
  });

  it('keeps the two models coefficients and evidence separate', () => {
    expect(CLAUDE_OPUS_5_CALIBRATION.canonicalModelFamily).toBe(
      'claude-opus-5',
    );
    expect(CLAUDE_FABLE_5_CALIBRATION.canonicalModelFamily).toBe(
      'claude-fable-5',
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.provenance.corpusId).not.toBe(
      CLAUDE_FABLE_5_CALIBRATION.provenance.corpusId,
    );
    expect(CLAUDE_OPUS_5_CALIBRATION.baseTokenCoefficient).not.toBe(
      CLAUDE_FABLE_5_CALIBRATION.baseTokenCoefficient,
    );
  });
});
