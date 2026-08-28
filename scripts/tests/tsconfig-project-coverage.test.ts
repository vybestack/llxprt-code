/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guards the invariant behind issue #3387: every source file ESLint lints must
 * belong to its own package's TypeScript project.
 *
 * When a package's tsconfig.json excludes one of its own source files, that
 * file is not in any package project, so typescript-eslint resolves it against
 * the root tsconfig.json. The root config declares no `include`, so
 * TypeScript's default `**\/*` applies and the project spans the entire
 * repository. Building that program cost ~7 GB and ~40 s per ESLint process,
 * and the cost is flat: one such file is enough to pay it in full.
 *
 * Measured on packages/cli/src/config/config.test.ts, one ESLint invocation,
 * nothing else changed: 8,769,847,296 B / 46.96 s while excluded, versus
 * 1,640,644,608 B / 7.06 s once included.
 *
 * Files that legitimately fail `tsc` are excluded in the package's
 * tsconfig.noemit.json instead, which is what the typecheck script reads.
 *
 * These tests use the REAL repository tsconfigs and the REAL ESLint ignore
 * configuration. Nothing is mocked.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const PACKAGES_ROOT = join(REPO_ROOT, 'packages');

/** Parses a tsconfig with TypeScript's own JSONC reader, comments and all. */
function parseTsconfig(path: string): Record<string, unknown> {
  const { config, error } = ts.readConfigFile(path, (file) =>
    readFileSync(file, 'utf8'),
  );
  if (error !== undefined) {
    throw new Error(
      `${path}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`,
    );
  }
  return config as Record<string, unknown>;
}

function excludeEntries(config: Record<string, unknown>): string[] {
  const exclude = config['exclude'];
  return Array.isArray(exclude)
    ? exclude.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function packageDirs(): string[] {
  return readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Exclude entries that name a concrete existing file inside the package
 * itself. Directory entries (node_modules, dist) and glob patterns are not
 * concrete file exclusions, and entries reaching outside the package belong to
 * another package's project.
 */
function ownFileExclusions(pkg: string): string[] {
  const configPath = join(PACKAGES_ROOT, pkg, 'tsconfig.json');
  if (!existsSync(configPath)) {
    return [];
  }
  const pkgRoot = join(PACKAGES_ROOT, pkg);
  return excludeEntries(parseTsconfig(configPath))
    .filter((entry) => !entry.includes('*'))
    .map((entry) => resolve(pkgRoot, entry))
    .filter((path) => !relative(pkgRoot, path).startsWith('..'))
    .filter((path) => existsSync(path) && statSync(path).isFile());
}

describe('tsconfig project coverage (#3387)', () => {
  it('finds package directories to check, so the suite cannot pass vacuously', () => {
    expect(packageDirs().length).toBeGreaterThan(1);
  });

  it('no package tsconfig.json excludes a source file that ESLint still lints', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const orphans: string[] = [];
    for (const pkg of packageDirs()) {
      for (const file of ownFileExclusions(pkg)) {
        if (!(await eslint.isPathIgnored(file))) {
          orphans.push(relative(REPO_ROOT, file));
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it('keeps the typecheck exclusions of every package that has a noemit config', () => {
    const checked: string[] = [];
    for (const pkg of packageDirs()) {
      const noemitPath = join(PACKAGES_ROOT, pkg, 'tsconfig.noemit.json');
      if (!existsSync(noemitPath)) {
        continue;
      }
      checked.push(pkg);
      const base = excludeEntries(
        parseTsconfig(join(PACKAGES_ROOT, pkg, 'tsconfig.json')),
      );
      const noemit = excludeEntries(parseTsconfig(noemitPath));
      // The noemit project is what `tsc` reads, so it must still exclude
      // everything the base config excludes, plus the files moved out of it.
      expect(noemit).toEqual(expect.arrayContaining(base));
      expect(noemit.length).toBeGreaterThan(base.length);
    }
    expect(checked.length).toBeGreaterThan(0);
  });

  it('repeats project references in every noemit config that needs them', () => {
    for (const pkg of packageDirs()) {
      const noemitPath = join(PACKAGES_ROOT, pkg, 'tsconfig.noemit.json');
      if (!existsSync(noemitPath)) {
        continue;
      }
      // TypeScript does not inherit `references` through `extends`. Losing
      // them turns referenced project sources into ordinary inputs of a
      // composite project, which fails typecheck with TS6059.
      const base = parseTsconfig(join(PACKAGES_ROOT, pkg, 'tsconfig.json'));
      const noemit = parseTsconfig(noemitPath);
      expect(noemit['references']).toEqual(base['references']);
    }
  });

  it('points every noemit-config package at that config from its typecheck script', () => {
    for (const pkg of packageDirs()) {
      if (!existsSync(join(PACKAGES_ROOT, pkg, 'tsconfig.noemit.json'))) {
        continue;
      }
      const manifest = JSON.parse(
        readFileSync(join(PACKAGES_ROOT, pkg, 'package.json'), 'utf8'),
      ) as { scripts?: Record<string, string> };
      expect(manifest.scripts?.['typecheck']).toContain(
        '-p tsconfig.noemit.json',
      );
    }
  });
});
