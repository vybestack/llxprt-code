// @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P21 — Capability-Boundary Adequacy (REQ-INT-005).
 *
 * A STATIC import-scan test (a `.test.ts`, intentionally EXEMPT from the T17
 * boundary guard which only scans `.spec.ts`) that executably encodes the
 * boundary contract the whole new Agent-API surface must satisfy for a future
 * CLI (#1595): the surface is reachable using ONLY the public root
 * `@vybestack/llxprt-code-agents`, with NO deep RAW-SOURCE reaches in any new
 * production file, the THREE brand-new controls importing core through the
 * BARE BARREL only, and the public-consumer integration driver importing
 * nothing outside a strict allow-list.
 *
 * The import-extraction machinery (extractSpecifiers and its character-class
 * helpers) is copied verbatim from the proven T17 boundary guard so this scan
 * shares its exact, RegExp-free parity semantics.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSandboxSegment } from './helpers/fixtureRoot.js';

// ─── Path resolution (portable; derived from import.meta.url) ──────────────

const TESTS_DIR = stripSandboxSegment(
  fileURLToPath(new URL('.', import.meta.url)),
);
/** packages/agents/src/ */
const PACKAGE_SRC_DIR = normalize(join(TESTS_DIR, '../../'));

// ─── File sets (relative to packages/agents/src/) ──────────────────────────

const NEW_PRODUCTION_FILES: readonly string[] = [
  'api/control/policyControl.ts',
  'api/control/tasksControl.ts',
  'api/control/toolKeysControl.ts',
  'api/control/mcpControl.ts',
  'api/control/mcpControlWiring.ts',
  'api/control/authControl.ts',
  'api/control/hooks.ts',
  'api/control/toolControl.ts',
  'api/agentImpl.ts',
  'api/agent.ts',
  'api/index.ts',
  'app-services/command-api-map.ts',
];

const NEW_CONTROLS_STRICT: readonly string[] = [
  'api/control/policyControl.ts',
  'api/control/tasksControl.ts',
  'api/control/toolKeysControl.ts',
];

const DRIVER_SPEC = 'api/__tests__/capabilityGaps.integration.spec.ts';

function toAbs(relUnderSrc: string): string {
  return join(PACKAGE_SRC_DIR, relUnderSrc);
}

const NEW_PRODUCTION_FILES_ABS: readonly string[] =
  NEW_PRODUCTION_FILES.map(toAbs);
const NEW_CONTROLS_STRICT_ABS: readonly string[] =
  NEW_CONTROLS_STRICT.map(toAbs);
const DRIVER_SPEC_ABS: string = toAbs(DRIVER_SPEC);

// ─── Patterns ──────────────────────────────────────────────────────────────

/**
 * RAW-SOURCE markers. A specifier containing any of these substrings reaches
 * into another package's source tree (or a built dist artifact) directly,
 * bypassing the package exports map. These are plain substrings (NOT import
 * statements) so they are safe to write contiguously in this file — the
 * self-scan in boundary.spec.ts reads only `.spec.ts` files anyway.
 *
 * Note: the established package-export convention imports TYPE-ONLY subpaths
 * like `@vybestack/llxprt-code-core/config/config.js` (resolved via the exports
 * map, NOT raw source). The substring `core/src` does NOT appear in
 * `config/config.js`, so these patterns correctly distinguish raw source from
 * legitimate package-export subpaths.
 */
const RAW_SOURCE_PATTERNS: readonly string[] = [
  'core/src',
  'providers/src',
  'tools/src',
  'policy/src',
  '/dist/',
];

/** The bare core barrel — allowed; any subpath under it is forbidden for the
 * three brand-new controls. */
const CORE_SUBPATH_PREFIX = '@vybestack/llxprt-code-core' + '/';

function isRawSourceReach(specifier: string): boolean {
  return RAW_SOURCE_PATTERNS.some((p) => specifier.includes(p));
}

function isCoreSubpath(specifier: string): boolean {
  // Assembled at runtime so the literal `from '@vybestack/llxprt-code-core/...'`
  // shape never appears contiguously in this source file (self-scan safety,
  // mirroring boundary.spec.ts).
  return specifier.startsWith(CORE_SUBPATH_PREFIX);
}

/**
 * Reads a file's source and returns its import specifiers via the proven
 * character-class scanner.
 */
function readSpecifiers(absPath: string): readonly string[] {
  const source = readFileSync(absPath, 'utf8');
  return extractSpecifiers(source);
}

// ─── Import-extraction machinery (copied verbatim from boundary.spec.ts) ────

const IDENT_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$';
const WS_CHARS = ' \t\n\r\f\v';

function isIdentChar(ch: string): boolean {
  return IDENT_CHARS.includes(ch);
}

function isWs(ch: string): boolean {
  return WS_CHARS.includes(ch);
}

function hasLeadingBoundary(source: string, start: number): boolean {
  return start === 0 || !isIdentChar(source[start - 1]);
}

function skipWs(source: string, index: number): number {
  let i = index;
  while (i < source.length && isWs(source[i])) {
    i += 1;
  }
  return i;
}

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
  if (source[quoteIndex] !== quoteChar) {
    return null;
  }
  return readQuotedExact(source, quoteIndex, quoteChar);
}

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

// ─── Driver allow-list (REQ-INT-005: public-consumer scope) ────────────────

const AGENTS_ROOT = '@vybestack/llxprt-code-agents';
const AGENTS_SUBPATH_PREFIX = '@vybestack/llxprt-code-agents' + '/';

