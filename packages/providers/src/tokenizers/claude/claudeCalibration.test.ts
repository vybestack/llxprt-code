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
  CLAUDE_ACTIVATION_MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT,
  type ClaudeCalibration,
} from './claudeCalibration.js';
import { extractClaudeContentFeatures } from './claudeContentFeatures.js';
import {
  CLAUDE_5_FAMILY_SPECS,
  CLAUDE_FABLE_5_WITHHELD_REASON,
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
        1,
        features,
        calibrationWith({
          intercept: -1000,
          baseTokenCoefficient: 1,
          featureCoefficients: [],
        }),
      ),
    ).toBe(0);
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

  it('rejects a calibration whose relative improvement misses the threshold', () => {
    expect(
      isActivatableClaudeCalibration(
        calibrationWith({
          heldOut: {
            ...CLAUDE_OPUS_5_CALIBRATION.heldOut,
            relativeMapeImprovementPercent:
              CLAUDE_ACTIVATION_MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT - 0.1,
          },
        }),
      ),
    ).toBe(false);
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

  it('freezes the calibration and its coefficient table', () => {
    expect(Object.isFrozen(CLAUDE_OPUS_5_CALIBRATION)).toBe(true);
    expect(Object.isFrozen(CLAUDE_OPUS_5_CALIBRATION.featureCoefficients)).toBe(
      true,
    );
    expect(Object.isFrozen(CLAUDE_OPUS_5_CALIBRATION.heldOut)).toBe(true);
    expect(Object.isFrozen(CLAUDE_OPUS_5_CALIBRATION.provenance)).toBe(true);
  });

  it('activates Opus 5 and withholds Fable 5 without borrowing coefficients', () => {
    const opus = CLAUDE_5_FAMILY_SPECS.find(
      (spec) => spec.canonicalModelFamily === 'claude-opus-5',
    );
    const fable = CLAUDE_5_FAMILY_SPECS.find(
      (spec) => spec.canonicalModelFamily === 'claude-fable-5',
    );
    expect(opus).toBeDefined();
    expect(fable).toBeDefined();
    expect(isActivatedClaude5Spec(opus!)).toBe(true);
    expect(isActivatedClaude5Spec(fable!)).toBe(false);
    expect(fable!.calibration).toBeUndefined();
    expect(fable!.withheldReason).toBe(CLAUDE_FABLE_5_WITHHELD_REASON);
    expect(opus!.withheldReason).toBeUndefined();
  });
});
