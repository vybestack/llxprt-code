/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  openSync,
  closeSync,
  readSync,
  readFileSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';

/** Creates report staging storage with best-effort, idempotent cleanup. */
export function createJunitTempDirectory(
  directory: string,
  log: (message: string) => void,
): { readonly path: string; readonly cleanup: () => void } {
  const path = mkdtempSync(join(directory, 'bun-junit-'));
  let cleaned = false;
  return {
    path,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (error) {
        log(
          `Failed to remove JUnit temporary directory ${path}: ${String(error)}`,
        );
      }
    },
  };
}

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
  writeFileSync(
    outputPath,
    renderJUnitReport({ kind: 'shared-files', files }),
    'utf-8',
  );
}

const BUN_JUNIT_TIMEOUT_MARKER = '<failure type="TimeoutError"';
export const JUNIT_SCAN_CHUNK_BYTES = 64 * 1024;
const JUNIT_SCAN_OVERLAP_CHARS = BUN_JUNIT_TIMEOUT_MARKER.length - 1;

function isNoSuchFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function junitReportContainsPerTestTimeout(reportPath: string): boolean {
  const chunk = Buffer.alloc(JUNIT_SCAN_CHUNK_BYTES);
  let overlap = '';
  let descriptor: number | undefined;
  try {
    descriptor = openSync(reportPath, 'r');
    for (;;) {
      const bytesRead = readSync(
        descriptor,
        chunk,
        0,
        JUNIT_SCAN_CHUNK_BYTES,
        null,
      );
      if (bytesRead === 0) return false;
      // A chunk edge can split a multi-byte UTF-8 sequence; continuation
      // bytes never decode to ASCII, so the split can neither fabricate nor
      // destroy the ASCII marker.
      const text = overlap + chunk.toString('utf8', 0, bytesRead);
      if (text.includes(BUN_JUNIT_TIMEOUT_MARKER)) return true;
      overlap =
        text.length > JUNIT_SCAN_OVERLAP_CHARS
          ? text.slice(-JUNIT_SCAN_OVERLAP_CHARS)
          : text;
    }
  } catch (error) {
    // An absent report is the killed-before-writing case, not a read failure.
    if (isNoSuchFileError(error)) return false;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function stripInvalidXmlChars(value: string): string {
  // Filtered by code point rather than a regex so no control-character escape
  // appears in a pattern literal. Allowed C0 characters are tab (0x09), line
  // feed (0x0A) and carriage return (0x0D).
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isAllowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
    const isForbidden = code < 0x20 || code === 0x7f;
    if (!isForbidden || isAllowedControl) {
      out += char;
    }
  }
  return out;
}

export function escapeCliXml(value: string): string {
  return escapeXml(stripInvalidXmlChars(value));
}

export function stripAnsi(value: string): string {
  // Built from a char code rather than written as a regex literal: an escape
  // character in a literal trips no-control-regex, and suppressing a lint rule
  // is not an acceptable way to pass it.
  const csi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
  return value.replace(csi, '');
}

export function parseCaseCounts(output: string): {
  pass: number;
  fail: number;
  skip: number;
  todo: number;
} {
  // Bun disables colour when stdout is a pipe, but FORCE_COLOR (or a future
  // default) would wrap these summary lines in escape sequences and every
  // count would silently read zero — the worst outcome for a parity check.
  const plain = stripAnsi(output);
  const read = (label: string): number => {
    const pattern = ['^[ \\t]*(\\d+)[ \\t]+', label, '[ \\t]*$'].join('');
    const match = plain.match(new RegExp(pattern, 'm'));
    return match ? Number.parseInt(match[1], 10) : 0;
  };
  return {
    pass: read('pass'),
    fail: read('fail'),
    skip: read('skip'),
    todo: read('todo'),
  };
}

function collapseActWarnings(output: string): {
  body: string;
  elidedWarnings: number;
} {
  const kept: string[] = [];
  let elided = 0;
  let skipping = false;
  // Cap lines consumed after a warning start whose end marker never arrives
  // (truncated at the source). The standard block is ~10 lines.
  let skipLineCount = 0;
  const MAX_WARNING_BODY_LINES = 15;
  for (const line of output.split(NEWLINE)) {
    if (!skipping) {
      if (ACT_WARNING_START.test(line)) {
        elided += 1;
        skipLineCount = 1;
        skipping = !ACT_WARNING_END.test(line);
      } else {
        kept.push(line);
      }
    } else {
      skipLineCount++;
      if (ACT_WARNING_END.test(line)) {
        skipping = false;
      } else if (ACT_WARNING_START.test(line)) {
        elided += 1;
        skipLineCount = 1;
        skipping = !ACT_WARNING_END.test(line);
      } else if (skipLineCount > MAX_WARNING_BODY_LINES) {
        skipping = false;
        kept.push(line);
      }
    }
  }
  return { body: kept.join(NEWLINE), elidedWarnings: elided };
}

function headTail(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const marker = `
[... output elided ...]
`;
  const budget = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(budget / 2);
  const tail = budget - head;
  // Guard tail === 0: String.prototype.slice(-0) returns the whole string.
  const tailSlice = tail > 0 ? text.slice(-tail) : '';
  return `${text.slice(0, head)}${marker}${tailSlice}`;
}

export function failureExcerpt(output: string, maxChars: number): string {
  if (output.length <= maxChars) {
    return output;
  }
  const { body, elidedWarnings } = collapseActWarnings(output);
  const banner =
    elidedWarnings > 0
      ? `[${elidedWarnings} React "not wrapped in act(...)" warning block(s) elided]
`
      : '';
  const excerpt = headTail(body, maxChars - banner.length);
  return (banner + excerpt).slice(0, maxChars);
}
const ACT_WARNING_START =
  /^An update to .* inside a test was not wrapped in act\(\.\.\.\)/;
const ACT_WARNING_END =
  /Learn more at https:\/\/react\.dev\/link\/wrap-tests-with-act/;
const NEWLINE = String.fromCharCode(10);

export interface CliJUnitOutcome {
  readonly file: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly output: string;
}
export interface CoreJUnitOutcome {
  file: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  // Null when the timeout originated inside a single test: that budget
  // belongs to the individual test (it may override Bun's per-test timeout),
  // so no file-level number applies.
  timeoutMs: number | null;
  reapFailed: boolean;
  reapError: string | null;
}
export interface AuthJUnitOutcome {
  file: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
}

export interface SummaryJUnitCase {
  readonly className: string;
  readonly failureXml: string;
  readonly failedTimeAttribute: boolean;
}
export interface AgentsJUnitFile {
  readonly file: string;
  readonly failureReason: string;
  readonly reportPath: string;
}
export type JUnitReportInput =
  | {
      readonly kind: 'workspace-summary';
      readonly workspace: 'cli' | 'core' | 'auth';
      readonly cases: readonly SummaryJUnitCase[];
      readonly totalFiles: number;
      readonly failedCount: number;
    }
  | {
      readonly kind: 'agents-detail';
      readonly files: readonly AgentsJUnitFile[];
    }
  | {
      readonly kind: 'shared-files';
      readonly files: readonly JUnitTestFileOutcome[];
    };

export function buildCliJUnitCases(
  results: readonly CliJUnitOutcome[],
  timeoutForFile: (file: string) => number,
): readonly SummaryJUnitCase[] {
  return results.map((result) => {
    const className = escapeCliXml(
      result.file.replace(/\.(test|spec)\.tsx?$/, ''),
    );
    const failure = buildCliFailureXml(result, timeoutForFile);
    return { className, failureXml: failure, failedTimeAttribute: false };
  });
}

function buildFailureXml(result: CoreJUnitOutcome): string {
  if (result.passed) {
    return '';
  }
  if (result.timedOut && result.reapFailed) {
    const message = escapeXml(
      result.reapError ?? 'Process tree reaping failed',
    );
    return `<failure message="${message}">TIMEOUT+REAP_FAILED</failure>`;
  }
  if (result.timedOut) {
    // A per-test timeout has no file-level number to cite: the test that
    // timed out may have overridden Bun's per-test budget.
    const message =
      result.timeoutMs === null
        ? 'Timed out: per-test timeout'
        : `Timed out after ${result.timeoutMs / 1000}s`;
    return `<failure message="${message}">TIMEOUT</failure>`;
  }
  return `<failure message="Exit code ${result.exitCode ?? -1}">FAILED</failure>`;
}
export function buildCoreJUnitCases(
  results: readonly CoreJUnitOutcome[],
): readonly SummaryJUnitCase[] {
  return results.map((r) => {
    const className = escapeXml(
      r.file.replace(/^src\//, '').replace(/\.(test|spec)\.tsx?$/, ''),
    );
    const failureXml = buildFailureXml(r);
    return {
      className,
      failureXml,
      failedTimeAttribute: !r.passed,
    };
  });
}

export function formatAuthFailureReason(
  result: AuthJUnitOutcome,
  perFileTimeoutMs: number,
): string {
  if (result.timedOut) {
    return `Timed out after ${perFileTimeoutMs / 1000}s`;
  }
  if (result.signal !== null) {
    return `Killed by signal ${result.signal}`;
  }
  return `Exit code ${result.exitCode ?? -1}`;
}
export function buildAuthJUnitCases(
  results: readonly AuthJUnitOutcome[],
  perFileTimeoutMs: number,
): readonly SummaryJUnitCase[] {
  return results.map((r) => {
    const className = escapeXml(
      r.file.replace(/^src\//, '').replace(/\.(test|spec)\.tsx?$/, ''),
    );
    const failureXml = r.passed
      ? ''
      : `<failure message="${formatAuthFailureReason(r, perFileTimeoutMs)}">FAILED</failure>`;
    return {
      className,
      failureXml,
      failedTimeAttribute: !r.passed,
    };
  });
}

export function formatAgentsFailureReason(result: {
  readonly timedOut: boolean;
  readonly timeoutMs: number;
  readonly signal: NodeJS.Signals | null;
  readonly exitCode: number | null;
}): string {
  if (result.timedOut) {
    return `TIMEOUT after ${result.timeoutMs}ms`;
  }
  if (result.signal !== null) {
    // Distinguishes an external kill (typically the OOM killer on a small CI
    // runner) from a genuine test failure, which would report an exit code.
    return `killed by signal ${result.signal}`;
  }
  return `exit code ${result.exitCode ?? -1}`;
}
interface ReportTotals {
  readonly tests: number;
  readonly failures: number;
  readonly skipped: number;
}

function readIntAttribute(element: string, name: string): number {
  const match = new RegExp(`\\b${name}="([0-9]+)"`).exec(element);
  return match === null ? 0 : Number.parseInt(match[1], 10);
}

function extractReportBody(
  xml: string,
): { body: string; totals: ReportTotals } | undefined {
  const openMatch = /<testsuites\b[^>]*>/.exec(xml);
  const closeIndex = xml.lastIndexOf('</testsuites>');
  if (openMatch === null || closeIndex < 0) {
    return undefined;
  }
  const bodyStart = openMatch.index + openMatch[0].length;
  if (closeIndex < bodyStart) {
    return undefined;
  }
  return {
    body: trimReportNewlines(xml.slice(bodyStart, closeIndex)),
    totals: {
      tests: readIntAttribute(openMatch[0], 'tests'),
      failures: readIntAttribute(openMatch[0], 'failures'),
      skipped: readIntAttribute(openMatch[0], 'skipped'),
    },
  };
}

function unreportedSuite(result: AgentsJUnitFile): string {
  const name = escapeXml(result.file);
  const reason = escapeXml(result.failureReason);
  return [
    `  <testsuite name="${name}" file="${name}" tests="1" failures="1" skipped="0" time="0">`,
    `    <testcase name="${name} (no test report produced)" classname="${name}" time="0">`,
    `      <failure message="${reason}">The bun test process produced no JUnit report.</failure>`,
    '    </testcase>',
    '  </testsuite>',
  ].join('\n');
}

function renderAgentsJUnitReport(results: readonly AgentsJUnitFile[]): string {
  const bodies: string[] = [];
  let tests = 0;
  let failures = 0;
  let skipped = 0;

  for (const result of results) {
    let report: string | undefined;
    try {
      report = readFileSync(result.reportPath, 'utf-8');
    } catch {
      report = undefined;
    }
    const extracted =
      report === undefined ? undefined : extractReportBody(report);
    if (extracted === undefined) {
      bodies.push(unreportedSuite(result));
      tests += 1;
      failures += 1;
      continue;
    }
    bodies.push(extracted.body);
    tests += extracted.totals.tests;
    failures += extracted.totals.failures;
    skipped += extracted.totals.skipped;
  }

  return (
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuites name="agents" tests="${tests}" failures="${failures}" skipped="${skipped}">`,
      ...bodies,
      '</testsuites>',
    ].join('\n') + '\n'
  );
}
function renderSharedJUnitReport(
  files: readonly JUnitTestFileOutcome[],
): string {
  const NL = String.fromCharCode(10);
  const failCount = files.filter((f) => !f.passed).length;
  const suites =
    files.length === 0
      ? '    <testsuite name="(no test files)" tests="0" failures="0" errors="0" skipped="0" time="0" />'
      : files
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
  return [header, open, suites, '</testsuites>'].join(NL) + NL;
}
export function renderJUnitReport(input: JUnitReportInput): string {
  if (input.kind === 'shared-files')
    return renderSharedJUnitReport(input.files);
  if (input.kind === 'agents-detail')
    return renderAgentsJUnitReport(input.files);
  const { workspace, totalFiles, failedCount } = input;
  const testCases = input.cases
    .map(
      (c) =>
        `    <testcase classname="${c.className}" name="${c.className}"${c.failedTimeAttribute ? ' time="0"' : ''}>${c.failureXml}</testcase>`,
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${totalFiles}" failures="${failedCount}">`,
    `  <testsuite name="${workspace}" tests="${totalFiles}" failures="${failedCount}">`,
    testCases,
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');
}

function buildCliFailureXml(
  result: CliJUnitOutcome,
  timeoutForFile: (file: string) => number,
): string {
  if (result.passed) return '';
  return result.timedOut
    ? `<failure message="Timed out after ${
        timeoutForFile(result.file) / 1000
      }s">TIMEOUT</failure>`
    : `<failure message="Exit code ${
        result.exitCode ?? -1
      }">${escapeCliXml(failureExcerpt(stripAnsi(result.output), 4000))}</failure>`;
}

function trimReportNewlines(body: string): string {
  let start = 0;
  let end = body.length;
  while (start < end && body[start] === '\n') start++;
  while (end > start && body[end - 1] === '\n') end--;
  return body.slice(start, end);
}
