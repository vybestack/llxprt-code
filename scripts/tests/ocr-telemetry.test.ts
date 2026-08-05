/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildGuaranteedTelemetry,
  buildTelemetry,
  crossDistribution,
  elapsedToSeconds,
  renderTelemetryMarkdown,
  validateTelemetryInput,
} from '../ocr-telemetry.ts';
import {
  validateTelemetryRecord,
  validateReconciliation,
} from '../ocr-telemetry-schema.ts';

function baseMetadata(overrides = {}) {
  return {
    schema: 1,
    ocr: {
      version: '1.7.16',
      model: 'test-model',
      concurrency: 2,
      elapsed: '46m31s',
      tokens: {
        input: 300,
        output: 100,
        cache_read: 50,
        cache_write: 25,
        cache: 75,
        total: 400,
      },
    },
    range: {
      selected: { files: 7 },
      cumulative: { files: 63 },
    },
    findings: {
      raw: 4,
      inline: 2,
      severity_distribution: { high: 1, medium: 1, low: 1, unknown: 1 },
      category_distribution: { bug: 1, style: 1, unknown: 2 },
    },
    terminal: {
      completeness_state: 'complete',
      publication_state: 'complete',
    },
    ...overrides,
  };
}

function baseManifest(overrides = {}) {
  return {
    schema_version: '1.0.0',
    selected_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'],
    completed_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'],
    failed_files: [],
    completeness: 'complete',
    ...overrides,
  };
}

function baseRoutingDecisions() {
  return [
    {
      path: 'a.ts',
      start_line: 10,
      end_line: 10,
      category: 'bug',
      severity: 'high',
      destination: 'inline',
      reason: "category 'bug': always inline",
    },
    {
      path: 'b.ts',
      start_line: 5,
      end_line: 5,
      category: 'style',
      severity: 'low',
      destination: 'summary',
      reason: "category 'style' severity 'low': routed to summary",
    },
    {
      path: 'c.ts',
      start_line: 1,
      end_line: 1,
      category: 'unknown',
      severity: 'medium',
      destination: 'inline',
      reason: "severity 'medium': inline",
    },
    {
      path: 'd.ts',
      start_line: 2,
      end_line: 2,
      category: 'unknown',
      severity: 'unknown',
      destination: 'inline',
      reason: 'fail-safe inline',
    },
  ];
}

function baseContext(overrides = {}) {
  return {
    runId: '123456',
    runAttempt: '1',
    prNumber: 2676,
    sha: 'abc123def456789012345678901234567890abcd',
    generatedAt: '2026-07-25T23:09:35.000Z',
    infrastructureFailure: false,
    policyFailure: false,
    inlinePosted: 2,
    alreadyResolved: null,
    alreadyPostedOrSkippedDedup: 1,
    commentsSkipped: 1,
    commentsFailed: 0,
    commentsTotal: 4,
    wallClockSeconds: 2791,
    filesReviewed: 7,
    perFileReviewFailures: ['x.ts'],
    telemetryState: 'complete',
    postState: 'posted',
    postOutcome: 'success',
    artifactState: 'prepared',
    hashState: 'prepared',
    previewAttempted: true,
    previewSucceeded: true,
    commentsRoutedSummary: 1,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    metadata: baseMetadata(),
    manifest: baseManifest(),
    routingDecisions: baseRoutingDecisions(),
    context: baseContext(),
    ...overrides,
  };
}

