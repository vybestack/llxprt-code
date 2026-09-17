/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * gemini-containment-source.ts — source-scanning layers of the #2628
 * Gemini-containment gate:
 *
 *   L2-import   Bun's transpiler (`scanImports`) reports real import shapes
 *               (static/side-effect imports, `export from` re-exports,
 *               dynamic `import()`, `require()`). Shapes the transpiler
 *               intentionally skips — fully type-only statements and
 *               mock.module/vi.mock/jest.mock specifier arguments — are
 *               covered by a linear statement-segmentation matcher:
 *               keyword anchors are located with indexOf and each anchor
 *               scans forward once with a bounded character walk (no regex
 *               gap quantifiers, O(n) per file). Files whose content Bun's
 *               scanner rejects (legacy JSX diagnostics, ambient
 *               declarations) fall back to the same matcher in fallback
 *               mode so the gate never throws on repo content.
 *
 *   L3-residency  no gemini-named file under packages/providers/src/**.
 *
 * The envelope layer (plugin-manifest ↔ PLUGIN_PROVIDED_PROVIDER_HINTS
 * exact-set parity, read by balanced, string/comment-aware literal
 * extraction) lives in gemini-containment-envelope.ts.
 */

import { join } from 'node:path';
import { checkEnvelopeLayer } from './gemini-containment-envelope.ts';
import {
  checkLockfileLayer,
  checkManifestLayer,
  collectSourceFiles,
  GEMINI_PLUGIN_PACKAGE_DIR,
  lineAt,
  PLUGINS_DIR,
  readTextOrError,
  targetsGenerationSdk,
  walkFiles,
  type GateViolation,
  type LayerResult,
  type ScanResult,
  type WalkOutput,
} from './gemini-containment-shared.ts';

// ─── Layer 2: imports ───────────────────────────────────────────────────────

type BunLoader = 'ts' | 'tsx' | 'jsx' | 'js';

const transpilers = new Map<BunLoader, Bun.Transpiler>();

function transpilerFor(loader: BunLoader): Bun.Transpiler {
  const existing = transpilers.get(loader);
  if (existing !== undefined) return existing;
  const created = new Bun.Transpiler({ loader });
  transpilers.set(loader, created);
  return created;
}

function loaderForSourceFile(rel: string): BunLoader {
  const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
  if (ext === '.tsx') return 'tsx';
  if (ext === '.jsx') return 'jsx';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js';
  return 'ts';
}

/** Bun's scanner rejects a leading `#!` line; real module code starts after it. */
function stripShebangLine(text: string): string {
  return text.startsWith('#!') ? text.slice(text.indexOf('\n') + 1) : text;
}

const SCAN_IMPORT_LABELS: Record<string, string> = {
  'import-statement': 'import statement',
  'dynamic-import': 'dynamic import()',
  'require-call': 'require() call',
};

function labelForScanKind(kind: string): string {
  return SCAN_IMPORT_LABELS[kind] ?? 'import';
}

function sdkImportViolation(
  relPath: string,
  line: number,
  label: string,
): GateViolation {
  return {
    layer: 'L2-import',
    file: relPath,
    line,
    message:
      `${label} resolving to the Google generation SDK outside ` +
      `${PLUGINS_DIR}/*/src (and ${PLUGINS_DIR}/*/dist) — zero-allowlist.`,
  };
}

function pushTranspilerScanHits(
  violations: GateViolation[],
  relPath: string,
  text: string,
): boolean {
  let scanned: ReadonlyArray<{ path: string; kind: string }>;
  try {
    scanned = transpilerFor(loaderForSourceFile(relPath)).scanImports(
      stripShebangLine(text),
    );
  } catch {
    return false;
  }
  for (const entry of scanned) {
    if (!targetsGenerationSdk(entry.path)) continue;
    violations.push(
      sdkImportViolation(
        relPath,
        lineAt(text, text.indexOf(entry.path)),
        labelForScanKind(entry.kind),
      ),
    );
  }
  return true;
}

// ─── Layer 2: linear import statement segmentation ──────────────────────────

type ImportKeyword = 'import' | 'export' | 'require';

