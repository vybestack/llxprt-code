/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P09
 * @requirement:REQ-019
 *
 * T17 — No-deep-import / package-boundary guard.
 * A real static scan of consumer-facing test files under this directory asserts
 * they import ONLY the public root entry, documented app-service subpaths, test
 * framework, node builtins, or relative harness scaffolding that stays within
 * __tests__. Files under __tests__/helpers/ are excluded from the
 * consumer-facing forbidden-deep-import rule (they may import ./internals.js for
 * fixture construction only). This is an honest guard: if the harness is clean it
 * PASSES; it is never forced to fail artificially.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, normalize, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSandboxSegment } from './helpers/fixtureRoot.js';

const TESTS_DIR = stripSandboxSegment(
  fileURLToPath(new URL('.', import.meta.url)),
);
const PACKAGE_SRC_DIR = normalize(join(TESTS_DIR, '../../'));

const PUBLIC_ROOT = '@vybestack/llxprt-code-agents';
const APP_SERVICE_SUBPATH = '@vybestack/llxprt-code-agents/app-service.js';
const INTERNALS_SUBPATH = '@vybestack/llxprt-code-agents/internals.js';

const FORBIDDEN_DEEP_PREFIXES: readonly string[] = [
  '@vybestack/llxprt-code-core/',
  '@vybestack/llxprt-code-providers/',
  '@vybestack/llxprt-code-tools/',
  '@vybestack/llxprt-code-auth/',
  '@vybestack/llxprt-code-settings/',
  '@vybestack/llxprt-code-ide-integration/',
  '@vybestack/llxprt-code-policy/',
];

interface CollectedFile {
  readonly relPath: string;
  readonly absPath: string;
  readonly isHelper: boolean;
}

