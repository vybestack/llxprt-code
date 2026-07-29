/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useWorkflowFixture } from './ocr-manifest-test-helpers.ts';
import { commandText, stepNamed } from './ocr-review-workflow-helpers.ts';

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

describe('.github/workflows/ocr-review.yml — preview parser (real OCR 1.7.16 preview output)', () => {
  const ctx = useWorkflowFixture();

  function extractPreviewPipeline(runText: string | string[]) {
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
    const printfStart = runText.indexOf('printf \'%s\\n\' "$reviewed"', awkEnd);
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

  function extractExcludedPipeline(runText: string | string[]) {
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

  function runPreviewParser(
    previewContent: string | NodeJS.ArrayBufferView<ArrayBufferLike>,
  ) {
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
      return fs.readFileSync(path.join(sub, 'ocr-selected-files.txt'), 'utf8');
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

  it('parses excluded files from the Excluded from review section', () => {
    const previewStep = stepNamed(
      ctx.codeReviewJob,
      'Verify review scope includes changed tests',
    );
    const previewRun = commandText(previewStep);
    const excludedAssign = extractExcludedPipeline(previewRun);
    expect(excludedAssign).toContain(
      '^Excluded([[:space:]]+from[[:space:]]+review)?[[:space:]]*\\(',
    );
  });
});
