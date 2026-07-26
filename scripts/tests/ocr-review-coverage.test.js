/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeLoadFunction,
  makeLoadFunctionsTogether,
  useWorkflowFixture,
} from './ocr-manifest-test-helpers.js';
import {
  commandText,
  extractFunctionSource,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

const VM_TIMEOUT_MS = 2000;
const SANDBOX_GLOBALS = {
  Number,
  Math,
  JSON,
  String,
  Object,
  Array,
  Boolean,
  Error,
  Set,
  Map,
};

let tmpDir;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cov-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('.github/workflows/ocr-review.yml — changed-file coverage verification (issue #2675)', () => {
  const ctx = useWorkflowFixture();
  const loadFunction = makeLoadFunction(ctx);
  const loadFunctionsTogether = makeLoadFunctionsTogether(ctx);

  describe('normalizeFilePaths behavior', () => {
    it('trims surrounding whitespace from each path', () => {
      const fn = loadFunction('normalizeFilePaths');
      expect(fn(['  a.ts  ', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
    });

    it('removes empty and whitespace-only entries', () => {
      const fn = loadFunction('normalizeFilePaths');
      expect(fn(['a.ts', '', '   ', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
    });

    it('deduplicates repeated paths preserving first-seen order', () => {
      const fn = loadFunction('normalizeFilePaths');
      expect(fn(['a.ts', 'b.ts', 'a.ts', 'c.ts', 'b.ts'])).toEqual([
        'a.ts',
        'b.ts',
        'c.ts',
      ]);
    });

    it('returns an empty array for a non-array input', () => {
      const fn = loadFunction('normalizeFilePaths');
      expect(fn(null)).toEqual([]);
      expect(fn(undefined)).toEqual([]);
    });
  });

  describe('evidencedPathsFromResult behavior (parsed input parity)', () => {
    function loadFn() {
      return loadFunction('evidencedPathsFromResult');
    }

    it('extracts path fields from a findings array', () => {
      const fn = loadFn();
      const result = fn([
        { path: 'src/a.ts', content: 'x' },
        { path: 'src/b.ts', content: 'y' },
      ]);
      expect(result).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('extracts from a parsed result object with a comments array', () => {
      const fn = loadFn();
      const result = fn({
        status: 'success',
        comments: [
          { path: 'src/a.ts', content: 'x' },
          { path: 'src/b.ts', content: 'y' },
        ],
      });
      expect(result).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('uses a file field as a fallback when path is absent on a finding', () => {
      const fn = loadFn();
      const result = fn([{ file: 'src/file-field.ts', content: 'c' }]);
      expect(result).toContain('src/file-field.ts');
    });

    it('deduplicates paths from findings', () => {
      const fn = loadFn();
      const result = fn([{ path: 'shared.ts' }, { path: 'shared.ts' }]);
      expect(result).toEqual(['shared.ts']);
    });

    it('does not extract paths from aggregate tool_calls (no file paths)', () => {
      const fn = loadFn();
      const result = fn({
        status: 'success',
        comments: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
        warnings: [{ type: 'subtask_error', file: 'src/c.ts' }],
        tool_calls: { total: 5, by_tool: { file_read: 3, code_comment: 2 } },
      });
      expect(result).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('returns an empty array for null or undefined input', () => {
      const fn = loadFn();
      expect(fn(null)).toEqual([]);
      expect(fn(undefined)).toEqual([]);
    });

    it('returns an empty array for an empty findings array', () => {
      const fn = loadFn();
      expect(fn([])).toEqual([]);
    });
  });

  describe('parse-salvage integration (parseFindings → evidencedPathsFromResult)', () => {
    function loadParseAndEvidence() {
      const sandbox = loadFunctionsTogether(
        [
          'findingsFromParsed',
          'parseFindings',
          'evidencedPathsFromResult',
          'markInfrastructureFailure',
          'redactSecretDiagnostics',
          'escapeRegExp',
          'readTrimmed',
          'sanitizeExcerpt',
          'readExitCode',
        ],
        {
          REDACTION: '[REDACTED]',
          ocrTokenForRedaction: '',
          ocrUrlForRedaction: '',
          INFRA_FAILURE_FILE: 'ocr-infrastructure-failure.txt',
          POLICY_FAILURE_FILE: 'ocr-policy-failure.txt',
          fs: {
            readFileSync: () => '',
            writeFileSync: () => {},
          },
          core: {
            warning: () => {},
            info: () => {},
            setFailed: () => {},
          },
          process: { stderr: { write: () => {} } },
        },
      );
      return sandbox;
    }

    it('salvages findings from noisy JSON with trailing text', () => {
      const { parseFindings, evidencedPathsFromResult } =
        loadParseAndEvidence();
      const noisy = [
        'Review starting...',
        '{"status":"success","comments":[',
        '{"path":"src/a.ts","content":"bug"}',
        ']}',
        'Review complete.',
      ].join('\n');
      const findings = parseFindings(noisy);
      expect(findings).not.toBeNull();
      const paths = evidencedPathsFromResult(findings);
      expect(paths).toEqual(['src/a.ts']);
    });

    it('salvages a bare JSON array from noisy output', () => {
      const { parseFindings, evidencedPathsFromResult } =
        loadParseAndEvidence();
      const noisy = [
        'WARNING: color codes \x1b[32m\x1b[0m',
        '[{"path":"src/b.ts","content":"x"}]',
        'Done.',
      ].join('\n');
      const findings = parseFindings(noisy);
      expect(findings).not.toBeNull();
      const paths = evidencedPathsFromResult(findings);
      expect(paths).toEqual(['src/b.ts']);
    });

    it('parses valid JSON envelope and extracts evidence paths', () => {
      const { parseFindings, evidencedPathsFromResult } =
        loadParseAndEvidence();
      const raw = JSON.stringify({
        status: 'success',
        comments: [
          { path: 'src/x.ts', content: 'a' },
          { path: 'src/y.ts', content: 'b' },
        ],
      });
      const findings = parseFindings(raw);
      expect(findings).not.toBeNull();
      expect(evidencedPathsFromResult(findings)).toEqual([
        'src/x.ts',
        'src/y.ts',
      ]);
    });
  });

  describe('readFailuresFromStderr behavior (exact issue line)', () => {
    it('parses the exact verbatim issue line and preserves the quoted path', () => {
      const fn = loadFunction('readFailuresFromStderr');
      const stderr =
        '[ocr] file_read failed: file "scripts/install-native-launchers.cjs" not found: git show abc:scripts/install-native-launchers.cjs: exit status 128\n';
      expect(fn(stderr)).toEqual(['scripts/install-native-launchers.cjs']);
    });

    it('deduplicates repeated failure paths', () => {
      const fn = loadFunction('readFailuresFromStderr');
      const stderr =
        '[ocr] file_read failed: file "src/dup.ts" not found: git show x: exit status 128\n' +
        '[ocr] file_read failed: file "src/dup.ts" not found: git show y: exit status 128\n';
      expect(fn(stderr)).toEqual(['src/dup.ts']);
    });

    it('preserves paths containing spaces inside quotes', () => {
      const fn = loadFunction('readFailuresFromStderr');
      const stderr =
        '[ocr] file_read failed: file "my project/old script.cjs" not found: git show z: exit status 128\n';
      expect(fn(stderr)).toEqual(['my project/old script.cjs']);
    });

    it('returns an empty array when no file_read failures are present', () => {
      const fn = loadFunction('readFailuresFromStderr');
      expect(fn('everything is fine\nno errors here')).toEqual([]);
    });

    it('returns an empty array for empty stderr', () => {
      const fn = loadFunction('readFailuresFromStderr');
      expect(fn('')).toEqual([]);
    });
  });

  describe('resolveCoverageThreshold behavior', () => {
    function loadFn() {
      return loadFunction('resolveCoverageThreshold');
    }

    it('returns the provided value when in range 0..100', () => {
      const fn = loadFn();
      expect(fn(0)).toBe(0);
      expect(fn(100)).toBe(100);
      expect(fn(90)).toBe(90);
      expect(fn('75')).toBe(75);
    });

    it('defaults to 90 when the value is out of range', () => {
      const fn = loadFn();
      expect(fn(101)).toBe(90);
      expect(fn(-1)).toBe(90);
      expect(fn(150)).toBe(90);
    });

    it('defaults to 90 for non-numeric or empty input', () => {
      const fn = loadFn();
      expect(fn('abc')).toBe(90);
      expect(fn(undefined)).toBe(90);
      expect(fn('')).toBe(90);
      expect(fn(null)).toBe(90);
    });
  });

  describe('computeFileCoverage behavior', () => {
    function loadFn() {
      return loadFunctionsTogether([
        'normalizeFilePaths',
        'computeFileCoverage',
      ]).computeFileCoverage;
    }

    it('uses the intersection of preview and evidenced as the covered numerator', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts', 'b.ts'],
        evidencedFiles: ['a.ts', 'surprise.ts'],
        readFailureFiles: [],
      });
      expect(result.coveredFiles).toEqual(['a.ts']);
      expect(result.counts.covered).toBe(1);
      expect(result.counts.preview).toBe(2);
      expect(result.counts.evidenced).toBe(2);
      expect(result.unexpectedFiles).toEqual(['surprise.ts']);
      expect(result.counts.unexpected).toBe(1);
    });

    it('unexpected evidenced paths cannot inflate coverage above 100', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts'],
        evidencedFiles: ['a.ts', 'surprise.ts', 'extra.ts'],
        readFailureFiles: [],
      });
      expect(result.coverage.ratio).toBe(1);
      expect(result.coverage.percentage).toBe(100);
      expect(result.counts.covered).toBe(1);
      expect(result.counts.unexpected).toBe(2);
    });

    it('identifies preview-only files (no evidence, no failure) as informational', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts', 'b.ts', 'c.ts'],
        evidencedFiles: ['a.ts'],
        readFailureFiles: [],
      });
      expect(result.previewOnlyFiles).toEqual(['b.ts', 'c.ts']);
      expect(result.counts.preview_only).toBe(2);
      expect(result.counts.covered).toBe(1);
    });

    it('removes failed preview paths from covered evidence', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts', 'b.ts'],
        evidencedFiles: ['a.ts', 'b.ts'],
        readFailureFiles: ['b.ts'],
      });
      expect(result.coveredFiles).toEqual(['a.ts']);
      expect(result.failedPreviewFiles).toEqual(['b.ts']);
      expect(result.counts.covered).toBe(1);
      expect(result.counts.failed_preview).toBe(1);
      expect(result.counts.read_failures).toBe(1);
    });

    it('defines empty preview semantics as 100% coverage with no gaps', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: [],
        evidencedFiles: [],
        readFailureFiles: [],
      });
      expect(result.counts.preview).toBe(0);
      expect(result.coverage.ratio).toBe(1);
      expect(result.coverage.percentage).toBe(100);
      expect(result.previewOnlyFiles).toEqual([]);
      expect(result.failedPreviewFiles).toEqual([]);
    });

    it('does not count zero-evidence preview files as covered', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts', 'b.ts'],
        evidencedFiles: [],
        readFailureFiles: [],
      });
      expect(result.counts.covered).toBe(0);
      expect(result.coverage.percentage).toBe(0);
    });
  });

  describe('buildCoverageReport behavior', () => {
    function loadFn() {
      return loadFunctionsTogether([
        'normalizeFilePaths',
        'resolveCoverageThreshold',
        'computeFileCoverage',
        'buildCoverageReport',
      ]).buildCoverageReport;
    }

    it('produces a deterministic report with separated counts and lists', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts', 'b.ts'],
        evidencedFiles: ['a.ts'],
        readFailureFiles: [],
        thresholdPercentage: 90,
      });
      expect(result.schema_version).toBe('1.0.0');
      expect(result.counts.preview).toBe(2);
      expect(result.counts.evidenced).toBe(1);
      expect(result.counts.covered).toBe(1);
      expect(result.counts.preview_only).toBe(1);
      expect(result.counts.unexpected).toBe(0);
      expect(result.counts.read_failures).toBe(0);
      expect(result.coverage.ratio).toBe(0.5);
      expect(result.coverage.percentage).toBe(50);
      expect(result.covered_files).toEqual(['a.ts']);
      expect(result.preview_only_files).toEqual(['b.ts']);
      expect(result.threshold_percentage).toBe(90);
      expect(result.below_threshold).toBe(true);
    });

    it('reports below_threshold false when coverage meets the threshold', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts', 'b.ts'],
        evidencedFiles: ['a.ts', 'b.ts'],
        readFailureFiles: [],
        thresholdPercentage: 90,
      });
      expect(result.coverage.percentage).toBe(100);
      expect(result.below_threshold).toBe(false);
    });

    it('compares the unrounded ratio so 89.5% is below a 90 threshold', () => {
      const fn = loadFn();
      const preview = Array.from({ length: 200 }, (_, i) => `f${i}.ts`);
      const covered = preview.slice(0, 179);
      const result = fn({
        previewFiles: preview,
        evidencedFiles: covered,
        readFailureFiles: [],
        thresholdPercentage: 90,
      });
      expect(result.coverage.percentage).toBe(90);
      expect(result.below_threshold).toBe(true);
    });

    it('treats exactly 90% as meeting a 90 threshold (boundary)', () => {
      const fn = loadFn();
      const preview = Array.from({ length: 200 }, (_, i) => `f${i}.ts`);
      const covered = preview.slice(0, 180);
      const result = fn({
        previewFiles: preview,
        evidencedFiles: covered,
        readFailureFiles: [],
        thresholdPercentage: 90,
      });
      expect(result.coverage.percentage).toBe(90);
      expect(result.below_threshold).toBe(false);
    });

    it('marks below_threshold true when read failures exist even if coverage is 100%', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts'],
        evidencedFiles: ['a.ts'],
        readFailureFiles: ['other.ts'],
        thresholdPercentage: 90,
      });
      expect(result.coverage.percentage).toBe(100);
      expect(result.ratio_below_threshold).toBe(false);
      expect(result.has_review_failures).toBe(true);
      expect(result.below_threshold).toBe(true);
      expect(result.counts.read_failures).toBe(1);
      expect(result.counts.failed_preview).toBe(0);
    });

    it('splits ratio_below_threshold from has_review_failures (both true)', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts', 'b.ts', 'c.ts'],
        evidencedFiles: ['a.ts'],
        readFailureFiles: ['b.ts'],
        thresholdPercentage: 90,
      });
      expect(result.ratio_below_threshold).toBe(true);
      expect(result.has_review_failures).toBe(true);
      expect(result.below_threshold).toBe(true);
    });

    it('marks evidence_available true for non-noop review', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts'],
        evidencedFiles: ['a.ts'],
        readFailureFiles: [],
        thresholdPercentage: 90,
      });
      expect(result.evidence_available).toBe(true);
    });

    it('defaults threshold to 90 when not provided', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts'],
        evidencedFiles: [],
        readFailureFiles: [],
      });
      expect(result.threshold_percentage).toBe(90);
    });

    it('unions structured subtask_error failures with stderr read failures', () => {
      const fn = loadFn();
      const result = fn({
        previewFiles: ['a.ts', 'b.ts', 'c.ts'],
        evidencedFiles: ['a.ts', 'b.ts', 'c.ts'],
        readFailureFiles: ['b.ts', 'c.ts'],
        thresholdPercentage: 90,
      });
      expect(result.counts.read_failures).toBe(2);
      expect(result.counts.failed_preview).toBe(2);
      expect(result.counts.covered).toBe(1);
      expect(result.failed_preview_files).toEqual(['b.ts', 'c.ts']);
      expect(result.below_threshold).toBe(true);
    });
  });

  describe('coverageWarningText behavior', () => {
    it('returns a warning string when coverage is below threshold', () => {
      const fn = loadFunction('coverageWarningText');
      const text = fn({
        coverage: { ratio: 0.5, percentage: 50 },
        threshold_percentage: 90,
        ratio_below_threshold: true,
        has_review_failures: false,
        below_threshold: true,
        counts: { preview: 4, covered: 2, read_failures: 0 },
      });
      expect(text).toContain('2/4');
      expect(text).toContain('90');
      expect(text.toLowerCase()).toContain('coverage');
    });

    it('returns a warning when read failures exist even if coverage meets threshold', () => {
      const fn = loadFunction('coverageWarningText');
      const text = fn({
        coverage: { ratio: 1, percentage: 100 },
        threshold_percentage: 90,
        ratio_below_threshold: false,
        has_review_failures: true,
        below_threshold: true,
        counts: { preview: 2, covered: 2, read_failures: 1 },
      });
      expect(text.toLowerCase()).toContain('read');
      expect(text).toContain('1');
      // Must NOT say "100% below 90%" when the ratio meets threshold
      expect(text).not.toMatch(/100%\s+is below the\s+90%/);
    });

    it('does not claim rounded 90% is below 90 when ratio is 89.5%', () => {
      const fn = loadFunction('coverageWarningText');
      const text = fn({
        coverage: { ratio: 0.895, percentage: 90 },
        threshold_percentage: 90,
        ratio_below_threshold: true,
        has_review_failures: false,
        below_threshold: true,
        counts: { preview: 200, covered: 179, read_failures: 0 },
      });
      // Must show precise counts, not just rounded 90%
      expect(text).toContain('179/200');
      // Must not falsely claim "90% is below 90%"
      expect(text).not.toMatch(/90%\s+is below the\s+90%/);
    });

    it('reports out-of-preview read failure as a review failure, not as "100% below 90"', () => {
      const fn = loadFunction('coverageWarningText');
      const text = fn({
        coverage: { ratio: 1, percentage: 100 },
        threshold_percentage: 90,
        ratio_below_threshold: false,
        has_review_failures: true,
        below_threshold: true,
        counts: { preview: 2, covered: 2, read_failures: 1 },
        read_failure_files: ['outside-preview.ts'],
      });
      expect(text).not.toMatch(/100%\s+is below the\s+90%/);
      expect(text.toLowerCase()).toContain('fail');
    });

    it('returns an empty string when coverage meets threshold and no review failures', () => {
      const fn = loadFunction('coverageWarningText');
      expect(
        fn({
          coverage: { ratio: 1, percentage: 100 },
          threshold_percentage: 90,
          ratio_below_threshold: false,
          has_review_failures: false,
          below_threshold: false,
          counts: { preview: 2, covered: 2, read_failures: 0 },
        }),
      ).toBe('');
    });

    it('does not list full file paths (bounded summary)', () => {
      const fn = loadFunction('coverageWarningText');
      const many = Array.from({ length: 500 }, (_, i) => `file${i}.ts`);
      const text = fn({
        coverage: { ratio: 0.5, percentage: 50 },
        threshold_percentage: 90,
        ratio_below_threshold: true,
        has_review_failures: false,
        below_threshold: true,
        counts: { preview: 500, covered: 250, read_failures: 0 },
        preview_only_files: many,
      });
      expect(text).not.toContain('file0.ts');
      expect(text).not.toContain('file499.ts');
    });
  });

  describe('serializeCoverageReport behavior (redaction)', () => {
    function loadSerializer(token = '', url = '') {
      return loadFunctionsTogether(
        ['escapeRegExp', 'redactSecretDiagnostics', 'serializeCoverageReport'],
        {
          REDACTION: '[REDACTED]',
          ocrTokenForRedaction: token,
          ocrUrlForRedaction: url,
        },
      ).serializeCoverageReport;
    }

    it('produces valid JSON that round-trips', () => {
      const serialize = loadSerializer();
      const report = { schema_version: '1.0.0', counts: { preview: 1 } };
      expect(JSON.parse(serialize(report))).toEqual(report);
    });

    it('redacts a secret token that appears in the report', () => {
      const secret = 'super-secret-token-1234567890';
      const serialize = loadSerializer(secret);
      const result = serialize({ preview_files: [`path-${secret}`] });
      expect(result).not.toContain(secret);
      expect(result).toContain('[REDACTED]');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('emits valid JSON when redaction throws (fallback)', () => {
      const sandbox = { ...SANDBOX_GLOBALS };
      vm.createContext(sandbox);
      const src = extractFunctionSource(
        ctx.postScript,
        'serializeCoverageReport',
      );
      sandbox.redactSecretDiagnostics = () => {
        throw new Error('redact boom');
      };
      vm.runInContext(src, sandbox, { timeout: VM_TIMEOUT_MS });
      const result = sandbox.serializeCoverageReport({ a: 1 });
      expect(() => JSON.parse(result)).not.toThrow();
      expect(JSON.parse(result)).toEqual({ a: 1 });
    });

    it('emits the serialization error report for circular input', () => {
      const serialize = loadSerializer();
      const circular = { self: null };
      circular.self = circular;
      const result = serialize(circular);
      expect(JSON.parse(result)).toEqual({
        error: 'coverage report serialization failed',
      });
    });
  });

  describe('preview parser (real OCR 1.7.16 preview output)', () => {
    const REAL_PREVIEW = [
      'OpenCodeReview 1.7.16 preview',
      '',
      'Will review (3):',
      '[M]  .github/workflows/ocr-review.yml          +399  -46',
      '[A]  src/new feature.ts          +10  -0',
      '[M]  .github/workflows/ocr-review.yml          +399  -46',
      '',
      'Excluded from review (2):',
      '[D]  scripts/old script.cjs          -5  -20',
      '[E]  vendor/ignored.ts          +2  -0',
      '',
      'Files reviewed: 3, Files excluded: 2',
    ].join('\n');

    function extractPreviewPipeline(runText) {
      const awkStart = runText.indexOf('reviewed="$(awk');
      expect(
        awkStart,
        'preview step should define reviewed= awk assignment',
      ).toBeGreaterThanOrEqual(0);
      const awkEnd = runText.indexOf('|| true)"', awkStart);
      expect(
        awkEnd,
        'awk assignment should close with || true)"',
      ).toBeGreaterThanOrEqual(0);
      const awkAssign = runText.slice(awkStart, awkEnd + '|| true)"'.length);
      const printfStart = runText.indexOf(
        'printf \'%s\\n\' "$reviewed"',
        awkEnd,
      );
      expect(
        printfStart,
        'preview step should pipe reviewed through printf|sed',
      ).toBeGreaterThanOrEqual(0);
      const printfEnd = runText.indexOf(
        '> ocr-selected-files.txt || true',
        printfStart,
      );
      expect(
        printfEnd,
        'printf pipeline should write ocr-selected-files.txt',
      ).toBeGreaterThanOrEqual(0);
      const printfPipeline = runText.slice(
        printfStart,
        printfEnd + '> ocr-selected-files.txt || true'.length,
      );
      return ['set -euo pipefail', awkAssign, printfPipeline, ''].join('\n');
    }

    function extractExcludedPipeline(runText) {
      const awkStart = runText.indexOf('excluded="$(awk');
      expect(
        awkStart,
        'preview step should define excluded= awk assignment',
      ).toBeGreaterThanOrEqual(0);
      const closingNeedle = '\' ocr-preview.txt || true)"';
      const awkEnd = runText.indexOf(closingNeedle, awkStart);
      expect(
        awkEnd,
        'excluded awk assignment should close with ocr-preview.txt || true)"',
      ).toBeGreaterThanOrEqual(0);
      return runText.slice(awkStart, awkEnd + closingNeedle.length);
    }

    function runPreviewParser(previewContent) {
      const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-preview-'));
      try {
        const previewStep = stepNamed(
          ctx.codeReviewJob,
          'Verify review scope includes changed tests',
        );
        const pipeline = extractPreviewPipeline(commandText(previewStep));
        fs.writeFileSync(path.join(sub, 'ocr-preview.txt'), previewContent);
        fs.rmSync(path.join(sub, 'ocr-selected-files.txt'), { force: true });
        execFileSync('bash', ['-c', pipeline], {
          cwd: sub,
          encoding: 'utf8',
        });
        return fs.readFileSync(
          path.join(sub, 'ocr-selected-files.txt'),
          'utf8',
        );
      } finally {
        fs.rmSync(sub, { recursive: true, force: true });
      }
    }

    it('persists exact normalized file paths without trailing +N/-N stats', () => {
      const output = runPreviewParser(REAL_PREVIEW);
      const files = output.split('\n').filter((l) => l.length > 0);
      expect(files).toEqual([
        '.github/workflows/ocr-review.yml',
        'src/new feature.ts',
      ]);
    });

    it('deduplicates repeated preview rows', () => {
      const output = runPreviewParser(REAL_PREVIEW);
      const files = output.split('\n').filter((l) => l.length > 0);
      const dedup = [...new Set(files)];
      expect(files).toEqual(dedup);
    });

    it('preserves spaces in file paths', () => {
      const output = runPreviewParser(REAL_PREVIEW);
      const files = output.split('\n').filter((l) => l.length > 0);
      expect(files).toContain('src/new feature.ts');
    });

    it('excludes deleted files from the Will review set (true 1.7.16 layout)', () => {
      const output = runPreviewParser(REAL_PREVIEW);
      const files = output.split('\n').filter((l) => l.length > 0);
      expect(files).not.toContain('scripts/old script.cjs');
    });

    it('recognizes the Excluded from review (N): heading in the excluded parser', () => {
      const previewStep = stepNamed(
        ctx.codeReviewJob,
        'Verify review scope includes changed tests',
      );
      const previewRun = commandText(previewStep);
      // The excluded awk must match "Excluded from review (" (true 1.7.16
      // layout), not just "Excluded (". The regex uses POSIX [[:space:]]+
      // (double brackets) for whitespace between the words.
      expect(previewRun).toContain('^Excluded[[');
      expect(previewRun).toContain('[[:space:]]+from[[:space:]]+review');
    });

    it('parses excluded files from the Excluded from review section', () => {
      const previewStep = stepNamed(
        ctx.codeReviewJob,
        'Verify review scope includes changed tests',
      );
      const previewRun = commandText(previewStep);
      const excludedAssign = extractExcludedPipeline(previewRun);
      // The excluded awk must match "Excluded from review (" using POSIX
      // [[:space:]]+ (double brackets) between words (true 1.7.16 layout).
      expect(excludedAssign).toContain('^Excluded[[');
      expect(excludedAssign).toContain('[[:space:]]+from[[:space:]]+review');
    });
  });
});
