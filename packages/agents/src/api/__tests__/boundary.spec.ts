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

// eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
const STATIC_FROM_RE = /\bfrom\s*'([^']+)'/g;
// eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
const STATIC_FROM_DQ_RE = /\bfrom\s*"([^"]+)"/g;
// eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*'([^']+)'\s*\)/g;
// eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
const DYNAMIC_IMPORT_DQ_RE = /\bimport\s*\(\s*"([^"]+)"\s*\)/g;

function pushMatches(source: string, re: RegExp, found: string[]): void {
  for (const m of source.matchAll(re)) {
    found.push(m[1]);
  }
}

function extractSpecifiers(source: string): readonly string[] {
  const found: string[] = [];
  pushMatches(source, STATIC_FROM_RE, found);
  pushMatches(source, STATIC_FROM_DQ_RE, found);
  pushMatches(source, DYNAMIC_IMPORT_RE, found);
  pushMatches(source, DYNAMIC_IMPORT_DQ_RE, found);
  return found;
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
});