/** Which statement shapes the segmentation pass matches. */
type ScanMode = 'type-only' | 'fallback';

const FROM_KEYWORD = 'from';
const TYPE_KEYWORD = 'type';
const TYPE_ONLY_ANCHORS: readonly ImportKeyword[] = ['import', 'export'];
const FALLBACK_ANCHORS: readonly ImportKeyword[] = [
  'import',
  'export',
  'require',
];

interface QuotedSpecifier {
  readonly text: string;
  /** Index just past the closing quote — the statement match end. */
  readonly end: number;
}

interface StatementHit {
  readonly start: number;
  readonly end: number;
  readonly specifier: string;
  readonly label: string;
}

function isQuoteChar(ch: string | undefined): boolean {
  return ch === "'" || ch === '"';
}

/** True when `word` occupies `at` with non-identifier chars on both sides. */
function isWordAt(text: string, at: number, word: string): boolean {
  if (!text.startsWith(word, at)) return false;
  const end = at + word.length;
  if (end < text.length && isIdentifierChar(text[end])) return false;
  if (at > 0 && isIdentifierChar(text[at - 1])) return false;
  return true;
}

/**
 * Parse the quoted specifier opening at `open`: one-or-more non-quote
 * characters then a closing quote. `requireMatchingQuote` reproduces the
 * fallback patterns' quote backreference; the type-only shapes accepted any
 * closing quote.
 */
function quotedSpecifierAt(
  text: string,
  open: number,
  requireMatchingQuote: boolean,
): QuotedSpecifier | null {
  const openQuote = text[open];
  let close = open + 1;
  while (close < text.length && !isQuoteChar(text[close])) close++;
  if (close === open + 1 || close >= text.length) return null;
  if (requireMatchingQuote && text[close] !== openQuote) return null;
  return { text: text.slice(open + 1, close), end: close + 1 };
}

/** Specifier of a `from` keyword ending at `fromEnd`, or null. */
function specifierAfterFrom(
  text: string,
  fromEnd: number,
  requireMatchingQuote: boolean,
): QuotedSpecifier | null {
  const open = skipWhitespace(text, fromEnd);
  if (!isQuoteChar(text[open])) return null;
  return quotedSpecifierAt(text, open, requireMatchingQuote);
}

/** True when a word-bounded `from` ends at `at` (trailing whitespace allowed). */
function endsWithFromKeyword(
  text: string,
  scanStart: number,
  at: number,
): boolean {
  let start = at;
  while (start > scanStart && /\s/.test(text[start - 1])) start--;
  return (
    start - FROM_KEYWORD.length >= scanStart &&
    isWordAt(text, start - FROM_KEYWORD.length, FROM_KEYWORD)
  );
}

/**
 * Bounded forward walk for gap + `from` + quoted specifier. The gap admits
 * everything except `;` and quotes, so the first `;` or quote ends the
 * statement; a quote only matches when a word-bounded `from` closes right
 * before it, and the first candidate `from` wins — the same earliest-match
 * semantics the historical lazy-gap patterns produced.
 */
function findFromSpecifier(
  text: string,
  scanStart: number,
  scanEnd: number,
  requireMatchingQuote: boolean,
): QuotedSpecifier | null {
  let i = scanStart;
  while (i < scanEnd) {
    const ch = text[i];
    if (ch === ';') return null;
    if (isQuoteChar(ch)) {
      return endsWithFromKeyword(text, scanStart, i)
        ? quotedSpecifierAt(text, i, requireMatchingQuote)
        : null;
    }
    if (ch === 'f' && isWordAt(text, i, FROM_KEYWORD)) {
      const hit = specifierAfterFrom(
        text,
        i + FROM_KEYWORD.length,
        requireMatchingQuote,
      );
      if (hit !== null) return hit;
    }
    i++;
  }
  return null;
}

/**
 * Bounded forward walk for the braced type-only tail: gap + `}` + `from` +
 * quoted specifier. The gap admits everything except braces, so the first
 * `}` is the only candidate — if its suffix is not a from-clause, the
 * statement cannot match at this anchor.
 */
