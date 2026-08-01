/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { asRecord } from './typed-test-helpers.ts';
import type { WorkflowJob, WorkflowStep } from './typed-test-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const WORKFLOW_PATH = '.github/workflows/ocr-review.yml';

export function readRootFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

export function normalize(value: string | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function commandText(step: WorkflowStep | undefined): string {
  return String(step?.run ?? step?.with?.script ?? '');
}

function hasCommand(command: string, args: readonly string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function hasPerl(): boolean {
  return hasCommand('perl', ['-e', '1']);
}

export function hasBashAndPerl(): boolean {
  return hasCommand('bash', ['-c', 'perl -e 1']);
}

export function stepNamed(
  job: WorkflowJob | undefined,
  name: string,
): WorkflowStep {
  expect(job?.steps, 'job should have a steps array').toBeDefined();
  const step = job?.steps?.find((candidate) => candidate.name === name);
  expect(step, `job should contain step: ${name}`).toBeTruthy();
  if (!step) throw new Error(`job should contain step: ${name}`);
  return step;
}

export function expectContainsAll(value: string, snippets: string[]): void {
  for (const snippet of snippets) {
    expect(value).toContain(snippet);
  }
}

const COMMON_CREDENTIALS: Record<string, string> = {
  'Authorization: Bearer ': 'alpha-bravo-charlie-01',
  'Authorization: Basic ': 'delta-echo-foxtrot-02',
  'Authorization: token ': 'golf-hotel-india-03',
  'Authorization: ApiKey ': 'juliet-kilo-lima-04',
  'Authorization: ': 'mike-november-oscar-05',
  'x-api-key: ': 'papa-quebec-romeo-06',
  'api_key=': 'sierra-tango-uniform-07',
  '?key=': 'victor-whiskey-xray-08',
  '&token=': 'yankee-zulu-alpha-09',
  'access_token=': 'bravo-charlie-delta-10',
  'refresh_token=': 'echo-foxtrot-golf-11',
  'id_token=': 'hotel-india-juliet-12',
  'token=': 'kilo-lima-mike-13',
  'secret=': 'november-oscar-papa-14',
};

export function commonCredentialInput(): string {
  return Object.entries(COMMON_CREDENTIALS)
    .map(([prefix, value]) => `${prefix}${value}`)
    .join('\n');
}

export function expectCommonCredentialsRedacted(sanitized: string): void {
  expect(sanitized).toContain('Authorization: Bearer [REDACTED]');
  expect(sanitized).toContain('Authorization: Basic [REDACTED]');
  expect(sanitized).toContain('Authorization: token [REDACTED]');
  expect(sanitized).toContain('Authorization: ApiKey [REDACTED]');
  expect(sanitized).toContain('Authorization: [REDACTED]');
  expect(sanitized).toContain('x-api-key: [REDACTED]');
  expect(sanitized).toContain('api_key=[REDACTED]');
  expect(sanitized).toContain('access_token=[REDACTED]');
  expect(sanitized).toContain('refresh_token=[REDACTED]');
  expect(sanitized).toContain('id_token=[REDACTED]');
  expect(sanitized).toContain('?key=[REDACTED]');
  expect(sanitized).toContain('&token=[REDACTED]');
  expect(sanitized).toContain('token=[REDACTED]');
  expect(sanitized).toContain('secret=[REDACTED]');
  for (const credential of Object.values(COMMON_CREDENTIALS)) {
    expect(sanitized).not.toContain(credential);
    expect(sanitized).not.toContain(
      credential.slice(0, Math.floor(credential.length / 2)),
    );
    expect(sanitized).not.toContain(
      credential.slice(Math.ceil(credential.length / 2)),
    );
  }
}

function skipQuoted(source: string, index: number, quote: string): number {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
    } else if (source[cursor] === quote) {
      return cursor;
    }
  }
  throw new Error('Unterminated quoted string in extracted JavaScript source');
}

function skipTemplateLiteral(source: string, index: number): number {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
    } else if (source[cursor] === '$' && source[cursor + 1] === '{') {
      cursor = skipTemplateInterpolation(source, cursor + 1);
    } else if (source[cursor] === '`') {
      return cursor;
    }
  }
  throw new Error(
    'Unterminated template literal in extracted JavaScript source',
  );
}

function skipLineComment(source: string, index: number): number {
  const newline = source.indexOf('\n', index + 2);
  return newline >= 0 ? newline : source.length;
}

function skipBlockComment(source: string, index: number): number {
  const commentEnd = source.indexOf('*/', index + 2);
  if (commentEnd < 0) {
    throw new Error(
      'Unterminated block comment in extracted JavaScript source',
    );
  }
  return commentEnd + 1;
}

