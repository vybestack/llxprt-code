/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Absolute enforcement (issue #3222): the ./internals.js escape hatch is DEAD.
 *
 * Doctrine: @vybestack/llxprt-code-agents exposes ONLY its intended API — the
 * curated package root plus the subpaths declared in its package.json exports
 * map. There is NO allowlist, NO compatibility alias, NO deprecation path, and
 * NO test-only meta category that may import the retired internals subpath.
 *
 * Each test below asserts one facet of the removal. Together they make any
 * resurrection of the escape hatch require editing this file:
 *   1. the exports map declares no ./internals.js entry;
 *   2. the barrel source file does not exist on disk;
 *   3. zero files anywhere in the scanned source trees reference the subpath;
 *   4. CLI imports of the agents package are the bare root or declared export
 *      subpaths only (never an undeclared subpath of any kind);
 *   5. a dynamic import of the subpath REJECTS at resolution time.
 *
 * SELF-EXCLUSION NOTE: the repo-scan test searches every scanned file for the
 * retired subpath string, so it must skip exactly one file — this one, which
 * names the subpath in order to enforce its absence everywhere else.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..', '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const SELF_PATH = fileURLToPath(import.meta.url);

const AGENTS_PACKAGE = '@vybestack/llxprt-code-agents';

// The retired subpath prefix, assembled from fragments so scanners reading
// THIS file never see the contiguous forbidden literal. The rule it feeds is
// ABSOLUTE: even if a future edit re-declares the subpath in the exports map,
// no CLI file may import it.
const RETIRED_SUBPATH_PREFIX = AGENTS_PACKAGE + '/internals';

// The forbidden reference pattern: any file whose content matches it (outside
// this enforcement file) keeps the retired subpath alive in some form — an
// import, a re-export, a script, a fixture, or a doc that still presents it as
// importable. All are violations.
const FORBIDDEN_REFERENCE = /llxprt-code-agents\/internals/;

const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
]);

const SCAN_ROOT_NAMES: readonly string[] = [
  'packages',
  'scripts',
  'integration-tests',
  'evals',
];

const SCAN_ROOTS: readonly string[] = SCAN_ROOT_NAMES.map((name) =>
  join(REPO_ROOT, name),
).filter((abs) => existsSync(abs));

/**
 * True for generated JUnit reports. They are build output (not source) and can
 * embed failure text that quotes an offender specifier verbatim, which would
 * make the scan flag the report rather than the code that produced it.
 */
function isGeneratedTestReport(fileName: string): boolean {
  return fileName.startsWith('junit') && fileName.endsWith('.xml');
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry)) {
        continue;
      }
      yield* walkFiles(abs);
    } else {
      yield abs;
    }
  }
}

/** Parsed exports map of packages/agents/package.json (die-on-parse-failure). */
function readAgentsExports(): Record<string, unknown> {
  const raw = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as { exports?: Record<string, unknown> };
  if (raw.exports === undefined) {
    throw new Error('packages/agents/package.json has no exports map');
  }
  return raw.exports;
}

describe('boundary: the agents internals subpath is dead (issue #3222)', () => {
  it('packages/agents/package.json exports declares no "./internals.js" entry', () => {
    const exports = readAgentsExports();
    expect(
      Object.prototype.hasOwnProperty.call(exports, './internals.js'),
    ).toBe(false);
  });

  it('packages/agents/src/internals.ts does not exist on disk', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'src', 'internals.ts'))).toBe(false);
  });

  it('zero references to the retired subpath across packages/, scripts/, integration-tests/, evals/', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walkFiles(root)) {
        const fileName = file.split('/').pop() ?? file;
        if (file === SELF_PATH || isGeneratedTestReport(fileName)) {
          continue;
        }
        if (FORBIDDEN_REFERENCE.test(readFileSync(file, 'utf8'))) {
          offenders.push(relative(REPO_ROOT, file));
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('CLI imports of the agents package are the bare root or declared export subpaths only', () => {
    // The allowed set is derived from the agents package's OWN exports map —
    // the package's real public surface, never a hand-maintained list — with
    // one absolute override: the retired subpath can never be legal, whatever
    // the exports map currently says.
    const allowed = new Set<string>([AGENTS_PACKAGE]);
    for (const key of Object.keys(readAgentsExports())) {
      if (key !== '.') {
        // Export keys are './<subpath>'; the import specifier drops the dot.
        allowed.add(AGENTS_PACKAGE + key.slice(1));
      }
    }

    const offenders: string[] = [];
    const cliSrc = join(REPO_ROOT, 'packages', 'cli', 'src');
    for (const file of walkFiles(cliSrc)) {
      const source = readFileSync(file, 'utf8');
      const specifiers = source
        .split('\n')
        .flatMap((line) => extractImportSpecifiers(line));
      for (const specifier of specifiers) {
        const referencesAgents =
          specifier === AGENTS_PACKAGE ||
          specifier.startsWith(AGENTS_PACKAGE + '/');
        const isRetired = specifier.startsWith(RETIRED_SUBPATH_PREFIX);
        if (isRetired || (referencesAgents && !allowed.has(specifier))) {
          offenders.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('dynamic import of the retired subpath rejects', async () => {
    // The specifier is assembled from fragments so boundary scanners reading
    // THIS file never see a quoted subpath specifier to flag (the established
    // fragment-assembly idiom in this directory).
    const specifier = AGENTS_PACKAGE + '/internals.js';
    await expect(import(specifier)).rejects.toThrow(/Cannot find module/);
  });
});

/**
 * Extracts import specifiers from a single source line via plain string
 * operations (no regex — this branch's sonarjs rule prefers string ops).
 * Covers `... from '...'` / `... from "..."`, side-effect `import '...'`, and
 * dynamic `import('...')` / `import("...")`. Mirrors the
 * extractFromSpecifiers idiom in boundary.adequacy.test.ts.
 */
function extractImportSpecifiers(rawLine: string): string[] {
  const line = rawLine.trim();
  const out: string[] = [];
  const markers = [
    "from '",
    'from "',
    "import '",
    'import "',
    "import('",
    'import("',
  ];
  for (const marker of markers) {
    const quote = marker.charAt(marker.length - 1);
    let searchFrom = 0;
    for (;;) {
      const idx = line.indexOf(marker, searchFrom);
      if (idx === -1) break;
      const start = idx + marker.length;
      const end = line.indexOf(quote, start);
      if (end > start) {
        out.push(line.slice(start, end));
        searchFrom = end + 1;
      } else {
        searchFrom = start;
      }
    }
  }
  return out;
}