function isDriverAllowed(specifier: string): boolean {
  if (specifier === AGENTS_ROOT) {
    return true;
  }
  if (specifier === 'vitest' || specifier.startsWith('vitest/')) {
    return true;
  }
  if (specifier === 'fast-check' || specifier.startsWith('fast-check/')) {
    return true;
  }
  if (specifier.startsWith('node:')) {
    return true;
  }
  if (specifier.startsWith('./')) {
    return true;
  }
  return false;
}

// ─── Pre-computed scan results (honest guards; never forced to fail) ───────

interface Finding {
  readonly file: string;
  readonly specifier: string;
  readonly rule: string;
}

const RAW_SOURCE_FINDINGS: readonly Finding[] = (() => {
  const out: Finding[] = [];
  for (const rel of NEW_PRODUCTION_FILES) {
    const specs = readSpecifiers(toAbs(rel));
    for (const spec of specs) {
      if (isRawSourceReach(spec)) {
        out.push({ file: rel, specifier: spec, rule: 'raw-source reach' });
      }
    }
  }
  return out;
})();

const STRICT_CORE_SUBPATH_FINDINGS: readonly Finding[] = (() => {
  const out: Finding[] = [];
  for (const rel of NEW_CONTROLS_STRICT) {
    const specs = readSpecifiers(toAbs(rel));
    for (const spec of specs) {
      if (isCoreSubpath(spec)) {
        out.push({
          file: rel,
          specifier: spec,
          rule: 'core subpath in a strict bare-barrel-only control',
        });
      }
    }
  }
  return out;
})();

const DRIVER_DISALLOWED: readonly Finding[] = (() => {
  const out: Finding[] = [];
  const specs = readSpecifiers(DRIVER_SPEC_ABS);
  for (const spec of specs) {
    if (spec.startsWith(AGENTS_SUBPATH_PREFIX)) {
      out.push({
        file: DRIVER_SPEC,
        specifier: spec,
        rule: 'public-consumer deep import of agents subpath',
      });
    } else if (!isDriverAllowed(spec)) {
      out.push({
        file: DRIVER_SPEC,
        specifier: spec,
        rule: 'public-consumer import outside the driver allow-list',
      });
    }
  }
  return out;
})();

const DRIVER_RAW = readFileSync(DRIVER_SPEC_ABS, 'utf8');
const DRIVER_HAS_GETCONFIG = DRIVER_RAW.includes('getConfig');

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('P21 capability-boundary adequacy (REQ-INT-005) @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005', () => {
  it('no new production file reaches raw source (core/src, providers/src, tools/src, policy/src, /dist/) @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005', () => {
    const detail = RAW_SOURCE_FINDINGS.map(
      (f) => `  ${f.file}: "${f.specifier}" (${f.rule})`,
    ).join('\n');
    expect(detail).toBe('');
    expect(RAW_SOURCE_FINDINGS).toHaveLength(0);
  });

  it('the three brand-new controls are bare-barrel-only (no core subpath) @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005', () => {
    const detail = STRICT_CORE_SUBPATH_FINDINGS.map(
      (f) => `  ${f.file}: "${f.specifier}" (${f.rule})`,
    ).join('\n');
    expect(detail).toBe('');
    expect(STRICT_CORE_SUBPATH_FINDINGS).toHaveLength(0);
  });

  it('the P20 driver spec imports only the public root, framework, node builtins, and in-tree relative helpers (no getConfig) @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005', () => {
    const detail = DRIVER_DISALLOWED.map(
      (f) => `  ${f.file}: "${f.specifier}" (${f.rule})`,
    ).join('\n');
    expect(detail).toBe('');
    expect(DRIVER_DISALLOWED).toHaveLength(0);
    expect(DRIVER_HAS_GETCONFIG).toBe(false);
  });

  it('extractSpecifiers matcher self-check: package-export subpath is NOT raw-source, src/index.js IS raw-source @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005', () => {
    // Assembled from fragments so no contiguous forbidden import literal
    // appears in this source file (self-scan safety).
    const pkgExport = '@vybestack/llxprt-code-core' + '/config/config.js';
    const rawSrc = '@vybestack/llxprt-code-core' + '/src/index.js';
    expect(isRawSourceReach(pkgExport)).toBe(false);
    expect(isRawSourceReach(rawSrc)).toBe(true);
    // The bare barrel must not be classified as a core subpath; a subpath
    // must.
    const bareBarrel = '@vybestack/llxprt-code-core';
    expect(isCoreSubpath(bareBarrel)).toBe(false);
    expect(isCoreSubpath(pkgExport)).toBe(true);
  });

  // ─── Property blocks (≥30%, MIN-2; classic fc.assert form) ──────────────

  it('PROP raw-source-free: for any new production file, none of its import specifiers is a raw-source reach @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NEW_PRODUCTION_FILES_ABS),
        (absPath: string) => {
          const specs = readSpecifiers(absPath);
          return specs.every((s) => !isRawSourceReach(s));
        },
      ),
    );
  });

  it('PROP bare-barrel-only: for any brand-new control, none of its import specifiers starts with the core subpath prefix @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NEW_CONTROLS_STRICT_ABS),
        (absPath: string) => {
          const specs = readSpecifiers(absPath);
          return specs.every((s) => !isCoreSubpath(s));
        },
      ),
    );
  });

  it('PROP driver-allow-list: for any import specifier in the P20 driver, it is on the public-consumer allow-list and not an agents subpath @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005', () => {
    const specs = readSpecifiers(DRIVER_SPEC_ABS);
    fc.assert(
      fc.property(fc.constantFrom(...specs), (spec: string) => {
        if (spec.startsWith(AGENTS_SUBPATH_PREFIX)) {
          return false;
        }
        return isDriverAllowed(spec);
      }),
    );
  });
});
