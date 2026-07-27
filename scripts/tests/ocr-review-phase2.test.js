/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

// Security note: The vm.runInContext calls in this suite execute JavaScript
// extracted from the trusted, version-controlled ocr-review.yml workflow via
// extractFunctionSource. This is trusted repository content (not user/PR input)
// and the workflow helper is read from the checked-out HEAD.

/**
 * Names of the helper functions that must exist in the post step before
 * extraction. Asserting these up front gives a precise error pointing at the
 * missing function rather than a buried stack trace inside the VM loader.
 */
const REQUIRED_FUNCTION_NAMES = [
  'severityRank',
  'sortInlineComments',
  'findingFingerprint',
  'effectiveCategory',
  'effectiveSeverity',
];

describe('.github/workflows/ocr-review.yml — Phase 2 inline comment sorting, capping, and fingerprints (#2649)', () => {
  let workflow;
  let codeReviewJob;
  let postStep;
  let postScript;

  beforeAll(() => {
    const workflowYml = readRootFile(WORKFLOW_PATH);
    workflow = yaml.load(workflowYml);
    if (!workflow || typeof workflow !== 'object') {
      throw new Error(`${WORKFLOW_PATH} did not parse to a YAML mapping`);
    }
    codeReviewJob = workflow.jobs?.['code-review'];
    expect(
      codeReviewJob,
      'workflow should contain job: code-review',
    ).toBeTruthy();
    postStep = stepNamed(codeReviewJob, 'Post OCR results');
    postScript = commandText(postStep);
  });

  function assertFunctionsPresent(script) {
    for (const name of REQUIRED_FUNCTION_NAMES) {
      expect(
        script.includes(`function ${name}(`),
        `post step should define function ${name}`,
      ).toBe(true);
    }
  }

  /**
   * Extract the severity rank function and load it into a VM sandbox.
   */
  let cachedSeverityRank = null;
  let cachedSortInlineComments = null;
  let cachedFindingFingerprint = null;

  function loadFunctions() {
    if (
      cachedSeverityRank &&
      cachedSortInlineComments &&
      cachedFindingFingerprint
    ) {
      return {
        severityRank: cachedSeverityRank,
        sortInlineComments: cachedSortInlineComments,
        findingFingerprint: cachedFindingFingerprint,
      };
    }
    assertFunctionsPresent(postScript);
    const severityRankSrc = extractFunctionSource(postScript, 'severityRank');
    const sortSrc = extractFunctionSource(postScript, 'sortInlineComments');
    const fpSrc = extractFunctionSource(postScript, 'findingFingerprint');

    const sandbox = {
      String,
      Number,
      Math,
      Array,
    };
    vm.createContext(sandbox);
    // sortInlineComments calls severityRank internally, so both must be in
    // the same sandbox. findingFingerprint uses effectiveCategory and
    // effectiveSeverity which must also be loaded.
    const effectiveCategorySrc = extractFunctionSource(
      postScript,
      'effectiveCategory',
    );
    const effectiveSeveritySrc = extractFunctionSource(
      postScript,
      'effectiveSeverity',
    );
    vm.runInContext(
      [
        effectiveCategorySrc,
        effectiveSeveritySrc,
        severityRankSrc,
        sortSrc,
        fpSrc,
        '__EXPOSED__ = { severityRank, sortInlineComments, findingFingerprint };',
      ].join('\n'),
      sandbox,
    );
    cachedSeverityRank = sandbox.__EXPOSED__.severityRank;
    cachedSortInlineComments = sandbox.__EXPOSED__.sortInlineComments;
    cachedFindingFingerprint = sandbox.__EXPOSED__.findingFingerprint;
    if (
      !cachedSeverityRank ||
      !cachedSortInlineComments ||
      !cachedFindingFingerprint
    ) {
      throw new Error(
        'Failed to extract expected functions from workflow postScript. ' +
          'Check that severityRank, sortInlineComments, and findingFingerprint ' +
          'are defined in the workflow YAML.',
      );
    }
    return {
      severityRank: cachedSeverityRank,
      sortInlineComments: cachedSortInlineComments,
      findingFingerprint: cachedFindingFingerprint,
    };
  }

  // -------------------------------------------------------------------------
  // severityRank behavioral tests
  // -------------------------------------------------------------------------
  describe('severityRank behavior', () => {
    it('ranks critical as 0 (highest priority)', () => {
      const { severityRank } = loadFunctions();
      expect(severityRank('critical')).toBe(0);
    });

    it('ranks high as 1', () => {
      const { severityRank } = loadFunctions();
      expect(severityRank('high')).toBe(1);
    });

    it('ranks medium as 2', () => {
      const { severityRank } = loadFunctions();
      expect(severityRank('medium')).toBe(2);
    });

    it('ranks unknown as 3 (above low — fail-safe)', () => {
      const { severityRank } = loadFunctions();
      expect(severityRank('unknown')).toBe(3);
    });

    it('ranks low as 4', () => {
      const { severityRank } = loadFunctions();
      expect(severityRank('low')).toBe(4);
    });

    it('ranks info as 5 (lowest priority)', () => {
      const { severityRank } = loadFunctions();
      expect(severityRank('info')).toBe(5);
    });

    it('ranks undefined as 3 (fail-safe above low)', () => {
      const { severityRank } = loadFunctions();
      expect(severityRank(undefined)).toBe(3);
    });

    it('ranks any other undocumented string as 3 (fail-safe above low)', () => {
      const { severityRank } = loadFunctions();
      expect(severityRank('garbage')).toBe(3);
      expect(severityRank('')).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // sortInlineComments behavioral tests
  // -------------------------------------------------------------------------
  describe('sortInlineComments behavior', () => {
    it('sorts { comment, finding } pairs by severity priority (high first)', () => {
      const { sortInlineComments } = loadFunctions();
      const pairs = [
        { comment: { path: 'a.ts', line: 5, _severity: 'low' }, finding: {} },
        { comment: { path: 'a.ts', line: 10, _severity: 'high' }, finding: {} },
        {
          comment: { path: 'a.ts', line: 3, _severity: 'medium' },
          finding: {},
        },
      ];
      const sorted = sortInlineComments(pairs);
      expect(sorted[0].comment._severity).toBe('high');
      expect(sorted[1].comment._severity).toBe('medium');
      expect(sorted[2].comment._severity).toBe('low');
    });

    it('breaks severity ties by path (lexicographic)', () => {
      const { sortInlineComments } = loadFunctions();
      const pairs = [
        { comment: { path: 'z.ts', line: 1, _severity: 'high' }, finding: {} },
        { comment: { path: 'a.ts', line: 1, _severity: 'high' }, finding: {} },
        { comment: { path: 'm.ts', line: 1, _severity: 'high' }, finding: {} },
      ];
      const sorted = sortInlineComments(pairs);
      expect(sorted[0].comment.path).toBe('a.ts');
      expect(sorted[1].comment.path).toBe('m.ts');
      expect(sorted[2].comment.path).toBe('z.ts');
    });

    it('breaks path ties by start_line (ascending)', () => {
      const { sortInlineComments } = loadFunctions();
      const pairs = [
        {
          comment: {
            path: 'a.ts',
            start_line: 30,
            line: 35,
            _severity: 'high',
          },
          finding: {},
        },
        {
          comment: {
            path: 'a.ts',
            start_line: 10,
            line: 15,
            _severity: 'high',
          },
          finding: {},
        },
        {
          comment: {
            path: 'a.ts',
            start_line: 20,
            line: 25,
            _severity: 'high',
          },
          finding: {},
        },
      ];
      const sorted = sortInlineComments(pairs);
      expect(sorted[0].comment.start_line).toBe(10);
      expect(sorted[1].comment.start_line).toBe(20);
      expect(sorted[2].comment.start_line).toBe(30);
    });

    it('breaks start_line ties by end line (ascending)', () => {
      const { sortInlineComments } = loadFunctions();
      const pairs = [
        {
          comment: {
            path: 'a.ts',
            start_line: 10,
            line: 20,
            _severity: 'high',
          },
          finding: {},
        },
        {
          comment: {
            path: 'a.ts',
            start_line: 10,
            line: 15,
            _severity: 'high',
          },
          finding: {},
        },
      ];
      const sorted = sortInlineComments(pairs);
      expect(sorted[0].comment.line).toBe(15);
      expect(sorted[1].comment.line).toBe(20);
    });

    it('handles missing _severity as unknown (rank 3)', () => {
      const { sortInlineComments } = loadFunctions();
      const pairs = [
        { comment: { path: 'a.ts', line: 1 }, finding: {} }, // no _severity
        { comment: { path: 'b.ts', line: 1, _severity: 'high' }, finding: {} },
      ];
      const sorted = sortInlineComments(pairs);
      expect(sorted[0].comment._severity).toBe('high');
      expect(sorted[1].comment._severity).toBeUndefined();
    });

    it('ranks critical above high', () => {
      const { sortInlineComments } = loadFunctions();
      const pairs = [
        { comment: { path: 'a.ts', line: 1, _severity: 'high' }, finding: {} },
        {
          comment: { path: 'a.ts', line: 2, _severity: 'critical' },
          finding: {},
        },
      ];
      const sorted = sortInlineComments(pairs);
      expect(sorted[0].comment._severity).toBe('critical');
      expect(sorted[1].comment._severity).toBe('high');
    });

    it('does not mutate the input array (returns new array)', () => {
      const { sortInlineComments } = loadFunctions();
      const original = [
        { comment: { path: 'z.ts', line: 1, _severity: 'low' }, finding: {} },
        { comment: { path: 'a.ts', line: 1, _severity: 'high' }, finding: {} },
      ];
      const snapshot = [...original];
      const result = sortInlineComments(original);
      // Returns a distinct array instance
      expect(result).not.toBe(original);
      // Original array order preserved
      expect(original[0].comment.path).toBe(snapshot[0].comment.path);
      expect(original[1].comment.path).toBe(snapshot[1].comment.path);
    });

    it('returns empty array for empty input', () => {
      const { sortInlineComments } = loadFunctions();
      const sorted = sortInlineComments([]);
      expect(sorted).toEqual([]);
    });

    it('handles single-element array', () => {
      const { sortInlineComments } = loadFunctions();
      const sorted = sortInlineComments([
        { comment: { path: 'a.ts', line: 1, _severity: 'high' }, finding: {} },
      ]);
      expect(sorted).toHaveLength(1);
      expect(sorted[0].comment.path).toBe('a.ts');
    });

    it('produces deterministic order for same inputs across calls', () => {
      const { sortInlineComments } = loadFunctions();
      const pairs = [
        {
          comment: { path: 'z.ts', line: 5, _severity: 'medium' },
          finding: {},
        },
        { comment: { path: 'a.ts', line: 10, _severity: 'high' }, finding: {} },
        { comment: { path: 'm.ts', line: 3, _severity: 'low' }, finding: {} },
        { comment: { path: 'a.ts', line: 1, _severity: 'high' }, finding: {} },
      ];
      const first = sortInlineComments(pairs);
      const second = sortInlineComments(pairs);
      expect(first).toEqual(second);
    });
  });

  // -------------------------------------------------------------------------
  // findingFingerprint behavioral tests
  // -------------------------------------------------------------------------
  describe('findingFingerprint behavior', () => {
    it('produces a stable fingerprint for the same finding', () => {
      const { findingFingerprint } = loadFunctions();
      const f = {
        path: 'src/foo.ts',
        start_line: 10,
        end_line: 15,
        category: 'bug',
        severity: 'high',
        content: 'This is a bug',
      };
      const a = findingFingerprint(f, 'run1', 0);
      const b = findingFingerprint({ ...f }, 'run1', 0);
      expect(a).toBe(b);
    });

    it('produces a fingerprint prefixed with ocr- and run-scoped identifier', () => {
      const { findingFingerprint } = loadFunctions();
      const f = {
        path: 'src/foo.ts',
        start_line: 10,
        end_line: 15,
        category: 'bug',
        severity: 'high',
        content: 'x',
      };
      const fp = findingFingerprint(f, 'run42', 3);
      expect(fp.startsWith('ocr-run42-3-')).toBe(true);
      // The fingerprint must contain an 8-character hex hash.
      const parts = fp.split('-');
      expect(parts.length).toBe(4);
      expect(parts[3]).toMatch(/^[0-9a-f]{8}$/);
    });

    it('does NOT embed raw file paths in the fingerprint marker', () => {
      const { findingFingerprint } = loadFunctions();
      const f = {
        path: 'src/secret/path/foo.ts',
        start_line: 10,
        end_line: 15,
        category: 'bug',
        severity: 'high',
        content: 'x',
      };
      const fp = findingFingerprint(f, 'run1', 0);
      // The raw path must never appear in the fingerprint string (only the
      // hex hash is embedded) to prevent HTML-comment termination attacks.
      expect(fp).not.toContain('src/secret/path/foo.ts');
      expect(fp).not.toContain('foo.ts');
    });

    it('produces different fingerprints for different content', () => {
      const { findingFingerprint } = loadFunctions();
      const a = findingFingerprint(
        {
          path: 'a.ts',
          start_line: 1,
          end_line: 1,
          category: 'bug',
          severity: 'high',
          content: 'bug one',
        },
        'run1',
        0,
      );
      const b = findingFingerprint(
        {
          path: 'a.ts',
          start_line: 1,
          end_line: 1,
          category: 'bug',
          severity: 'high',
          content: 'bug two',
        },
        'run1',
        0,
      );
      expect(a).not.toBe(b);
    });

    it('produces different fingerprints for different line numbers', () => {
      const { findingFingerprint } = loadFunctions();
      const a = findingFingerprint(
        {
          path: 'a.ts',
          start_line: 5,
          end_line: 10,
          category: 'bug',
          severity: 'high',
          content: 'same',
        },
        'run1',
        0,
      );
      const b = findingFingerprint(
        {
          path: 'a.ts',
          start_line: 50,
          end_line: 60,
          category: 'bug',
          severity: 'high',
          content: 'same',
        },
        'run1',
        0,
      );
      expect(a).not.toBe(b);
    });

    it('normalizes reversed line ranges (lo/hi) for stable fingerprints', () => {
      const { findingFingerprint } = loadFunctions();
      const a = findingFingerprint(
        {
          path: 'a.ts',
          start_line: 10,
          end_line: 1,
          category: 'bug',
          severity: 'high',
          content: 'x',
        },
        'run1',
        0,
      );
      const b = findingFingerprint(
        {
          path: 'a.ts',
          start_line: 1,
          end_line: 10,
          category: 'bug',
          severity: 'high',
          content: 'x',
        },
        'run1',
        0,
      );
      // Reversed ranges should produce identical fingerprints because the
      // hash input uses normalized lo/hi.
      expect(a).toBe(b);
    });

    it('produces different fingerprints for different run IDs', () => {
      const { findingFingerprint } = loadFunctions();
      const f = {
        path: 'a.ts',
        start_line: 1,
        end_line: 1,
        category: 'bug',
        severity: 'high',
        content: 'x',
      };
      const a = findingFingerprint(f, 'run1', 0);
      const b = findingFingerprint({ ...f }, 'run2', 0);
      expect(a).not.toBe(b);
    });

    it('produces different fingerprints for different indices', () => {
      const { findingFingerprint } = loadFunctions();
      const f = {
        path: 'a.ts',
        start_line: 1,
        end_line: 1,
        category: 'bug',
        severity: 'high',
        content: 'x',
      };
      const a = findingFingerprint(f, 'run1', 0);
      const b = findingFingerprint({ ...f }, 'run1', 1);
      expect(a).not.toBe(b);
    });

    it('uses originalCategory/originalSeverity when category/severity are normalized', () => {
      const { findingFingerprint } = loadFunctions();
      // validateFindingMetadata normalizes 'correctness' to 'unknown' but
      // preserves originalCategory. effectiveCategory reads originalCategory.
      const f = {
        path: 'a.ts',
        start_line: 1,
        end_line: 1,
        category: 'unknown',
        originalCategory: 'correctness',
        severity: 'unknown',
        originalSeverity: 'info',
        content: 'x',
      };
      const fp = findingFingerprint(f, 'run1', 0);
      expect(fp.startsWith('ocr-run1-0-')).toBe(true);
      // The fingerprint should be deterministic
      const fp2 = findingFingerprint({ ...f }, 'run1', 0);
      expect(fp).toBe(fp2);
    });

    it('handles missing fields gracefully without crashing', () => {
      const { findingFingerprint } = loadFunctions();
      const fp = findingFingerprint({}, 'run1', 0);
      expect(fp.startsWith('ocr-run1-0-')).toBe(true);
    });

    it('handles null finding without crashing', () => {
      const { findingFingerprint } = loadFunctions();
      const fp = findingFingerprint(null, 'run1', 0);
      expect(fp.startsWith('ocr-run1-0-')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // YAML wiring tests
  // -------------------------------------------------------------------------
  describe('YAML wiring for Phase 2', () => {
    it('defines INLINE_COMMENT_CAP env var for the post step', () => {
      expect(postStep.env?.OCR_INLINE_COMMENT_CAP).toBe(
        '${{ vars.OCR_INLINE_COMMENT_CAP }}',
      );
    });

    it('embeds finding fingerprints in inline comment bodies', () => {
      expect(postScript).toContain('<!-- ocr-fp:');
      expect(postScript).toContain('findingFingerprint(');
    });

    it('sorts inline comments before posting', () => {
      expect(postScript).toContain('sortInlineComments(');
    });

    it('applies a proactive inline comment cap with overflow to summary', () => {
      expect(postScript).toContain('INLINE_COMMENT_CAP');
      expect(postScript).toContain('OCR_INLINE_COMMENT_CAP');
      expect(postScript).toContain('overflowRouted.push(');
    });

    it('does not re-cap in the fallback loop (pairsToPost is already capped)', () => {
      // The fallback loop iterates over pairsToPost, which was already
      // sliced to effectiveCap before posting. There is no separate
      // MAX_INLINE_FALLBACK cap — the batch/fallback paths share the same
      // pre-sliced candidate set.
      expect(postScript).not.toContain('MAX_INLINE_FALLBACK');
    });

    it('attaches _severity to inline comments for sorting', () => {
      expect(postScript).toContain('_severity: effectiveSeverity(f)');
    });

    it('preserves overflow findings with structured metadata in overflowRouted', () => {
      // Phase 2 remediation: overflow must push original finding objects to
      // overflowRouted (not synthetic stripped-metadata objects to lineless)
      // so category/severity/path metadata is retained in the summary.
      expect(postScript).toContain('overflowRouted.push(pair.finding)');
    });

    it('has a dedicated overflow section in the sticky summary', () => {
      expect(postScript).toContain(
        '### Inline overflow (exceeds inline comment cap)',
      );
    });
  });
});