describe('elapsedToSeconds', () => {
  it('parses minutes and seconds', () => {
    expect(elapsedToSeconds('46m31s')).toBe(46 * 60 + 31);
  });
  it('parses hours, minutes, and seconds', () => {
    expect(elapsedToSeconds('1h2m3s')).toBe(3600 + 120 + 3);
  });
  it('parses bare seconds', () => {
    expect(elapsedToSeconds('90s')).toBe(90);
  });
  it('parses zero seconds to 0', () => {
    expect(elapsedToSeconds('0s')).toBe(0);
  });
  it('parses milliseconds as fractional seconds', () => {
    expect(elapsedToSeconds('1500ms')).toBeCloseTo(1.5, 5);
  });
  it('returns null for an unparseable value', () => {
    expect(elapsedToSeconds('unknown')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(elapsedToSeconds('')).toBeNull();
    expect(elapsedToSeconds(undefined)).toBeNull();
  });
  it('returns null for a numeric-only value with no unit', () => {
    expect(elapsedToSeconds('12345')).toBeNull();
  });
  it('returns null for a malformed value like 1.s', () => {
    expect(elapsedToSeconds('1.s')).toBeNull();
  });
  it('returns null for Infinity-like overflow', () => {
    expect(elapsedToSeconds('1e999s')).toBeNull();
  });
});

describe('crossDistribution', () => {
  it('builds category x severity matrix including unknowns', () => {
    const decisions = baseRoutingDecisions();
    const result = crossDistribution(decisions);
    expect(result).toEqual({
      bug: { high: 1, low: 0, medium: 0, unknown: 0 },
      style: { high: 0, low: 1, medium: 0, unknown: 0 },
      unknown: { high: 0, low: 0, medium: 1, unknown: 1 },
    });
  });
  it('produces an empty object for no findings', () => {
    expect(crossDistribution([])).toEqual({});
  });
});

describe('buildTelemetry — schema validity', () => {
  it('emits a record that passes strict validation', () => {
    const telemetry = buildTelemetry(baseInput());
    expect(validateTelemetryRecord(telemetry)).toBeNull();
    expect(validateReconciliation(telemetry)).toBeNull();
  });
  it('includes run identity and PR context fields', () => {
    const telemetry = buildTelemetry(baseInput());
    expect(telemetry.run_id).toBe('123456');
    expect(telemetry.run_attempt).toBe('1');
    expect(telemetry.pr_number).toBe(2676);
    expect(telemetry.sha).toBe('abc123def456789012345678901234567890abcd');
    expect(telemetry.generated_at).toBe('2026-07-25T23:09:35.000Z');
  });
  it('prefers workflow wall_clock_seconds over result.elapsed', () => {
    const telemetry = buildTelemetry(
      baseInput({ context: baseContext({ wallClockSeconds: 55 }) }),
    );
    expect(telemetry.wall_clock_seconds).toBe(55);
  });
  it('keeps wall_clock_seconds null when workflow timer evidence is unavailable', () => {
    const telemetry = buildTelemetry(
      baseInput({ context: baseContext({ wallClockSeconds: null }) }),
    );
    expect(telemetry.wall_clock_seconds).toBeNull();
  });
  it('keeps cli_elapsed_seconds separate from wall_clock_seconds', () => {
    const telemetry = buildTelemetry(
      baseInput({ context: baseContext({ wallClockSeconds: 55 }) }),
    );
    expect(telemetry.cli_elapsed_seconds).toBe(46 * 60 + 31);
  });
});

describe('buildTelemetry — files_reviewed from result summary', () => {
  it('uses context.filesReviewed (validated OCR summary count)', () => {
    const telemetry = buildTelemetry(
      baseInput({ context: baseContext({ filesReviewed: 5 }) }),
    );
    expect(telemetry.files_reviewed).toBe(5);
  });
  it('preserves files_reviewed from context', () => {
    const telemetry = buildTelemetry(
      baseInput({ context: baseContext({ filesReviewed: 6 }) }),
    );
    expect(telemetry.files_reviewed).toBe(6);
  });
  it('preserves manifest completed count separately in reviewed_range_manifest', () => {
    const telemetry = buildTelemetry(
      baseInput({
        manifest: baseManifest({
          completed_files: ['a.ts', 'b.ts'],
        }),
        context: baseContext({ filesReviewed: 5 }),
      }),
    );
    expect(telemetry.files_reviewed).toBe(5);
    expect(telemetry.reviewed_range_manifest?.completed_files).toBe(2);
  });
});

describe('buildTelemetry — files_previewed from selected scope', () => {
  it('derives files_previewed from manifest selected scope', () => {
    const telemetry = buildTelemetry(baseInput());
    expect(telemetry.files_previewed).toBe(7);
  });
  it('handles no-changed-tests / empty selected scope', () => {
    const telemetry = buildTelemetry(
      baseInput({
        manifest: baseManifest({ selected_files: [], completed_files: [] }),
        context: baseContext({ filesReviewed: 0, perFileReviewFailures: [] }),
      }),
    );
    expect(telemetry.files_previewed).toBe(0);
    expect(telemetry.files_reviewed).toBe(0);
  });
});

describe('buildTelemetry — file_read_failures semantics', () => {
  it('emits file_read_failures null when read evidence unavailable', () => {
    const telemetry = buildTelemetry(
      baseInput({
        context: baseContext({ perFileReviewFailures: undefined }),
      }),
    );
    expect(telemetry.file_read_failures).toBeNull();
    expect(telemetry.file_read_failure_count).toBeNull();
  });

  it('degrades valid telemetry when files_reviewed exceeds preview evidence', () => {
    const telemetry = buildTelemetry(
      baseInput({
        manifest: baseManifest({
          selected_files: ['a.ts'],
          completed_files: ['a.ts'],
        }),
        context: baseContext({ filesReviewed: 2 }),
      }),
    );
    expect(telemetry.files_previewed).toBe(1);
    expect(telemetry.files_reviewed).toBeNull();
    expect(telemetry.infrastructure_failure).toBe(true);
    expect(telemetry.telemetry_state).toBe('degraded');
    expect(telemetry.errors).toContain(
      'OCR files_reviewed exceeded the successful preview scope',
    );
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });
  it('emits per_file_review_failures from explicit OCR evidence', () => {
    const telemetry = buildTelemetry(baseInput());
    expect(telemetry.per_file_review_failures).toEqual(['x.ts']);
    expect(telemetry.per_file_review_failure_count).toBe(1);
  });
});

describe('buildTelemetry — already_resolved semantics', () => {
  it('emits the explicit prior-head dedup count independently from comments_skipped', () => {
    const telemetry = buildTelemetry(
      baseInput({
        context: baseContext({ alreadyResolved: 2, commentsSkipped: 3 }),
      }),
    );
    expect(telemetry.already_resolved).toBe(2);
    expect(telemetry.comments_skipped).toBe(3);
  });
});

describe('buildTelemetry — failure / unavailable context', () => {
  it('allows null sha (missing PR/SHA) and still validates', () => {
    const telemetry = buildTelemetry(
      baseInput({ context: baseContext({ sha: null }) }),
    );
    expect(telemetry.sha).toBeNull();
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });
  it('records telemetry_state and post_state explicitly', () => {
    const telemetry = buildTelemetry(baseInput());
    expect(telemetry.telemetry_state).toBe('complete');
    expect(telemetry.post_state).toBe('posted');
  });
});

describe('validateTelemetryInput — fail-fast validation', () => {
  it('returns null for a well-formed input', () => {
    expect(validateTelemetryInput(baseInput())).toBeNull();
  });
  it('fails when metadata is not an object', () => {
    expect(validateTelemetryInput(baseInput({ metadata: null }))).toMatch(
      /metadata/i,
    );
  });
  it('fails when run_id is missing', () => {
    expect(
      validateTelemetryInput(
        baseInput({ context: baseContext({ runId: undefined }) }),
      ),
    ).toMatch(/run_id/i);
  });
});
describe('buildGuaranteedTelemetry — malformed input fallback', () => {
  it('returns a schema-valid failed record for malformed identity and lifecycle context', () => {
    const telemetry = buildGuaranteedTelemetry(
      baseInput({
        context: baseContext({
          runId: '',
          runAttempt: 'invalid',
          prNumber: -1,
          sha: 'not-a-sha',
          generatedAt: 'not-a-timestamp',
          telemetryState: 'invalid',
          postState: 'invalid',
          artifactState: 'invalid',
          hashState: 'invalid',
        }),
        errors: [null, '', 'source failure'],
      }),
      { error: new Error('fallback failure') },
    );

    expect(validateTelemetryRecord(telemetry)).toBeNull();
    expect(telemetry).toMatchObject({
      run_id: 'unavailable',
      run_attempt: null,
      pr_number: null,
      sha: null,
      telemetry_state: 'failed',
      post_state: 'failed',
      artifact_state: 'failed',
      hash_state: 'failed',
      infrastructure_failure: true,
    });
    expect(telemetry.errors).toContain('fallback failure');
  });

  it('returns a schema-valid failed record when the input is missing', () => {
    const telemetry = buildGuaranteedTelemetry(null);

    expect(validateTelemetryRecord(telemetry)).toBeNull();
    expect(telemetry.errors.length).toBeGreaterThan(0);
  });
});

describe('renderTelemetryMarkdown', () => {
  it('renders a compact deterministic summary', () => {
    const telemetry = buildTelemetry(baseInput());
    const markdown = renderTelemetryMarkdown(telemetry);
    expect(markdown).toContain('## OCR Telemetry');
    expect(markdown).toContain('PR #2676');
    expect(markdown).toContain('| total findings | 4 |');
  });
  it('renders unavailable wall-clock explicitly', () => {
    const telemetry = buildTelemetry(
      baseInput({
        context: baseContext({ wallClockSeconds: null }),
        metadata: baseMetadata({
          ocr: { ...baseMetadata().ocr, elapsed: 'unknown' },
        }),
      }),
    );
    const markdown = renderTelemetryMarkdown(telemetry);
    expect(markdown).toContain('| wall-clock / CLI elapsed (s) | n/a / n/a |');
  });
  it('escapes Markdown-sensitive identity values', () => {
    const telemetry = buildTelemetry(
      baseInput({ context: baseContext({ runId: 'run`\n## injected' }) }),
    );
    const markdown = renderTelemetryMarkdown(telemetry);

    expect(markdown).toContain('run `run&#96;&#10;## injected`');
    expect(markdown).not.toContain('run`\n## injected');
  });
  it('renders already-resolved publication volume', () => {
    const telemetry = buildTelemetry(
      baseInput({ context: baseContext({ alreadyResolved: 2 }) }),
    );
    const markdown = renderTelemetryMarkdown(telemetry);

    expect(markdown).toContain('| already resolved | 2 |');
  });

  it('renders malformed token counts as unavailable', () => {
    const markdown = renderTelemetryMarkdown({
      tokens: {
        total: '10',
        input: '4',
        output: '6',
        cache_read: '0',
        cache_write: '0',
      },
    });
    expect(markdown).toContain(
      '| tokens | n/a total (n/a input, n/a output, n/a cache read, n/a cache write) |',
    );
    expect(markdown).not.toContain('10 total');
  });
});

describe('elapsedToSeconds — strict grammar', () => {
  it.each(['1m 2s', '1s2m', '1m2m', '1ms2s', '1h2h', '1s1ms1ms'])(
    'rejects malformed ordered-unit elapsed value %s',
    (elapsed) => {
      expect(elapsedToSeconds(elapsed)).toBeNull();
    },
  );
});

describe('routing decision validation', () => {
  // Bun's it.each treats an array row (e.g. []) as a "spread row": its
  // elements become individual callback arguments. An empty array yields
  // zero arguments, so Bun sees callback.length === 1 and injects a done
  // callback, causing the test to hang forever. Iterating with individual
  // it() calls avoids the spread-row ambiguity while keeping the same four
  // test cases under both Bun and Vitest.
  const malformedRoutingDecisions: readonly unknown[] = [
    null,
    [],
    { category: 1, severity: 'high' },
    { category: 'bug', severity: null },
  ];
  for (const decision of malformedRoutingDecisions) {
    it(`rejects malformed routing decision ${JSON.stringify(decision)}`, () => {
      const input = baseInput({ routingDecisions: [decision] });
      expect(validateTelemetryInput(input)).toMatch(/routingDecisions/i);
    });
  }
});