function findBracedFromSpecifier(
  text: string,
  scanStart: number,
  scanEnd: number,
): QuotedSpecifier | null {
  let i = scanStart;
  while (i < scanEnd) {
    const ch = text[i];
    if (ch === '{') return null;
    if (ch === '}') {
      const fromAt = skipWhitespace(text, i + 1);
      if (!isWordAt(text, fromAt, FROM_KEYWORD)) return null;
      return specifierAfterFrom(text, fromAt + FROM_KEYWORD.length, false);
    }
    i++;
  }
  return null;
}

/** End of a `<ws>+ type` prefix, or null when the statement is not that shape. */
function typeOnlyPrefixEnd(text: string, keywordEnd: number): number | null {
  let i = keywordEnd;
  let sawWhitespace = false;
  while (i < text.length && /\s/.test(text[i])) {
    i++;
    sawWhitespace = true;
  }
  if (!sawWhitespace || !isWordAt(text, i, TYPE_KEYWORD)) return null;
  return i + TYPE_KEYWORD.length;
}

/** End of a `<ws>* { <ws>* type` prefix, or null. */
function bracedTypePrefixEnd(text: string, keywordEnd: number): number | null {
  let i = skipWhitespace(text, keywordEnd);
  if (text[i] !== '{') return null;
  i = skipWhitespace(text, i + 1);
  if (!isWordAt(text, i, TYPE_KEYWORD)) return null;
  return i + TYPE_KEYWORD.length;
}

/** Specifier of an `import|require <ws> (<ws> quote` call shape, or null. */
function callShapeSpecifier(
  text: string,
  keywordEnd: number,
): QuotedSpecifier | null {
  let i = skipWhitespace(text, keywordEnd);
  if (text[i] === '(') i = skipWhitespace(text, i + 1);
  if (!isQuoteChar(text[i])) return null;
  return quotedSpecifierAt(text, i, true);
}

function typeOnlyHitAt(
  text: string,
  anchor: number,
  keywordEnd: number,
  scanEnd: number,
): StatementHit | null {
  const straight = typeOnlyPrefixEnd(text, keywordEnd);
  if (straight !== null) {
    const spec = findFromSpecifier(text, straight, scanEnd, false);
    if (spec !== null) {
      return {
        start: anchor,
        end: spec.end,
        specifier: spec.text,
        label: 'type-only import statement',
      };
    }
  }
  const braced = bracedTypePrefixEnd(text, keywordEnd);
  if (braced === null) return null;
  const spec = findBracedFromSpecifier(text, braced, scanEnd);
  if (spec === null) return null;
  return {
    start: anchor,
    end: spec.end,
    specifier: spec.text,
    label: 'type-only import statement',
  };
}

function fallbackHitAt(
  text: string,
  anchor: number,
  keyword: ImportKeyword,
  keywordEnd: number,
  scanEnd: number,
): StatementHit | null {
  if (keyword !== 'export') {
    const call = callShapeSpecifier(text, keywordEnd);
    if (call !== null) {
      return {
        start: anchor,
        end: call.end,
        specifier: call.text,
        label: 'call-shaped import (text-scan fallback)',
      };
    }
  }
  if (keyword === 'require') return null;
  const spec = findFromSpecifier(text, keywordEnd, scanEnd, true);
  if (spec === null) return null;
  return {
    start: anchor,
    end: spec.end,
    specifier: spec.text,
    label: 'import statement (text-scan fallback)',
  };
}

function keywordAt(text: string, at: number): ImportKeyword {
  if (text.startsWith('import', at)) return 'import';
  if (text.startsWith('export', at)) return 'export';
  return 'require';
}

/** Every word-bounded keyword occurrence, in source order. */
function collectKeywordAnchors(
  text: string,
  keywords: readonly ImportKeyword[],
): number[] {
  const anchors: number[] = [];
  for (const keyword of keywords) {
    let at = text.indexOf(keyword);
    while (at !== -1) {
      if (isWordAt(text, at, keyword)) anchors.push(at);
      at = text.indexOf(keyword, at + 1);
    }
  }
  return anchors.sort((a, b) => a - b);
}

