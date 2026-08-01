/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
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
  const functionSource = extractFunctionSource(
    commandText(previewStep),
    'previewSelectionFromOutput',
  );
  const sandbox: Record<string, unknown> = {
    Error,
    Number,
    Object,
    Set,
    String,
  };
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

  it('excludes all entries under Excluded from review in 1.8.4 output', () => {
    const files = runPreviewParser(REAL_1_8_4_PREVIEW);
    expect(files).not.toContain('project-plans/issue2860/PLAN.md');
    expect(files).not.toContain('scripts/tests/ocr-trusted-marker.test.ts');
  });
});
