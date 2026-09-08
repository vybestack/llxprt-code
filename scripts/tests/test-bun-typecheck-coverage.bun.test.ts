/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral contract test for test-bun typecheck coverage (issue #2995).
 *
 * Bun-native test files under each `packages/<pkg>/test-bun` directory must
 * be fed to `tsc --noEmit` by `npm run typecheck`, exactly like every other
 * TypeScript in the repository. Coverage is wired per package: a dedicated
 * `tsconfig.test-bun.json` child project whose `include` covers the
 * `test-bun/` directory, chained into the package's `typecheck` npm script
 * (`tsc --noEmit && tsc --noEmit -p tsconfig.test-bun.json`). The root
 * `typecheck` script reaches every package script through
 * `npm run typecheck --workspaces --if-present`.
 *
 * These tests read the real files on disk and verify the wiring shape rather
 * than executing tsc (the typecheck runs themselves are the behavior under
 * test and are exercised by CI on every push). They fail whenever a new
 * `test-bun/` directory, file, or package appears without matching coverage.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const repoRoot = resolve(import.meta.dir, '..', '..');
const packagesRoot = join(repoRoot, 'packages');

/**
 * Reads a tsconfig with TypeScript's own JSONC reader.
 *
 * tsconfig files are JSONC, and this repository comments them freely (see
 * packages/*\/tsconfig.noemit.json). `JSON.parse` rejects those comments, so
 * the parse has to go through the same reader the compiler uses -- which is
 * also what scripts/tests/tsconfig-project-coverage.test.ts does.
 */
function parseTsconfig(path: string): TsConfig {
  const { config, error } = ts.readConfigFile(path, (file) =>
    readFileSync(file, 'utf8'),
  );
  if (error !== undefined) {
    throw new Error(
      `${path}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`,
    );
  }
  return config as TsConfig;
}

interface TsConfig {
  readonly extends?: string;
  readonly include?: readonly string[];
}

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>;
}

/** Translates one glob position into regex source plus consumed width. */
function globSegmentAt(
  pattern: string,
  index: number,
): { text: string; width: number } {
  // `**/` crosses directories (including zero); bare `**` matches anything.
  if (pattern.slice(index, index + 3) === '**/') {
    return { text: '(?:[^/]*/)*', width: 3 };
  }
  if (pattern.slice(index, index + 2) === '**') {
    return { text: '.*', width: 2 };
  }
  if (pattern[index] === '*') {
    return { text: '[^/]*', width: 1 };
  }
  if (pattern[index] === '?') {
    return { text: '[^/]', width: 1 };
  }
  const literal = pattern[index].replace(/[\\^$.+()[\]{}|]/g, '\\$&');
  return { text: literal, width: 1 };
}

/** Minimal tsconfig-glob matcher for the `*`/`**`/`?` shapes these use. */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; ) {
    const segment = globSegmentAt(pattern, i);
    source += segment.text;
    i += segment.width;
  }
  return new RegExp(`^${source}$`);
}

interface TestBunPackage {
  readonly name: string;
  readonly dir: string;
  readonly files: readonly string[];
}

/** Every package that ships Bun-native tests in a `test-bun/` directory. */
function discoverTestBunPackages(): TestBunPackage[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      dir: join(packagesRoot, entry.name),
    }))
    .filter(({ dir }) => existsSync(join(dir, 'test-bun')))
    .map(({ name, dir }) => ({
      name,
      dir,
      // Recursive walk mirrors the `test-bun/**/*.ts` include glob, so a
      // nested file can never be typechecked yet invisible to this guard.
      // Node's recursive readdirSync yields platform separators; normalize
      // to `/` so the package-relative paths match the globs everywhere.
      // `encoding: 'utf8'` pins the string[] overload; without it the
      // recursive variant widens to (string | Buffer)[] and defeats
      // map/filter below.
      files: readdirSync(join(dir, 'test-bun'), {
        recursive: true,
        encoding: 'utf8',
      })
        .filter((file) => file.endsWith('.ts'))
        .map(
          (file) => `test-bun/${file.replaceAll(String.fromCharCode(92), '/')}`,
        )
        .sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const testBunPackages = discoverTestBunPackages();

describe('test-bun typecheck coverage (issue #2995)', () => {
  it('finds at least one package with a test-bun directory', () => {
    // Guards against the discovery itself rotting (e.g. after a directory
    // rename) and silently asserting nothing.
    expect(testBunPackages.length).toBeGreaterThan(0);
  });

  it.each(testBunPackages)(
    'packages/$name: every test-bun file is covered by tsconfig.test-bun.json',
    ({ dir, files }) => {
      const configPath = join(dir, 'tsconfig.test-bun.json');
      expect(existsSync(configPath)).toBe(true);

      const config = parseTsconfig(configPath);

      // The child project must build on the package's real compiler options;
      // a standalone config would drift from production settings.
      expect(config.extends).toBe('./tsconfig.json');

      const include = config.include ?? [];
      expect(include.length).toBeGreaterThan(0);
      const patterns = include.map(globToRegExp);

      const uncovered = files.filter(
        (file) => !patterns.some((pattern) => pattern.test(file)),
      );
      expect(uncovered).toEqual([]);
    },
  );

  it.each(testBunPackages)(
    'packages/$name: typecheck script runs the test-bun project',
    ({ dir }) => {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as PackageJson;
      const script = pkg.scripts?.['typecheck'] ?? '';
      // The second, dedicated pass over test-bun/ must be fail-fast chained:
      // `;` separators would let the main pass mask a test-bun failure.
      expect(script).toContain('tsc --noEmit');
      expect(script).toContain('&& tsc --noEmit -p tsconfig.test-bun.json');
      expect(script).not.toContain('||');
    },
  );

  it('root typecheck fans out to every workspace package script', () => {
    const root = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as PackageJson;
    const script = root.scripts?.['typecheck'] ?? '';
    expect(script).toContain('typecheck --workspaces --if-present');
  });
});
