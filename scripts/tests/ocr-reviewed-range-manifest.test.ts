/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  asRecord,
  asRecordArray,
  asString,
  asStringArray,
  asVmFunction,
} from './typed-test-helpers.ts';
import {
  BASE_MANIFEST_PARAMS,
  makeLoadFunction,
  makeLoadFunctionsTogether,
  useWorkflowFixture,
} from './ocr-manifest-test-helpers.ts';

function sandboxFn(
  sandbox: Record<string, unknown>,
  name: string,
): (...args: unknown[]) => Record<string, unknown> {
  const fn = sandbox[name];
  if (typeof fn !== 'function') {
    throw new Error(`${name} is not a function in sandbox`);
  }
  return (...args: unknown[]) => asRecord(fn(...args));
}

function sandboxFnUnknown(
  sandbox: Record<string, unknown>,
  name: string,
): (...args: unknown[]) => unknown {
  const fn = sandbox[name];
  if (typeof fn !== 'function') {
    throw new Error(`${name} is not a function in sandbox`);
  }
  return (...args: unknown[]) => fn(...args);
}

describe('.github/workflows/ocr-review.yml — reviewed-range manifest functions (issue #2575)', () => {
  const ctx = useWorkflowFixture();
  const loadFunction = makeLoadFunction(ctx);
  const loadFunctionsTogether = makeLoadFunctionsTogether(ctx);

  // -----------------------------------------------------------------------
  // resolveCompleteness — core behavior (count-free, file-array based)
  // -----------------------------------------------------------------------
  describe('resolveCompleteness behavior', () => {
    it('returns "complete" when completedFiles equals selectedFiles', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
          completedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('complete');
    });

    it('returns "partial" when some files failed and were not waived', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: [
            'f0',
            'f1',
            'f2',
            'f3',
            'f4',
            'f5',
            'f6',
            'f7',
            'f8',
            'f9',
          ],
          completedFiles: ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
          failedFiles: ['f7', 'f8', 'f9'],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('returns "failed" when OCR exited non-zero', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 1,
          ocrStatus: '',
          selectedFiles: Array.from({ length: 10 }, (_, i) => `f${i}`),
          completedFiles: [],
          failedFiles: Array.from({ length: 10 }, (_, i) => `f${i}`),
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('failed');
    });

    it('returns "skipped" when skipped flag is true', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: '',
          selectedFiles: [],
          completedFiles: [],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: true,
        }),
      ).toBe('skipped');
    });

    it('maps completed_with_errors OCR status to "partial" (AC #6)', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'completed_with_errors',
          selectedFiles: Array.from({ length: 90 }, (_, i) => `f${i}`),
          completedFiles: Array.from({ length: 74 }, (_, i) => `f${i}`),
          failedFiles: Array.from({ length: 16 }, (_, i) => `f${74 + i}`),
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('returns "complete" when failed files are all explicitly waived with reasons', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
          completedFiles: ['a.ts', 'b.ts', 'c.ts'],
          failedFiles: ['d.ts', 'e.ts'],
          reusedFiles: [],
          waivedFiles: [
            { path: 'd.ts', reason: 'generated file' },
            { path: 'e.ts', reason: 'vendor file' },
          ],
          skipped: false,
        }),
      ).toBe('complete');
    });

    it('returns "complete" when selectedFiles is empty (success status)', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: [],
          completedFiles: [],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('complete');
    });

    it('skipped takes precedence over non-zero exit code', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 1,
          ocrStatus: '',
          selectedFiles: [],
          completedFiles: [],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: true,
        }),
      ).toBe('skipped');
    });

    it('non-zero exit code takes precedence over completed_with_errors status', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 1,
          ocrStatus: 'completed_with_errors',
          selectedFiles: Array.from({ length: 10 }, (_, i) => `f${i}`),
          completedFiles: Array.from({ length: 5 }, (_, i) => `f${i}`),
          failedFiles: Array.from({ length: 5 }, (_, i) => `f${5 + i}`),
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('failed');
    });

    it('recognizes "completed" as a valid success status', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'completed',
          selectedFiles: ['a.ts', 'b.ts'],
          completedFiles: ['a.ts', 'b.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('complete');
    });
  });

  // -----------------------------------------------------------------------
  // resolveCompleteness — fail-closed (C1)
  // -----------------------------------------------------------------------
  describe('resolveCompleteness fail-closed (C1)', () => {
    it('returns "partial" for unknown/empty OCR status with exit 0, even when counts match', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: '',
          selectedFiles: ['a.ts', 'b.ts'],
          completedFiles: ['a.ts', 'b.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('returns "partial" for null OCR status with exit 0', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: null,
          selectedFiles: ['a.ts'],
          completedFiles: ['a.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('returns "partial" for unrecognized OCR status with exit 0', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'who_knows',
          selectedFiles: ['a.ts'],
          completedFiles: ['a.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('returns "failed" when exitCode is NaN/undefined', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: undefined,
          ocrStatus: 'success',
          selectedFiles: ['a.ts'],
          completedFiles: ['a.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('failed');
    });

    it('returns "failed" when exitCode is a non-numeric string', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 'abc',
          ocrStatus: 'success',
          selectedFiles: ['a.ts'],
          completedFiles: ['a.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('failed');
    });

    it('returns "failed" when exitCode is negative', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: -1,
          ocrStatus: 'success',
          selectedFiles: ['a.ts'],
          completedFiles: ['a.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('failed');
    });

    it('returns "failed" when exitCode is a float', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0.5,
          ocrStatus: 'success',
          selectedFiles: ['a.ts'],
          completedFiles: ['a.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('failed');
    });
  });

  // -----------------------------------------------------------------------
  // resolveCompleteness — set-based completeness (C3)
  // -----------------------------------------------------------------------
  describe('resolveCompleteness set-based completeness (C3)', () => {
    it('an unrelated waiver does NOT satisfy a failure', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts'],
          completedFiles: ['a.ts'],
          failedFiles: ['b.ts'],
          reusedFiles: [],
          waivedFiles: [{ path: 'x.ts', reason: 'unrelated' }],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('a waiver whose path is not in the failed set does not count', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts', 'c.ts'],
          completedFiles: ['a.ts', 'c.ts'],
          failedFiles: ['b.ts'],
          reusedFiles: [],
          waivedFiles: [
            { path: 'c.ts', reason: 'should not waive a completed file' },
          ],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('duplicate entries do not inflate completeness', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts', 'a.ts', 'b.ts'],
          completedFiles: ['a.ts', 'b.ts', 'a.ts', 'b.ts', 'a.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('complete');
    });

    it('duplicate completed entries cannot mask a missing selected file', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts', 'c.ts'],
          completedFiles: ['a.ts', 'a.ts', 'a.ts', 'b.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('a file in both completed and failed is resolved (handled correctly)', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts'],
          completedFiles: ['a.ts', 'b.ts'],
          failedFiles: ['b.ts'],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('complete');
    });

    it('a completed file NOT in selected yields partial', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts'],
          completedFiles: ['a.ts', 'extra.ts'],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('reused files count toward resolution', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts'],
          completedFiles: ['a.ts'],
          failedFiles: [],
          reusedFiles: ['b.ts'],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('complete');
    });

    it('paths are trimmed before comparison', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['  a.ts  ', 'b.ts'],
          completedFiles: ['a.ts', ' b.ts '],
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('complete');
    });
  });

  // -----------------------------------------------------------------------
  // resolveCompleteness — waiver reason trimming (C10)
  // -----------------------------------------------------------------------
  describe('resolveCompleteness waiver reason trimming (C10)', () => {
    it('a whitespace-only reason does not count as a valid waiver', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts'],
          completedFiles: ['a.ts'],
          failedFiles: ['b.ts'],
          reusedFiles: [],
          waivedFiles: [{ path: 'b.ts', reason: '   ' }],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('a tab/newline-only reason does not count as a valid waiver', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts'],
          completedFiles: ['a.ts'],
          failedFiles: ['b.ts'],
          reusedFiles: [],
          waivedFiles: [{ path: 'b.ts', reason: '\t\n  ' }],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('a trimmed non-empty reason counts as a valid waiver', () => {
      const fn = loadFunction('resolveCompleteness');
      expect(
        fn({
          ocrExitCode: 0,
          ocrStatus: 'success',
          selectedFiles: ['a.ts', 'b.ts'],
          completedFiles: ['a.ts'],
          failedFiles: ['b.ts'],
          reusedFiles: [],
          waivedFiles: [{ path: 'b.ts', reason: '  generated file  ' }],
          skipped: false,
        }),
      ).toBe('complete');
    });
  });

  // -----------------------------------------------------------------------
  // computeCoverage
  // -----------------------------------------------------------------------
  describe('computeCoverage behavior', () => {
    it('returns completed and selected counts with a ratio string', () => {
      const fn = loadFunction('computeCoverage');
      const result = asRecord(fn({ completed: 8, selected: 10 }));
      expect(result['completed']).toBe(8);
      expect(result['selected']).toBe(10);
      expect(typeof result['ratio']).toBe('string');
    });

    it('computes ratio as a decimal fraction of completed/selected', () => {
      const fn = loadFunction('computeCoverage');
      const result = asRecord(fn({ completed: 5, selected: 10 }));
      expect(Number(result['ratio'])).toBe(0.5);
    });

    it('returns ratio 1 when selected is zero', () => {
      const fn = loadFunction('computeCoverage');
      const result = asRecord(fn({ completed: 0, selected: 0 }));
      expect(Number(result['ratio'])).toBe(1);
    });

    it('returns ratio 1 when all files completed', () => {
      const fn = loadFunction('computeCoverage');
      const result = asRecord(fn({ completed: 10, selected: 10 }));
      expect(Number(result['ratio'])).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // buildReviewedRangeManifest
  // -----------------------------------------------------------------------
  describe('buildReviewedRangeManifest behavior', () => {
    function buildManifest(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      const params = { ...BASE_MANIFEST_PARAMS, ...overrides };
      const sandbox = loadFunctionsTogether([
        'resolveCompleteness',
        'computeCoverage',
        'buildReviewedRangeManifest',
      ]);
      const fn = asVmFunction(sandbox['buildReviewedRangeManifest']);
      return asRecord(fn(params));
    }

    it('includes schema_version as a string', () => {
      const manifest = buildManifest();
      const schemaVersion = asString(manifest['schema_version']);
      expect(typeof schemaVersion).toBe('string');
      expect(schemaVersion.length).toBeGreaterThan(0);
    });

    it('persists repository, pr_number, head_sha, and merge_base_sha (AC #1)', () => {
      const manifest = buildManifest();
      expect(manifest.repository).toBe('acme/widget');
      expect(manifest.pr_number).toBe(42);
      expect(manifest.head_sha).toBe('abc123def456');
      expect(manifest.merge_base_sha).toBe('fed654cba321');
    });

    it('persists trigger, run_id, and run_attempt (AC #2)', () => {
      const manifest = buildManifest();
      expect(manifest.trigger).toBe('pull_request_target');
      expect(manifest.run_id).toBe('999888777');
      expect(manifest.run_attempt).toBe('1');
    });

    it('persists ocr_version, provider_model, and concurrency (AC #2)', () => {
      const manifest = buildManifest();
      expect(manifest.ocr_version).toBe('1.7.16');
      expect(manifest.provider_model).toBe('gpt-4o');
      expect(manifest.concurrency).toBe(2);
    });

    it('persists ocr_session_id and ocr_parent_session_id (AC #2)', () => {
      const manifest = buildManifest();
      expect(manifest.ocr_session_id).toBe('sess-abc');
      expect(manifest.ocr_parent_session_id).toBe('parent-sess-xyz');
    });

    it('persists rule_config_hash (AC #2)', () => {
      const manifest = buildManifest();
      expect(manifest.rule_config_hash).toBe('sha256:deadbeef');
    });

    it('records selected_files, completed_files, failed_files, reused_files, and waived_files (AC #3)', () => {
      const manifest = buildManifest({
        selectedFiles: ['a.ts', 'b.ts', 'c.ts'],
        completedFiles: ['a.ts'],
        failedFiles: ['b.ts'],
        reusedFiles: ['c.ts'],
        waivedFiles: [],
      });
      expect(manifest.selected_files).toEqual(['a.ts', 'b.ts', 'c.ts']);
      expect(manifest.completed_files).toEqual(['a.ts']);
      expect(manifest.failed_files).toEqual(['b.ts']);
      expect(manifest.reused_files).toEqual(['c.ts']);
      expect(manifest.waived_files).toEqual([]);
    });

    it('sets completeness to "complete" when all selected files completed (AC #4)', () => {
      const manifest = buildManifest();
      expect(manifest.completeness).toBe('complete');
    });

    it('sets completeness to "partial" when some files failed and not waived (AC #4)', () => {
      const manifest = buildManifest({
        selectedFiles: ['a.ts', 'b.ts', 'c.ts'],
        completedFiles: ['a.ts'],
        failedFiles: ['b.ts', 'c.ts'],
        waivedFiles: [],
      });
      expect(manifest.completeness).toBe('partial');
    });

    it('sets completeness to "failed" when OCR exited non-zero (AC #4)', () => {
      const manifest = buildManifest({
        ocrExitCode: 1,
        ocrStatus: '',
        completedFiles: [],
        failedFiles: ['a.ts', 'b.ts'],
      });
      expect(manifest.completeness).toBe('failed');
    });

    it('sets completeness to "skipped" when skipped is true (AC #4)', () => {
      const manifest = buildManifest({
        skipped: true,
        ocrStatus: '',
        completedFiles: [],
        selectedFiles: [],
      });
      expect(manifest.completeness).toBe('skipped');
    });

    it('maps completed_with_errors to "partial" completeness in manifest (AC #6)', () => {
      const manifest = buildManifest({
        ocrStatus: 'completed_with_errors',
        selectedFiles: ['a.ts', 'b.ts', 'c.ts'],
        completedFiles: ['a.ts'],
        failedFiles: ['b.ts', 'c.ts'],
      });
      expect(manifest.completeness).toBe('partial');
      expect(manifest.ocr_status).toBe('completed_with_errors');
    });

    it('records ocr_status in the manifest', () => {
      const manifest = buildManifest({ ocrStatus: 'success' });
      expect(manifest.ocr_status).toBe('success');
    });

    it('records artifact_hashes in the manifest (AC #8)', () => {
      const hashes = { 'ocr-result.json': 'sha256:abc' };
      const manifest = buildManifest({ artifactHashes: hashes });
      expect(manifest.artifact_hashes).toEqual(hashes);
    });

    it('waived files include a reason field (AC #6)', () => {
      const manifest = buildManifest({
        selectedFiles: ['a.ts', 'b.ts'],
        completedFiles: ['a.ts'],
        failedFiles: ['b.ts'],
        waivedFiles: [
          { path: 'b.ts', reason: 'generated file; no review needed' },
        ],
      });
      const waivedFiles = asRecordArray(manifest['waived_files']);
      expect(waivedFiles).toHaveLength(1);
      expect(waivedFiles[0]['path']).toBe('b.ts');
      expect(waivedFiles[0]['reason']).toBe('generated file; no review needed');
    });

    it('treats a waiver without a reason as invalid (does not count toward complete)', () => {
      const manifest = buildManifest({
        selectedFiles: ['a.ts', 'b.ts'],
        completedFiles: ['a.ts'],
        failedFiles: ['b.ts'],
        waivedFiles: [{ path: 'b.ts', reason: '' }],
      });
      expect(manifest.completeness).toBe('partial');
    });

    it('treats a whitespace-only waiver reason as invalid (C10)', () => {
      const manifest = buildManifest({
        selectedFiles: ['a.ts', 'b.ts'],
        completedFiles: ['a.ts'],
        failedFiles: ['b.ts'],
        waivedFiles: [{ path: 'b.ts', reason: '   ' }],
      });
      expect(manifest.completeness).toBe('partial');
    });

    it('does not mutate the input params object', () => {
      const params = { ...BASE_MANIFEST_PARAMS };
      const snapshot = JSON.parse(JSON.stringify(params));
      const sandbox = loadFunctionsTogether([
        'resolveCompleteness',
        'computeCoverage',
        'buildReviewedRangeManifest',
      ]);
      const fn = asVmFunction(sandbox['buildReviewedRangeManifest']);
      fn(params);
      expect(params).toEqual(snapshot);
    });
  });

  // -----------------------------------------------------------------------
  // Pipeline integration: resolveCompleteness + buildReviewedRangeManifest
  // -----------------------------------------------------------------------
  describe('manifest pipeline integration', () => {
    it('a completed_with_errors run produces a partial manifest that cannot be confused for complete', () => {
      const sandbox = loadFunctionsTogether([
        'resolveCompleteness',
        'computeCoverage',
        'buildReviewedRangeManifest',
        'buildStatusLine',
      ]);

      const manifest = sandboxFn(
        sandbox,
        'buildReviewedRangeManifest',
      )({
        ...BASE_MANIFEST_PARAMS,
        ocrStatus: 'completed_with_errors',
        selectedFiles: Array.from({ length: 90 }, (_, i) => `file${i}.ts`),
        completedFiles: Array.from({ length: 74 }, (_, i) => `file${i}.ts`),
        failedFiles: Array.from({ length: 16 }, (_, i) => `file${74 + i}.ts`),
      });

      expect(manifest['completeness']).toBe('partial');
      expect(manifest['ocr_status']).toBe('completed_with_errors');
      // C2: completed_with_errors must clear completedFiles since we cannot
      // trust per-file completion from the upstream tool.
      expect(manifest['completed_files']).toEqual([]);

      const completedFiles = asStringArray(manifest['completed_files']);
      const selectedFiles = asStringArray(manifest['selected_files']);
      const coverage = sandboxFn(
        sandbox,
        'computeCoverage',
      )({
        completed: completedFiles.length,
        selected: selectedFiles.length,
      });
      const statusLine = asString(
        sandboxFnUnknown(
          sandbox,
          'buildStatusLine',
        )({
          ran: true,
          findingsCount: 20,
          postedInline: 15,
          completeness: manifest.completeness,
          coverage,
          failedFiles: manifest.failed_files,
          policyFailure: '',
        }),
      );

      expect(statusLine).not.toBe('No findings.');
      expect(statusLine).toContain('Partial review');
      expect(statusLine).toContain('90');
      expect(statusLine).toContain('16 failed');
    });

    it('a full success produces a complete manifest with a clean status line', () => {
      const sandbox = loadFunctionsTogether([
        'resolveCompleteness',
        'computeCoverage',
        'buildReviewedRangeManifest',
        'buildStatusLine',
      ]);

      const manifest = sandboxFn(
        sandbox,
        'buildReviewedRangeManifest',
      )({
        ...BASE_MANIFEST_PARAMS,
        selectedFiles: ['a.ts', 'b.ts'],
        completedFiles: ['a.ts', 'b.ts'],
      });

      expect(manifest.completeness).toBe('complete');

      const statusLine = asString(
        sandboxFnUnknown(
          sandbox,
          'buildStatusLine',
        )({
          ran: true,
          findingsCount: 0,
          postedInline: 0,
          completeness: manifest.completeness,
          coverage: { completed: 2, selected: 2 },
          failedFiles: [],
          policyFailure: '',
        }),
      );

      expect(statusLine).toBe('No findings.');
    });

    it('a waiver with a reason allows completeness to be complete despite failures (AC #6)', () => {
      const sandbox = loadFunctionsTogether([
        'resolveCompleteness',
        'computeCoverage',
        'buildReviewedRangeManifest',
      ]);

      const manifest = sandboxFn(
        sandbox,
        'buildReviewedRangeManifest',
      )({
        ...BASE_MANIFEST_PARAMS,
        selectedFiles: ['a.ts', 'b.ts', 'c.ts'],
        completedFiles: ['a.ts'],
        failedFiles: ['b.ts', 'c.ts'],
        waivedFiles: [
          { path: 'b.ts', reason: 'auto-generated; skipped' },
          { path: 'c.ts', reason: 'vendor file; reviewed separately' },
        ],
      });

      expect(manifest.completeness).toBe('complete');
    });

    it('an unrelated waiver does not allow completeness to be complete (C3)', () => {
      const sandbox = loadFunctionsTogether([
        'resolveCompleteness',
        'computeCoverage',
        'buildReviewedRangeManifest',
      ]);

      const manifest = sandboxFn(
        sandbox,
        'buildReviewedRangeManifest',
      )({
        ...BASE_MANIFEST_PARAMS,
        selectedFiles: ['a.ts', 'b.ts'],
        completedFiles: ['a.ts'],
        failedFiles: ['b.ts'],
        waivedFiles: [{ path: 'unrelated.ts', reason: 'not relevant' }],
      });

      expect(manifest.completeness).toBe('partial');
    });
  });
});
