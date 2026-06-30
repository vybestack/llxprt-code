/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

/**
 * The npm lifecycle hooks whose entry scripts these tests walk. They run on
 * `npm install` of the *published* package, so every local module they
 * (transitively) `require()` MUST be included in the published tarball or the
 * install crashes with MODULE_NOT_FOUND for end users. The `files` allowlist in
 * package.json is the thing that decides what ships, and it is easy to add a new
 * shared helper to a lifecycle script while forgetting to allowlist it — exactly
 * the regression these tests guard against.
 */
const LIFECYCLE_HOOKS = ['preinstall', 'postinstall'] as const;

interface PackageScripts {
  scripts?: Record<string, string>;
}

interface NpmPackEntry {
  files: Array<{ path: string }>;
}

/**
 * Derives the lifecycle ENTRY scripts from package.json `scripts` rather than
 * hardcoding their paths, so this test follows a rename/move of a lifecycle
 * script (e.g. preinstall.cjs -> bootstrap/preinstall.cjs) instead of silently
 * guarding a stale path. Each hook command is expected to invoke a single local
 * script file (e.g. "node scripts/preinstall.cjs"); the package-root-relative
 * POSIX path of that file is extracted and asserted to exist on disk.
 */
function deriveLifecycleEntryScripts(): string[] {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  ) as PackageScripts;
  const scripts = pkg.scripts ?? {};
  const entries: string[] = [];
  for (const hook of LIFECYCLE_HOOKS) {
    const command = scripts[hook];
    expect(
      command,
      `package.json scripts.${hook} is expected to be defined so the ` +
        'published-package integrity test can walk its require graph.',
    ).toBeDefined();
    const match = /(?:^|\s)((?:\.?\/)?[\w./-]+\.(?:cjs|mjs|js))(?:\s|$)/.exec(
      command as string,
    );
    expect(
      match,
      `Could not extract a local script file from scripts.${hook} ` +
        `("${command}"); the integrity test expects a "node <path>.cjs" form.`,
    ).not.toBeNull();
    const relPath = (match as RegExpExecArray)[1]
      .replace(/^\.\//, '')
      .split('/')
      .join(posix.sep);
    expect(
      existsSync(join(repoRoot, relPath)),
      `scripts.${hook} references "${relPath}" which does not exist on disk.`,
    ).toBe(true);
    entries.push(relPath);
  }
  return entries;
}

/**
 * Memoized result of {@link getPackedPaths}. `npm pack --dry-run` is a slow
 * child process and the packed file set is constant for the duration of a test
 * run, so it is computed once and shared across the tests that need it.
 */
let packedPathsCache: Set<string> | undefined;

/**
 * Returns the exact set of file paths that `npm publish` would include in the
 * tarball, computed via `npm pack --dry-run --json` so the test exercises npm's
 * real `files`/.npmignore resolution rather than re-implementing it. Paths are
 * POSIX-style and relative to the package root (e.g. "scripts/preinstall.cjs").
 * The result is memoized so repeated calls do not re-spawn `npm pack`.
 */
function getPackedPaths(): Set<string> {
  if (packedPathsCache !== undefined) {
    return packedPathsCache;
  }
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as NpmPackEntry[];
  const entry = parsed[0];
  if (entry === undefined || !Array.isArray(entry.files)) {
    throw new Error(
      'npm pack --dry-run --json did not return the expected { files: [...] } shape.',
    );
  }
  packedPathsCache = new Set(entry.files.map((f) => f.path));
  return packedPathsCache;
}

/**
 * Extracts the specifiers of every *relative* dependency (require() and static
 * import) referenced by a CommonJS/ESM source file. Bare specifiers (npm
 * packages, node: builtins) are intentionally ignored: those are resolved from
 * node_modules / Node core at install time, not shipped inside this tarball.
 *
 * CONVENTION (enforced by this regex walker's deliberate limits): lifecycle
 * helper scripts MUST reference their relative dependencies with a STATIC
 * STRING LITERAL specifier — e.g. require('./detect-installer.cjs') or
 * `import x from './helper.js'`. The patterns below only match literal
 * './'-prefixed specifiers; they intentionally do NOT resolve computed
 * specifiers (require(varName), template literals, runtime path.join), nor do
 * they span specifiers split across multiple lines. A dynamically-referenced
 * helper would therefore escape this packed-tarball check. Keep lifecycle
 * helper imports as plain static literals so this guard stays sound; if a
 * computed specifier ever becomes necessary, broaden the walker accordingly.
 */
function findRelativeDependencySpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g, // require('./x')
    /\brequire\.resolve\(\s*['"](\.[^'"]+)['"]\s*\)/g, // require.resolve('./x')
    // import ... from './x' — anchored to a leading `import` keyword so a bare
    // "from './x'" in prose/comments cannot produce a false specifier. The
    // `[^'";]*?` only spans the import clause, never crossing a quote or `;`.
    /\bimport\b[^'";]*?\bfrom\s+['"](\.[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g, // import('./x')
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Resolves a relative specifier (as written in source) against the file that
 * references it, returning the package-root-relative POSIX path of the actual
 * file on disk — applying Node's extension/index resolution. Returns undefined
 * if nothing on disk matches, which signals a genuinely broken require rather
 * than merely an un-packed one.
 */
function resolveLocalModule(
  fromPackageRelPath: string,
  specifier: string,
): string | undefined {
  const fromDirAbs = dirname(join(repoRoot, fromPackageRelPath));
  const targetAbs = resolve(fromDirAbs, specifier);
  const candidates = [
    targetAbs,
    `${targetAbs}.cjs`,
    `${targetAbs}.js`,
    `${targetAbs}.mjs`,
    `${targetAbs}.json`,
    join(targetAbs, 'index.cjs'),
    join(targetAbs, 'index.js'),
    join(targetAbs, 'index.mjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // Normalize to a package-root-relative POSIX path to match npm pack output.
      const rel = candidate.slice(repoRoot.length + 1);
      return rel.split(/[\\/]/).join(posix.sep);
    }
  }
  return undefined;
}

describe('published package integrity (S1)', () => {
  it('includes every local module the lifecycle scripts transitively require', () => {
    // The bug this guards against: a lifecycle script gains a
    // `require('./helper.cjs')` but the helper is not added to package.json
    // `files`, so the published tarball omits it and `npm install` of the
    // released package dies with MODULE_NOT_FOUND. We compute the transitive
    // closure of relative requires starting from the lifecycle entry points and
    // assert each referenced local module actually ships.
    const packed = getPackedPaths();
    const lifecycleEntryScripts = deriveLifecycleEntryScripts();

    // Sanity: the entry points themselves must ship, or the whole premise is moot.
    for (const entry of lifecycleEntryScripts) {
      expect(
        packed.has(entry),
        `Lifecycle entry "${entry}" is declared in package.json scripts but is ` +
          'not in the published tarball (check the package.json "files" allowlist).',
      ).toBe(true);
    }

    const visited = new Set<string>();
    const queue: string[] = [...lifecycleEntryScripts];
    const missing: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const source = readFileSync(join(repoRoot, current), 'utf-8');
      for (const specifier of findRelativeDependencySpecifiers(source)) {
        const resolved = resolveLocalModule(current, specifier);
        if (resolved === undefined) {
          missing.push(
            `${current} requires "${specifier}" which resolves to no file on disk`,
          );
          continue;
        }
        if (!packed.has(resolved)) {
          missing.push(
            `${current} requires "${specifier}" (-> ${resolved}) which is NOT ` +
              'in the published tarball; add it to package.json "files".',
          );
          continue;
        }
        // Follow the dependency so we also catch helpers-requiring-helpers.
        queue.push(resolved);
      }
    }

    expect(
      missing,
      `Published-package integrity violations:\n  - ${missing.join('\n  - ')}`,
    ).toStrictEqual([]);
  });

  it('ships the shared detect-installer helper required by both lifecycle scripts', () => {
    // An explicit, named assertion for the specific shared module introduced in
    // S1. This is intentionally redundant with the transitive-closure test
    // above: it gives a precise, self-documenting failure if the helper ever
    // falls out of the tarball, independent of the require-graph walker.
    const packed = getPackedPaths();
    expect(
      packed.has('scripts/detect-installer.cjs'),
      'scripts/detect-installer.cjs is required by preinstall.cjs and ' +
        'postinstall.cjs but is missing from the published tarball; it must be ' +
        'listed in package.json "files".',
    ).toBe(true);
  });
});