function skipTemplateInterpolation(source: string, index: number): number {
  let depth = 0;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    const next = source[cursor + 1];
    if (char === '/' && next === '/') {
      cursor = skipLineComment(source, cursor);
    } else if (char === '/' && next === '*') {
      cursor = skipBlockComment(source, cursor);
    } else if (char === '/' && startsRegexLiteral(source, cursor)) {
      cursor = skipRegexLiteral(source, cursor);
    } else if (char === "'" || char === '"') {
      cursor = skipQuoted(source, cursor, char);
    } else if (char === '`') {
      cursor = skipTemplateLiteral(source, cursor);
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
  }
  throw new Error(
    'Unterminated template interpolation in extracted JavaScript source',
  );
}

function skipRegexLiteral(source: string, index: number): number {
  let inCharacterClass = false;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 1;
    } else if (char === '[') {
      inCharacterClass = true;
    } else if (char === ']') {
      inCharacterClass = false;
    } else if (char === '/' && !inCharacterClass) {
      return cursor;
    }
  }
  throw new Error('Unterminated regex literal in extracted JavaScript source');
}

function previousSignificantChar(source: string, index: number): string | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!/\s/.test(source[cursor])) {
      return source[cursor];
    }
  }
  return null;
}

function isIdentifierCharacter(char: string): boolean {
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$'.includes(
    char,
  );
}

function previousIdentifier(source: string, index: number): string | null {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) {
    cursor -= 1;
  }
  const end = cursor + 1;
  while (cursor >= 0 && isIdentifierCharacter(source[cursor])) {
    cursor -= 1;
  }
  const identifier = source.slice(cursor + 1, end);
  return identifier.length > 0 ? identifier : null;
}

function startsRegexLiteral(source: string, index: number): boolean {
  const regexPrecedingKeywords = new Set([
    'await',
    'delete',
    'in',
    'instanceof',
    'new',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
  ]);
  const previousChar = previousSignificantChar(source, index);
  return (
    regexPrecedingKeywords.has(previousIdentifier(source, index) ?? '') ||
    previousChar === null ||
    '({[=,:;!&|?+-*%^~<>'.includes(previousChar)
  );
}

