/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFileSync } from 'node:fs';

export interface JUnitTestFileOutcome {
  readonly name: string;
  readonly passed: boolean;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a minimal JUnit XML report at the given path. Each test file
 * becomes a testsuite with a single testcase representing the per-file
 * pass/fail outcome. Consumed by CI integrations (dorny/test-reporter).
 */
export function writeJUnitReport(
  outputPath: string,
  files: readonly JUnitTestFileOutcome[],
): void {
  const NL = String.fromCharCode(10);
  const failCount = files.filter((f) => !f.passed).length;
  const suites = files
    .map((f) => {
      const safeName = escapeXml(f.name);
      const failAttr = f.passed ? '0' : '1';
      const tag = f.passed
        ? '<testcase classname="' +
          safeName +
          '" name="bun-test (passed)" time="0" />'
        : '<testcase classname="' +
          safeName +
          '" name="bun-test (failed)" time="0"><failure message="failed" /></testcase>';
      return [
        '    <testsuite name="' +
          safeName +
          '" tests="1" failures="' +
          failAttr +
          '" errors="0" skipped="0" time="0">',
        '      ' + tag,
        '    </testsuite>',
      ].join(NL);
    })
    .join(NL);
  const header = '<?xml version="1.0" encoding="UTF-8" ?>';
  const open =
    '<testsuites name="bun tests" tests="' +
    files.length +
    '" failures="' +
    failCount +
    '" errors="0" time="0">';
  writeFileSync(
    outputPath,
    [header, open, suites, '</testsuites>'].join(NL) + NL,
    'utf-8',
  );
}
