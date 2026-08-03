/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { describe, expect, it } from 'bun:test';
import { useWorkflowFixture } from './ocr-manifest-test-helpers.ts';
import {
  commandText,
  extractFunctionSource,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';
import { asStringArray, asVmFunction } from './typed-test-helpers.ts';

const REAL_PREVIEW = [
  'OpenCodeReview 1.7.16 preview',
  '',
  'Will review (2):',
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

// Real OCR 1.8.4 `ocr review --preview` output (issue #2929, captured in
// project-plans/issue2929/EVIDENCE.md and byte-identical to the 1.7.17 output
// for the same range). Reproduced verbatim after the ANSI strip the workflow
// applies before parsing, including the column padding OCR emits — the
// trailing run of spaces on each "Will review" row is real output, so the
// rows are written as explicit array entries rather than a template literal.
const REAL_1_8_4_PREVIEW = [
  '',
  'Preview: 18 file(s) changed  |  +5179  -193',
  '',
  'Will review (7):',
  '  [A]  .github/scripts/ocr-trusted-marker.cjs                    +159  -0   ',
  '  [M]  .github/workflows/ocr-review.yml                          +837  -127 ',
  '  [A]  scripts/re-embed-trusted-marker.cjs                       +228  -0   ',
  '  [M]  scripts/tests/ocr-review-workflow-helpers.ts              +115  -1   ',
  '  [A]  scripts/tests/ocr-trusted-marker-test-helpers.ts          +860  -0   ',
  '  [M]  scripts/tests/typed-test-helpers.ts                       +21   -0   ',
  '  [M]  tsconfig.scripts.json                                     +6    -0   ',
  '',
  'Excluded from review (11):',
  '  [A]  project-plans/issue2860/PLAN.md                           (unsupported_ext)',
  '  [A]  project-plans/issue2860/REVIEW-TRIAGE.md                  (unsupported_ext)',
  '  [M]  scripts/tests/ocr-auto-review-limit.test.ts               (default_path)',
  '  [A]  scripts/tests/ocr-heredoc-extraction.test.ts              (default_path)',
  '  [M]  scripts/tests/ocr-review-incremental-checkpoint-b.test.ts (default_path)',
  '  [M]  scripts/tests/ocr-review-workflow-behaviors.test.ts       (default_path)',
  '  [M]  scripts/tests/ocr-review-workflow-features.test.ts        (default_path)',
  '  [A]  scripts/tests/ocr-trusted-marker-workflow-b.test.ts       (default_path)',
  '  [A]  scripts/tests/ocr-trusted-marker-workflow.test.ts         (default_path)',
  '  [A]  scripts/tests/ocr-trusted-marker.test.ts                  (default_path)',
  '  [A]  scripts/tests/re-embed-trusted-marker.test.ts             (default_path)',
  '',
  '',
].join('\n');

function loadPreviewParser(
  codeReviewJob: Record<string, unknown>,
): (output: string) => string[] {
  const previewStep = stepNamed(
    codeReviewJob,
    'Verify review scope includes changed tests',
  );
  const stepSource = commandText(previewStep);
  // `previewSelectionFromOutput` delegates the provably-empty cardinality
  // invariant to `assertProvablyEmptySelection`, so both must be evaluated
  // into the sandbox for the parser to resolve its dependency.
  const guardSource = extractFunctionSource(
    stepSource,
    'assertProvablyEmptySelection',
  );
  const functionSource = extractFunctionSource(
    stepSource,
    'previewSelectionFromOutput',
  );
  const sandbox: Record<string, unknown> = {
    Error,
    Number,
    Object,
    Set,
    String,
  };
  vm.runInNewContext(guardSource, sandbox);
  vm.runInNewContext(functionSource, sandbox);
  const fn = asVmFunction(sandbox.previewSelectionFromOutput);
  return (output: string): string[] => asStringArray(fn(output));
}

describe('.github/workflows/ocr-review.yml — preview parser (real OCR 1.7.16 preview output)', () => {
  const ctx = useWorkflowFixture();

  function runPreviewParser(previewContent: string): string[] {
    return loadPreviewParser(ctx.codeReviewJob)(previewContent);
  }

  it('persists exact normalized file paths without trailing +N/-N stats', () => {
    expect(runPreviewParser(REAL_PREVIEW)).toEqual([
      '.github/workflows/ocr-review.yml',
      'src/new feature.ts',
    ]);
  });

  it('deduplicates repeated preview rows', () => {
    const files = runPreviewParser(REAL_PREVIEW);
    expect(files).toEqual([...new Set(files)]);
  });

  it('preserves spaces in file paths', () => {
    expect(runPreviewParser(REAL_PREVIEW)).toContain('src/new feature.ts');
  });

  it('excludes deleted files from the Will review set (true 1.7.16 layout)', () => {
    expect(runPreviewParser(REAL_PREVIEW)).not.toContain(
      'scripts/old script.cjs',
    );
  });

  it('fails closed when the declared count differs from unique paths', () => {
    expect(() =>
      runPreviewParser(
        REAL_PREVIEW.replace('Will review (2):', 'Will review (3):'),
      ),
    ).toThrow('declared 3 files but yielded 2 unique paths');
  });

  it('recognizes the OCR 1.7.16 and legacy excluded headings', () => {
    const previewStep = stepNamed(
      ctx.codeReviewJob,
      'Verify review scope includes changed tests',
    );
    const previewRun = commandText(previewStep);
    expect(previewRun).toContain(
      '^Excluded([[:space:]]+from[[:space:]]+review)?[[:space:]]*\\(',
    );
  });

  it('stops selected-path parsing at the Excluded from review section', () => {
    expect(runPreviewParser(REAL_PREVIEW)).not.toContain('vendor/ignored.ts');
  });
});

describe('.github/workflows/ocr-review.yml — preview parser (real OCR 1.8.4 preview output, issue #2929)', () => {
  const ctx = useWorkflowFixture();

  function runPreviewParser(previewContent: string): string[] {
    return loadPreviewParser(ctx.codeReviewJob)(previewContent);
  }

  it('yields exactly the 7 Will-review paths from real 1.8.4 output', () => {
    expect(runPreviewParser(REAL_1_8_4_PREVIEW)).toEqual([
      '.github/scripts/ocr-trusted-marker.cjs',
      '.github/workflows/ocr-review.yml',
      'scripts/re-embed-trusted-marker.cjs',
      'scripts/tests/ocr-review-workflow-helpers.ts',
      'scripts/tests/ocr-trusted-marker-test-helpers.ts',
      'scripts/tests/typed-test-helpers.ts',
      'tsconfig.scripts.json',
    ]);
  });

  it('excludes every entry under Excluded from review in 1.8.4 output', () => {
    const files = runPreviewParser(REAL_1_8_4_PREVIEW);
    const excluded = [
      'project-plans/issue2860/PLAN.md',
      'project-plans/issue2860/REVIEW-TRIAGE.md',
      'scripts/tests/ocr-auto-review-limit.test.ts',
      'scripts/tests/ocr-heredoc-extraction.test.ts',
      'scripts/tests/ocr-review-incremental-checkpoint-b.test.ts',
      'scripts/tests/ocr-review-workflow-behaviors.test.ts',
      'scripts/tests/ocr-review-workflow-features.test.ts',
      'scripts/tests/ocr-trusted-marker-workflow-b.test.ts',
      'scripts/tests/ocr-trusted-marker-workflow.test.ts',
      'scripts/tests/ocr-trusted-marker.test.ts',
      'scripts/tests/re-embed-trusted-marker.test.ts',
    ];
    for (const path of excluded) {
      if (files.includes(path)) throw new Error(`${path} must not be selected`);
    }
  });
});

describe('.github/workflows/ocr-review.yml — preview parser (docs-only PRs, issue #2824)', () => {
  const ctx = useWorkflowFixture();

  function runPreviewParser(previewContent: string): string[] {
    return loadPreviewParser(ctx.codeReviewJob)(previewContent);
  }

  // Real OCR 1.8.x `ocr review --preview` output from run 30725255161
  // (PR branch issue2685, 26 docs-only files, every path unsupported_ext).
  // After the workflow's ANSI strip. No `Will review (N):` section exists at
  // all. Reproduced verbatim including the leading blank line, two-space row
  // indent, and the column padding OCR emits.
  const DOCS_ONLY_26_PREVIEW = [
    '',
    'Preview: 26 file(s) changed  |  +4646  -5033',
    '',
    'Excluded from review (26):',
    '  [M]  dev-docs/agent-api.md                       (unsupported_ext)',
    '  [A]  dev-docs/core/memport-internals.md          (unsupported_ext)',
    '  [A]  dev-docs/debug-logging-internals.md         (unsupported_ext)',
    '  [A]  dev-docs/todo-system-internals.md           (unsupported_ext)',
    '  [A]  dev-docs/tools/mcp-internals.md             (unsupported_ext)',
    '  [A]  docs/agent-api.md                           (unsupported_ext)',
    '  [M]  docs/cli/index.md                           (unsupported_ext)',
    '  [M]  docs/cli/retry-settings.md                  (unsupported_ext)',
    '  [M]  docs/core/memport.md                        (unsupported_ext)',
    '  [M]  docs/debug-logging.md                       (unsupported_ext)',
    '  [M]  docs/deployment.md                          (unsupported_ext)',
    '  [M]  docs/hooks/api-reference.md                 (unsupported_ext)',
    '  [D]  docs/hooks/creating-custom-hooks.md         (unsupported_ext)',
    '  [M]  docs/hooks/index.md                         (unsupported_ext)',
    '  [M]  docs/hooks/writing-hooks.md                 (unsupported_ext)',
    '  [M]  docs/index.md                               (unsupported_ext)',
    '  [M]  docs/message-bus.md                         (unsupported_ext)',
    '  [M]  docs/migration/approval-mode-to-policies.md (unsupported_ext)',
    '  [M]  docs/multiline-input.md                     (unsupported_ext)',
    '  [M]  docs/policy-configuration.md                (unsupported_ext)',
    '  [A]  docs/providers/models-and-limits.md         (unsupported_ext)',
    '  [M]  docs/providers/quick-reference.md           (unsupported_ext)',
    '  [M]  docs/sandbox.md                             (unsupported_ext)',
    '  [M]  docs/todo-system.md                         (unsupported_ext)',
    '  [M]  docs/tools/mcp-server.md                    (unsupported_ext)',
    '  [A]  project-plans/20260801-issue2685/PLAN.md    (unsupported_ext)',
    '',
  ].join('\n');

  // Real OCR output from run 30554832360 (single docs file).
  const DOCS_ONLY_1_PREVIEW = [
    '',
    'Preview: 1 file(s) changed  |  +1  -1',
    '',
    'Excluded from review (1):',
    '  [M]  docs/hooks/writing-hooks.md (unsupported_ext)',
    '',
  ].join('\n');

  it('returns [] for the 26-file docs-only production preview (run 30725255161)', () => {
    expect(runPreviewParser(DOCS_ONLY_26_PREVIEW)).toEqual([]);
  });

  it('returns [] for the 1-file docs-only production preview (run 30554832360)', () => {
    expect(runPreviewParser(DOCS_ONLY_1_PREVIEW)).toEqual([]);
  });

  it('fails closed on an empty string', () => {
    expect(() => runPreviewParser('')).toThrow();
  });

  it('fails closed on a whitespace-only string', () => {
    expect(() => runPreviewParser('   \n\t\n  ')).toThrow();
  });

  it('fails closed on garbage stdout with neither a Preview banner nor an Excluded heading (no banner to truncate-test)', () => {
    expect(() =>
      runPreviewParser(
        ['some stderr noise', 'Error: connection reset', ''].join('\n'),
      ),
    ).toThrow();
  });

  // Regression coverage for issue #2824 review finding F1: a truncated preview
  // whose banner (always the first content line OCR emits) flushed but whose
  // "Will review"/"Excluded" sections were lost must be classified as an
  // infrastructure failure, never silently returned as an empty selection.
  it('fails closed when the Preview banner is present but every section was truncated away', () => {
    const bannerOnly = ['', 'Preview: 7 file(s) changed  |  +10  -2', ''].join(
      '\n',
    );
    expect(() => runPreviewParser(bannerOnly)).toThrow(
      'OCR preview output was malformed',
    );
  });

  it('fails closed when the Excluded count is less than the changed-file count (M < N)', () => {
    const partialExcluded = [
      '',
      'Preview: 7 file(s) changed  |  +10  -2',
      '',
      'Excluded from review (3):',
      '  [M]  docs/a.md          (unsupported_ext)',
      '  [M]  docs/b.md          (unsupported_ext)',
      '  [M]  docs/c.md          (unsupported_ext)',
      '',
    ].join('\n');
    expect(() => runPreviewParser(partialExcluded)).toThrow(
      'OCR preview output was malformed',
    );
  });

  it('returns [] for an empty diff (Preview: 0 file(s) changed) with no Excluded section', () => {
    const emptyDiff = ['', 'Preview: 0 file(s) changed  |  +0  -0', ''].join(
      '\n',
    );
    expect(runPreviewParser(emptyDiff)).toEqual([]);
  });

  it('fails closed when there are two Will review headings', () => {
    const twoHeadings = [
      '',
      'Preview: 2 file(s) changed  |  +10  -0',
      '',
      'Will review (1):',
      '  [M]  src/a.ts          +5  -0',
      'Will review (1):',
      '  [M]  src/b.ts          +5  -0',
      '',
    ].join('\n');
    expect(() => runPreviewParser(twoHeadings)).toThrow(
      'OCR preview must contain at most one Will review heading',
    );
  });

  it('is unaffected when a well-formed Will review section is present', () => {
    expect(runPreviewParser(REAL_1_8_4_PREVIEW)).toEqual([
      '.github/scripts/ocr-trusted-marker.cjs',
      '.github/workflows/ocr-review.yml',
      'scripts/re-embed-trusted-marker.cjs',
      'scripts/tests/ocr-review-workflow-helpers.ts',
      'scripts/tests/ocr-trusted-marker-test-helpers.ts',
      'scripts/tests/typed-test-helpers.ts',
      'tsconfig.scripts.json',
    ]);
  });

  // An explicit "Will review (0):" heading also yields an empty selection and
  // therefore skips the LLM entirely. It must satisfy the same M === N proof
  // as the omitted-heading case, otherwise a truncated render could skip
  // review of genuinely reviewable files.
  it('fails closed on "Will review (0)" when reviewable files were changed but not excluded', () => {
    const truncated = [
      '',
      'Preview: 40 file(s) changed  |  +900  -120',
      '',
      'Will review (0):',
      '',
    ].join('\n');
    expect(() => runPreviewParser(truncated)).toThrow(
      'OCR preview output was malformed',
    );
  });

  it('fails closed on "Will review (0)" when the excluded count is short of the changed count', () => {
    const shortExcluded = [
      '',
      'Preview: 5 file(s) changed  |  +30  -2',
      '',
      'Will review (0):',
      '',
      'Excluded from review (3):',
      '  [M]  docs/a.md    (unsupported_ext)',
      '  [M]  docs/b.md    (unsupported_ext)',
      '  [M]  docs/c.md    (unsupported_ext)',
      '',
    ].join('\n');
    expect(() => runPreviewParser(shortExcluded)).toThrow(
      'OCR preview output was malformed',
    );
  });

  it('returns [] for "Will review (0)" when every changed file is provably excluded', () => {
    const provablyEmpty = [
      '',
      'Preview: 2 file(s) changed  |  +8  -1',
      '',
      'Will review (0):',
      '',
      'Excluded from review (2):',
      '  [M]  docs/a.md    (unsupported_ext)',
      '  [M]  docs/b.md    (unsupported_ext)',
      '',
    ].join('\n');
    expect(runPreviewParser(provablyEmpty)).toEqual([]);
  });

  it('fails closed on contradictory Preview banners', () => {
    const contradictory = [
      '',
      'Preview: 2 file(s) changed  |  +8  -1',
      'Preview: 9 file(s) changed  |  +8  -1',
      '',
      'Excluded from review (2):',
      '  [M]  docs/a.md    (unsupported_ext)',
      '  [M]  docs/b.md    (unsupported_ext)',
      '',
    ].join('\n');
    expect(() => runPreviewParser(contradictory)).toThrow(
      'OCR preview output was malformed',
    );
  });

  it('fails closed on contradictory Excluded headings', () => {
    const contradictory = [
      '',
      'Preview: 2 file(s) changed  |  +8  -1',
      '',
      'Excluded from review (2):',
      '  [M]  docs/a.md    (unsupported_ext)',
      '  [M]  docs/b.md    (unsupported_ext)',
      'Excluded from review (7):',
      '  [M]  docs/c.md    (unsupported_ext)',
      '',
    ].join('\n');
    expect(() => runPreviewParser(contradictory)).toThrow(
      'OCR preview output was malformed',
    );
  });
});