/**
 * Segment the text at keyword anchors and match each statement with one
 * bounded forward walk. Walks stop at the next anchor — no second keyword
 * occurs between a statement and its own from-clause in real code — so the
 * total work is linear in file size. Matches consume their span, mirroring
 * global-regex scanning. One deliberate deviation from a regex gap pattern:
 * a degenerate match whose gap spanned PAST a following keyword anchor is
 * not found from the earlier anchor; the statement owning the from-clause
 * reports it instead (same specifier, its own line), and the transpiler
 * already covers that statement on the primary path.
 */
function linearStatementHits(text: string, mode: ScanMode): StatementHit[] {
  const anchors = collectKeywordAnchors(
    text,
    mode === 'type-only' ? TYPE_ONLY_ANCHORS : FALLBACK_ANCHORS,
  );
  const hits: StatementHit[] = [];
  let resumeAfter = 0;
  for (let a = 0; a < anchors.length; a++) {
    const anchor = anchors[a];
    if (anchor < resumeAfter) continue;
    const keyword = keywordAt(text, anchor);
    const scanEnd = a + 1 < anchors.length ? anchors[a + 1] : text.length;
    const hit =
      mode === 'type-only'
        ? typeOnlyHitAt(text, anchor, anchor + keyword.length, scanEnd)
        : fallbackHitAt(text, anchor, keyword, anchor + keyword.length, scanEnd);
    if (hit !== null) {
      hits.push(hit);
      resumeAfter = hit.end;
    }
  }
  return hits;
}

function pushStatementHits(
  violations: GateViolation[],
  relPath: string,
  text: string,
  mode: ScanMode,
): void {
  for (const hit of linearStatementHits(text, mode)) {
    if (!targetsGenerationSdk(hit.specifier)) continue;
    violations.push(
      sdkImportViolation(relPath, lineAt(text, hit.start), hit.label),
    );
  }
}

/**
 * Statement shapes Bun's scanner intentionally skips: fully type-only
 * imports and re-exports, straight and braced.
 */
function pushTypeOnlyImportHits(
  violations: GateViolation[],
  relPath: string,
  text: string,
): void {
  pushStatementHits(violations, relPath, text, 'type-only');
}

/**
 * Fallback mode for the rare files Bun's scanner rejects: every from-import
 * plus call-shaped imports, matched by the same linear segmentation.
 */
function pushFallbackImportHits(
  violations: GateViolation[],
  relPath: string,
  text: string,
): void {
  pushStatementHits(violations, relPath, text, 'fallback');
}

const MOCK_CALLEES: readonly string[] = ['mock.module', 'vi.mock', 'jest.mock'];

function isIdentifierChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

/** First quoted string after `callee(` at `from`, or null when absent. */
function specifierArgAfterCall(
  text: string,
  from: number,
): string | null {
  const parenIndex = skipWhitespace(text, from);
  if (text[parenIndex] !== '(') return null;
  const openQuote = skipWhitespace(text, parenIndex + 1);
  const quote = text[openQuote];
  if (quote !== "'" && quote !== '"') return null;
  const end = text.indexOf(quote, openQuote + 1);
  if (end === -1) return null;
  return text.slice(openQuote + 1, end);
}

function recordMockHitIfNeeded(
  violations: GateViolation[],
  relPath: string,
  text: string,
  callee: string,
  index: number,
): void {
  const boundary = index === 0 ? '' : text[index - 1];
  if (!isIdentifierChar(boundary)) {
    const specifier = specifierArgAfterCall(text, index + callee.length);
    if (specifier !== null && targetsGenerationSdk(specifier)) {
      violations.push(
        sdkImportViolation(
          relPath,
          lineAt(text, index),
          'mock specifier argument',
        ),
      );
    }
  }
}

/**
 * mock.module/vi.mock/jest.mock callee arguments carry module specifiers no
 * scanner reports, so they are located by literal callee search plus a
 * character walk for the first argument — no regex backtracking at all.
 */