export function extractFunctionSource(
  source: string,
  functionName: string,
): string {
  const escapedFunctionName = functionName.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  const declarationPattern = new RegExp(
    `(?:async\\s+)?function\\s+${escapedFunctionName}(?![A-Za-z0-9_$])`,
  );
  const match = declarationPattern.exec(source);
  expect(match, `script should define ${functionName}`).toBeTruthy();
  const start = match?.index ?? -1;
  const bodyStart = source.indexOf('{', start);
  expect(
    bodyStart,
    `${functionName} should have a function body`,
  ).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      index = skipLineComment(source, index);
    } else if (char === '/' && next === '*') {
      index = skipBlockComment(source, index);
    } else if (char === '/' && startsRegexLiteral(source, index)) {
      index = skipRegexLiteral(source, index);
    } else if (char === "'" || char === '"') {
      index = skipQuoted(source, index, char);
    } else if (char === '`') {
      index = skipTemplateLiteral(source, index);
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Could not extract ${functionName} source`);
}

/**
 * Extract the body of a bash heredoc from a step's run script.
 *
 * A bash heredoc has the form:
 *   command <<DELIMITER
 *   ...heredoc body...
 *   DELIMITER
 *
 * The delimiter may be:
 *   - quoted with single quotes: <<'NODE'  (no expansion)
 *   - quoted with double quotes: <<"NODE"  (expansion, but delimiter text same)
 *   - bare (unquoted):            <<NODE
 *
 * Whitespace is allowed between `<<`, the optional quote, and the delimiter
 * word (e.g. `<<  'NODE'` or `<<NODE`).
 *
 * When `expectedDelimiter` is omitted, the function finds ALL heredocs and
 * asserts exactly ONE is present. When `expectedDelimiter` is provided (e.g.
 * `'NODE'`), only heredocs whose delimiter matches are counted, and the
 * function asserts exactly one match among those.
 *
 * Either way, a workflow change that adds or removes a heredoc fails loudly
 * with a clear, actionable error naming the step and the match count.
 *
 * Returns the heredoc body (text between the opening delimiter line and the
 * closing terminator line), with no surrounding command or terminator.
 */
export function extractHeredocBody(
  source: string,
  stepName: string,
  expectedDelimiter?: string,
): string {
  const allMatches = findAllHeredocs(source);
  const matches =
    expectedDelimiter !== undefined
      ? allMatches.filter((m) => m.delimiter === expectedDelimiter)
      : allMatches;
  if (matches.length !== 1) {
    const filterDesc =
      expectedDelimiter !== undefined
        ? ` with delimiter "${expectedDelimiter}"`
        : '';
    throw new Error(
      `extractHeredocBody: expected exactly 1 heredoc${filterDesc} in step "${stepName}", ` +
        `found ${matches.length}. ` +
        'A workflow change may have added or removed a heredoc. ' +
        'Inspect the step run script and update the test accordingly.',
    );
  }
  return matches[0].body;
}

interface HeredocMatch {
  body: string;
  delimiter: string;
}

function findAllHeredocs(source: string): HeredocMatch[] {
  // Group 1 captures the optional dash in <<- (strip-leading-tabs form).
  // Group 2 is the optional quote; group 3 is the delimiter word.
  const openerPattern = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
  const results: HeredocMatch[] = [];
  const allMatches = source.matchAll(openerPattern);
  for (const openerMatch of allMatches) {
    const match = extractHeredocFromOpener(source, openerMatch);
    if (match !== null) {
      results.push(match);
    }
  }
  return results;
}

function extractHeredocFromOpener(
  source: string,
  openerMatch: RegExpMatchArray,
): HeredocMatch | null {
  if (openerMatch.index === undefined) return null;
  const isDashForm = openerMatch[1] === '-';
  const delimiter = openerMatch[3];
  const bodyStartIndex = source.indexOf('\n', openerMatch.index);
  if (bodyStartIndex < 0) return null;
  const searchFrom = bodyStartIndex + 1;
  // Bash heredoc terminator rules:
  //   Plain form (<<): terminator must be at column 0 (no leading whitespace).
  //   Dash form (<<-): terminator may be indented with TABS only (no spaces).
  const leadingPattern = isDashForm ? '\\t*' : '';
  const terminatorPattern = new RegExp(
    `^${leadingPattern}${escapeRegex(delimiter)}\\s*$`,
    'm',
  );
  const terminatorMatch = terminatorPattern.exec(source.slice(searchFrom));
  if (terminatorMatch === null) return null;
  const bodyEndIndex = searchFrom + terminatorMatch.index;
  const newline = String.fromCharCode(10);
  // Full fidelity: in bash the body is every line between the opener and the
  // terminator, each including its newline. Trimming the final newline would
  // silently drop a trailing blank body line.
  const rawBody = source.slice(searchFrom, bodyEndIndex);
  // The dash form (<<-) strips leading tabs from every body line.
  const body = isDashForm
    ? rawBody
        .split(newline)
        .map((line) => line.replace(/^\t*/, ''))
        .join(newline)
    : rawBody;
  return { body, delimiter };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makePostSanitizer(
  postScript: string,
  token: string,
  url = '',
  context: Record<string, unknown> = {},
): unknown {
  const redactionMatch = postScript.match(
    /const\s+REDACTION\s*=\s*(["'])([^"'\n]*)\1/,
  );
  expect(
    redactionMatch,
    'script should define REDACTION as a single- or double-quoted string constant',
  ).toBeTruthy();
  expect(
    redactionMatch?.[2],
    'REDACTION constant should be non-empty',
  ).toBeTruthy();
  const source = [
    `const REDACTION = ${JSON.stringify(redactionMatch?.[2] ?? '')};`,
    `const ocrTokenForRedaction = ${JSON.stringify(token)};`,
    `const ocrUrlForRedaction = ${JSON.stringify(url)};`,
    extractFunctionSource(postScript, 'escapeRegExp'),
    extractFunctionSource(postScript, 'redactSecretDiagnostics'),
    'redactSecretDiagnostics;',
  ].join('\n');
  return vm.runInNewContext(source, context);
}

function notifySanitizerScript(notifyRun: string): string {
  const start = notifyRun.indexOf('sanitize_diagnostics() {');
  expect(
    start,
    'notify script should define sanitize_diagnostics',
  ).toBeGreaterThanOrEqual(0);
  const end = notifyRun.indexOf(
    '\nnotify_ocr_infrastructure_failure() {',
    start,
  );
  expect(
    end,
    'sanitize_diagnostics should precede notify function',
  ).toBeGreaterThan(start);
  const sanitizer = notifyRun.slice(start, end);
  return [
    'set -uo pipefail',
    sanitizer,
    'sanitize_diagnostics "$DIAGNOSTIC_INPUT"',
  ].join('\n');
}

export function executeNotifySanitizer(
  notifyRun: string,
  input: string,
  token: string,
  extraEnv: Record<string, string | undefined> = {},
): string {
  const script = notifySanitizerScript(notifyRun);
  return execFileSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...extraEnv,
      DIAGNOSTIC_INPUT: input,
      OCR_LLM_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function errorField(error: unknown, fieldName: string): string {
  if (
    error !== null &&
    error !== undefined &&
    typeof error === 'object' &&
    Object.prototype.hasOwnProperty.call(error, fieldName)
  ) {
    const value = asRecord(error)[fieldName];
    return value === undefined || value === null ? 'none' : String(value);
  }
  return 'none';
}

export function runNotifySanitizer(
  notifyRun: string,
  input: string,
  token: string,
  extraEnv: Record<string, string | undefined> = {},
): string {
  try {
    return executeNotifySanitizer(notifyRun, input, token, extraEnv).replace(
      /\n$/,
      '',
    );
  } catch (error) {
    const stderr = errorField(error, 'stderr');
    throw new Error(
      [
        'Notify sanitizer execution failed.',
        `status: ${errorField(error, 'status')}`,
        `code: ${errorField(error, 'code')}`,
        `signal: ${errorField(error, 'signal')}`,
        `stderr:\n${stderr}`,
      ].join('\n'),
      { cause: error },
    );
  }
}