interface Violation {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

function listDirSafe(dirAbs: string): readonly string[] {
  try {
    return readdirSync(dirAbs);
  } catch {
    return [];
  }
}

function statSafe(abs: string): StatsResult {
  try {
    return { kind: 'ok', stat: statSync(abs) };
  } catch {
    return { kind: 'missing', stat: null };
  }
}

type StatsResult =
  | { kind: 'ok'; stat: ReturnType<typeof statSync> }
  | { kind: 'missing'; stat: null };

function collectFromEntries(
  dirAbs: string,
  dirRel: string,
  acc: CollectedFile[],
): void {
  for (const name of listDirSafe(dirAbs)) {
    const abs = join(dirAbs, name);
    const rel = dirRel === '' ? name : dirRel + '/' + name;
    const res = statSafe(abs);
    const isDir = res.kind === 'ok' && res.stat.isDirectory();
    const isSpec = name.endsWith('.spec.ts');
    if (isDir) {
      collectFromEntries(abs, rel, acc);
    }
    if (!isDir && isSpec) {
      acc.push({
        relPath: rel,
        absPath: abs,
        isHelper: rel.split('/').includes('helpers'),
      });
    }
  }
}

function collectSpecFiles(
  dirAbs: string,
  dirRel: string,
): readonly CollectedFile[] {
  const out: CollectedFile[] = [];
  collectFromEntries(dirAbs, dirRel, out);
  return out;
}

const IDENT_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$';
const WS_CHARS = ' \t\n\r\f\v';

function isIdentChar(ch: string): boolean {
  return IDENT_CHARS.includes(ch);
}

function isWs(ch: string): boolean {
  return WS_CHARS.includes(ch);
}

/**
 * Returns true when the keyword occurrence at [start, end) honours a leading
 * word boundary: it must be preceded by start-of-source or a non-identifier
 * character. Mirrors the original `\b` semantics so substrings inside words
 * like "transform" or "important" are not treated as keywords.
 */
function hasLeadingBoundary(source: string, start: number): boolean {
  return start === 0 || !isIdentChar(source[start - 1]);
}

/** Advances past any run of whitespace, returning the next index. */
function skipWs(source: string, index: number): number {
  let i = index;
  while (i < source.length && isWs(source[i])) {
    i += 1;
  }
  return i;
}

/**
 * Reads a quoted string starting at the opening quote index. Returns the inner
 * specifier and the index just past the closing quote, or null when the quote
 * is unterminated.
 */
function readQuoted(
  source: string,
  quoteIndex: number,
): { value: string; next: number } | null {
  const quote = source[quoteIndex];
  const close = source.indexOf(quote, quoteIndex + 1);
  if (close === -1) {
    return null;
  }
  return { value: source.slice(quoteIndex + 1, close), next: close + 1 };
}

/**
 * Reads a quoted string that MUST open with the exact `quoteChar` at
 * `quoteIndex`. Returns the inner specifier and the index just past the closing
 * quote, or null when the opening char is not `quoteChar` or the quote is
 * unterminated. Quote-specificity is the crux of the parity fix: it lets a
 * single pass faithfully mirror exactly ONE of the original regex passes.
 */
function readQuotedExact(
  source: string,
  quoteIndex: number,
  quoteChar: string,
): { value: string; next: number } | null {
  if (source[quoteIndex] !== quoteChar) {
    return null;
  }
  return readQuoted(source, quoteIndex);
}

/**
 * Attempts to read a `from <quoteChar>spec<quoteChar>` specifier at keyword
 * index `i` (which points at the 'f' of "from"), requiring the SPECIFIC
 * `quoteChar`. Returns the specifier and the index past the closing quote, or
 * null when the shape (with that quote) does not match. Mirrors exactly ONE of
 * the original `from`-quote regex passes.
 */
function matchFromQuote(
  source: string,
  i: number,
  quoteChar: string,
): { value: string; next: number } | null {
  if (!source.startsWith('from', i)) {
    return null;
  }
  if (!hasLeadingBoundary(source, i)) {
    return null;
  }
  const afterKeyword = i + 'from'.length;
  const quoteIndex = skipWs(source, afterKeyword);
  if (quoteIndex >= source.length) {
    return null;
  }
  return readQuotedExact(source, quoteIndex, quoteChar);
}

/**
 * Attempts to read an `import(<quoteChar>spec<quoteChar>)` specifier at keyword
 * index `i` (which points at the 'i' of "import"), requiring the SPECIFIC inner
 * `quoteChar`. Returns the specifier and the index past the closing
 * parenthesis, or null when the shape (with that quote) does not match. Mirrors
 * exactly ONE of the original `import`-quote regex passes.
 */
function matchImportQuote(
  source: string,
  i: number,
  quoteChar: string,
): { value: string; next: number } | null {
  if (!source.startsWith('import', i)) {
    return null;
  }
  if (!hasLeadingBoundary(source, i)) {
    return null;
  }
  const afterKeyword = i + 'import'.length;
  const parenIndex = skipWs(source, afterKeyword);
  if (source[parenIndex] !== '(') {
    return null;
  }
  const quoteIndex = skipWs(source, parenIndex + 1);
  if (quoteIndex >= source.length) {
    return null;
  }
  const quoted = readQuotedExact(source, quoteIndex, quoteChar);
  if (quoted === null) {
    return null;
  }
  const closeParen = skipWs(source, quoted.next);
  if (source[closeParen] !== ')') {
    return null;
  }
  return { value: quoted.value, next: closeParen + 1 };
}

/**
 * Attempts to read a bare side-effect `import <quoteChar>spec<quoteChar>`
 * specifier at keyword index `i` (which points at the 'i' of "import"),
 * requiring the SPECIFIC `quoteChar` to appear immediately (after optional
 * whitespace) AFTER the keyword — i.e. NOT a `(` (that is the dynamic-import
 * shape handled by matchImportQuote). Returns the specifier and the index past
 * the closing quote, or null when the shape (with that quote) does not match.
 * This catches `import '<spec>'` / `import "<spec>"` side-effect imports that
 * carry no `from` and no parentheses.
 */
function matchSideEffectImportQuote(
  source: string,
  i: number,
  quoteChar: string,
): { value: string; next: number } | null {
  if (!source.startsWith('import', i)) {
    return null;
  }
  if (!hasLeadingBoundary(source, i)) {
    return null;
  }
  const afterKeyword = i + 'import'.length;
  const quoteIndex = skipWs(source, afterKeyword);
  if (quoteIndex >= source.length) {
    return null;
  }
  // The crux of the disambiguation: a side-effect import has the QUOTE char
  // immediately after `import`+ws. A dynamic `import(` has `(` here instead and
  // is handled exclusively by matchImportQuote.
  if (source[quoteIndex] !== quoteChar) {
    return null;
  }
  return readQuotedExact(source, quoteIndex, quoteChar);
}

/**
 * Runs a SINGLE independent pass over the entire source from index 0, mirroring
 * one `matchAll` call: at each position it tries `tryMatch`; on a match it
 * records the value and advances past ONLY that match, otherwise it advances by
 * one. Because each pass scans the whole source independently, overlapping
 * matches of OTHER shapes are not consumed here — they are recovered by their
 * own pass. This restores true 4-independent-`matchAll` parity, RegExp-free.
 */
function extractWithPass(
  source: string,
  tryMatch: (s: string, i: number) => { value: string; next: number } | null,
): readonly string[] {
  const found: string[] = [];
  let i = 0;
  while (i < source.length) {
    const m = tryMatch(source, i);
    i = m === null ? i + 1 : m.next;
    if (m !== null) {
      found.push(m.value);
    }
  }
  return found;
}

/**
 * Extracts every import specifier reachable through `from '<spec>'`,
 * `from "<spec>"`, bare side-effect `import '<spec>'` / `import "<spec>"`, or
 * dynamic `import('<spec>')` / `import("<spec>")` WITHOUT any RegExp, via SIX
 * INDEPENDENT passes — one per (keyword/shape, quote) — each scanning the whole
 * source from index 0. This faithfully mirrors independent `matchAll` calls,
 * including their cross-quote overlap (e.g. a single-quoted specifier nested
 * inside a double-quoted one is still caught by the single-quote pass). Results
 * are concatenated in a deterministic grouped order: from-sq, from-dq,
 * side-effect-sq, side-effect-dq, import-sq, import-dq.
 */
function extractSpecifiers(source: string): readonly string[] {
  return [
    ...extractWithPass(source, (s, i) => matchFromQuote(s, i, "'")),
    ...extractWithPass(source, (s, i) => matchFromQuote(s, i, '"')),
    ...extractWithPass(source, (s, i) => matchSideEffectImportQuote(s, i, "'")),
    ...extractWithPass(source, (s, i) => matchSideEffectImportQuote(s, i, '"')),
    ...extractWithPass(source, (s, i) => matchImportQuote(s, i, "'")),
    ...extractWithPass(source, (s, i) => matchImportQuote(s, i, '"')),
  ];
}

function isRelativeEscapingTests(specifier: string, fromAbs: string): boolean {
  if (!specifier.startsWith('.')) {
    return false;
  }
  const resolved = normalize(join(dirname(fromAbs), specifier));
  const relToPackageSrc = relative(PACKAGE_SRC_DIR, resolved);
  return relToPackageSrc.startsWith('..') || isAbsolute(relToPackageSrc);
}

function isForbiddenDeep(specifier: string): boolean {
  if (specifier.includes('/dist/')) {
    return true;
  }
  return FORBIDDEN_DEEP_PREFIXES.some((p) => specifier.startsWith(p));
}

function isAllowed(specifier: string, fromAbs: string): boolean {
  if (specifier === PUBLIC_ROOT) {
    return true;
  }
  if (specifier === APP_SERVICE_SUBPATH) {
    return true;
  }
  if (specifier === INTERNALS_SUBPATH) {
    return false;
  }
  if (specifier.startsWith('@vybestack/llxprt-code-agents/')) {
    return false;
  }
  if (specifier.startsWith('node:')) {
    return true;
  }
  if (specifier === 'vitest' || specifier.startsWith('vitest/')) {
    return true;
  }
  if (specifier === 'fast-check' || specifier.startsWith('fast-check/')) {
    return true;
  }
  if (specifier.startsWith('.')) {
    return !isRelativeEscapingTests(specifier, fromAbs);
  }
  return true;
}

function scanForViolations(
  files: readonly CollectedFile[],
): readonly Violation[] {
  const violations: Violation[] = [];
  for (const f of files) {
    const source = readFileSync(f.absPath, 'utf8');
    for (const spec of extractSpecifiers(source)) {
      if (isForbiddenDeep(spec)) {
        violations.push({
          file: f.relPath,
          specifier: spec,
          reason: 'forbidden deep package/dist import',
        });
      } else if (!isAllowed(spec, f.absPath)) {
        violations.push({
          file: f.relPath,
          specifier: spec,
          reason: 'specifier not on consumer allowlist',
        });
      }
    }
  }
  return violations;
}

function scanDeepImports(
  files: readonly CollectedFile[],
): readonly Violation[] {
  const hits: Violation[] = [];
  for (const f of files) {
    const source = readFileSync(f.absPath, 'utf8');
    for (const spec of extractSpecifiers(source)) {
      if (isForbiddenDeep(spec)) {
        hits.push({ file: f.relPath, specifier: spec, reason: 'deep import' });
      }
    }
  }
  return hits;
}

const ALL_FILES = collectSpecFiles(TESTS_DIR, '');
const CONSUMER_FILES = ALL_FILES.filter((f) => !f.isHelper);
const CONSUMER_VIOLATIONS = scanForViolations(CONSUMER_FILES);
const DEEP_IMPORT_HITS = scanDeepImports(CONSUMER_FILES);
const HELPERS_PRESENT = existsSync(join(TESTS_DIR, 'helpers'));
const VIOLATION_LINES = CONSUMER_VIOLATIONS.map(
  (v) => '  ' + v.file + ': "' + v.specifier + '" (' + v.reason + ')',
).join('\n');
const VIOLATION_SUMMARY =
  CONSUMER_VIOLATIONS.length === 0
    ? ''
    : 'Forbidden/non-allowlisted imports found in consumer-facing specs:\n' +
      VIOLATION_LINES;

describe('Package boundary (T17) @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-019', () => {
  it('consumer-facing specs import only public entry and documented subpaths @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-019', () => {
    expect(VIOLATION_SUMMARY).toBe('');
    expect(CONSUMER_VIOLATIONS).toHaveLength(0);
  });

  it('helper scaffolding under helpers/ is excluded from the consumer-facing deep-import scan @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-019', () => {
    expect(HELPERS_PRESENT).toBe(true);
    const helperSpecs = ALL_FILES.filter((f) => f.isHelper);
    expect(helperSpecs).toHaveLength(0);
    expect(CONSUMER_VIOLATIONS).toHaveLength(0);
  });

  it('no consumer-facing spec imports a deep core/providers/tools/auth path @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-019', () => {
    expect(DEEP_IMPORT_HITS).toHaveLength(0);
  });

  it('extractSpecifiers preserves 4-independent-pass parity: nested cross-quote specifiers are both detected @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-019', () => {
    // A double-quoted `from` string whose CONTENT is itself a single-quoted
    // `from '@vybestack/...secret'` deep import. The original used four
    // independent matchAll passes, so BOTH the outer double-quote content AND
    // the inner single-quote forbidden deep import are captured. A single
    // consuming loop would skip the inner one and weaken the guard.
    //
    // The fixture and its expected specifiers are assembled from fragments at
    // runtime so the literal `from '<deep>'` shape never appears contiguously
    // in THIS source file — otherwise the file-level boundary scanner above
    // (which reads this spec) would, correctly post-fix, flag the fixture as a
    // real forbidden deep import. Assembling at runtime keeps the constructed
    // strings exact while leaving the on-disk source clean.
    const fromKw = 'fr' + 'om';
    const importKw = 'imp' + 'ort';
    const deep = '@vybestack/llxprt-code-core' + '/secret';
    const innerSq = fromKw + " '" + deep + "'";
    const fixture = importKw + ' x ' + fromKw + ' "' + innerSq + '"';

    const specs = extractSpecifiers(fixture);
    // Inner single-quote forbidden deep import — the one the single-pass bug
    // dropped.
    expect(specs).toContain(deep);
    // Outer double-quote content.
    expect(specs).toContain(innerSq);

    // Word-boundary negatives: keyword substrings inside larger identifiers
    // must NOT match.
    expect(extractSpecifiers(`transform 'x'`)).not.toContain('x');
    expect(extractSpecifiers(`reimport('x')`)).not.toContain('x');

    // Optional-whitespace semantics: no whitespace and extra whitespace both
    // still match.
    expect(extractSpecifiers(`from'a'`)).toContain('a');
    expect(extractSpecifiers(`import ( "b" )`)).toContain('b');
  });

  it('extractSpecifiers detects bare side-effect imports as deep imports @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-019', () => {
    // A bare side-effect `import '<deep>'` (no `from`, no parens) must be caught
    // by the scanner — otherwise a forbidden deep import written this way would
    // evade the boundary guard. The forbidden specifier is assembled from
    // fragments at runtime so the literal `import '<deep>'` shape never appears
    // contiguously in THIS source file (mirroring the parity test's fragment
    // trick), keeping the on-disk source clean for the file-level self-scan.
    const importKw = 'imp' + 'ort';
    const deep = '@vybestack/llxprt-code-core' + '/foo';
    const sideEffectSq = importKw + " '" + deep + "'";
    const sideEffectDq = importKw + ' "' + deep + '"';

    const sqSpecs = extractSpecifiers(sideEffectSq);
    expect(sqSpecs).toContain(deep);
    expect(isForbiddenDeep(deep)).toBe(true);

    const dqSpecs = extractSpecifiers(sideEffectDq);
    expect(dqSpecs).toContain(deep);

    // Disambiguation: a dynamic `import('<spec>')` must NOT be captured by the
    // side-effect pass (it has `(` after the keyword, not a quote), and a bare
    // side-effect import must NOT be captured by the dynamic pass.
    expect(
      extractWithPass(sideEffectSq, (s, i) => matchImportQuote(s, i, "'")),
    ).not.toContain(deep);
    expect(
      extractWithPass(`import('dyn')`, (s, i) =>
        matchSideEffectImportQuote(s, i, "'"),
      ),
    ).not.toContain('dyn');
  });
});