function pushMockSpecifierHits(
  violations: GateViolation[],
  relPath: string,
  text: string,
): void {
  for (const callee of MOCK_CALLEES) {
    let index = text.indexOf(callee);
    while (index !== -1) {
      recordMockHitIfNeeded(violations, relPath, text, callee, index);
      index = text.indexOf(callee, index + 1);
    }
  }
}

/**
 * Scan one source text for import-shaped SDK references. Structural on
 * statement shapes, NOT a bare substring search: a non-import mention of the
 * SDK string (models.dev metadata, manifest data, prose) is not a violation.
 * Zero-allowlist: every match is a violation.
 */
export function scanSourceForSdkImports(
  relPath: string,
  text: string,
): GateViolation[] {
  const violations: GateViolation[] = [];
  const transpilerScanned = pushTranspilerScanHits(violations, relPath, text);
  if (transpilerScanned) {
    pushTypeOnlyImportHits(violations, relPath, text);
  } else {
    pushFallbackImportHits(violations, relPath, text);
  }
  pushMockSpecifierHits(violations, relPath, text);
  return violations;
}

const SANCTIONED_PLUGIN_ZONE = new RegExp(
  `^${PLUGINS_DIR}/[^/]+/(?:src|dist)/`,
);

/**
 * One file's L2 scan outcome: its violations, or the read/scan error that
 * replaced them (unreadable files are operational errors, not skips).
 */
function scanOneSourceFile(
  root: string,
  rel: string,
): { readonly violations: GateViolation[]; readonly error: string | null } {
  const read = readTextOrError(root, rel);
  if (read.error !== null) {
    return { violations: [], error: read.error };
  }
  return { violations: scanSourceForSdkImports(rel, read.text), error: null };
}

/** Layer L2 (imports): zero-allowlist SDK-import scan over all source lanes. */
export function checkImportLayer(
  root: string,
): LayerResult & { readonly scannedSourceFiles: number } {
  const { files, errors } = collectSourceFiles(root);
  const violations: GateViolation[] = [];
  for (const rel of files) {
    if (SANCTIONED_PLUGIN_ZONE.test(rel)) continue;
    const scanned = scanOneSourceFile(root, rel);
    if (scanned.error !== null) errors.push(scanned.error);
    violations.push(...scanned.violations);
  }
  return { violations, errors, scannedSourceFiles: files.length };
}

// ─── Layer 3: residency ─────────────────────────────────────────────────────

/** Layer L3 (residency): no gemini-named files in the base provider tree. */
export function checkResidencyLayer(root: string): LayerResult {
  const violations: GateViolation[] = [];
  const out: WalkOutput = { files: [], errors: [] };
  walkFiles(join(root, 'packages', 'providers', 'src'), 'packages/providers/src', out);
  const errors = [...out.errors];
  for (const rel of out.files) {
    const basename = rel.slice(rel.lastIndexOf('/') + 1);
    if (!basename.toLowerCase().startsWith('gemini')) continue;
    violations.push({
      layer: 'L3-residency',
      file: rel,
      line: 1,
      message:
        'Gemini provider-tree file resides in the base provider workspace — ' +
        `the Gemini provider tree lives only under ${PLUGINS_DIR}/${GEMINI_PLUGIN_PACKAGE_DIR}/src/**.`,
    });
  }
  return { violations, errors };
}
// ─── Orchestration ──────────────────────────────────────────────────────────

/** Run every containment layer against a root tree. */
export function runContainmentScan(root: string): ScanResult {
  const violations: GateViolation[] = [];
  const errors: string[] = [];
  const manifest = checkManifestLayer(root);
  const lockfile = checkLockfileLayer(root);
  const imports = checkImportLayer(root);
  const residency = checkResidencyLayer(root);
  const envelope = checkEnvelopeLayer(root);
  violations.push(
    ...manifest.violations,
    ...lockfile.violations,
    ...imports.violations,
    ...residency.violations,
    ...envelope.violations,
  );
  errors.push(
    ...manifest.errors,
    ...lockfile.errors,
    ...imports.errors,
    ...residency.errors,
    ...envelope.errors,
  );
  violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.layer.localeCompare(b.layer),
  );
  return {
    violations,
    errors,
    scannedSourceFiles: imports.scannedSourceFiles,
  };
}
