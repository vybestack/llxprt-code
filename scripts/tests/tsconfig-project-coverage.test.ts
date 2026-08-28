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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
 * The file set TypeScript resolves for a package's tsconfig.json, as absolute
 * paths. This is the real question: not what the `exclude` array happens to
 * say, but which files the project actually contains after `extends`,
 * `include`, `exclude` and `files` have all been applied.
 */
function projectFiles(pkg: string): Set<string> {
  const configPath = join(PACKAGES_ROOT, pkg, 'tsconfig.json');
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(
        `${configPath}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
      );
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (parsed === undefined) {
    throw new Error(`${configPath}: could not be parsed`);
  }
  return new Set(parsed.fileNames.map((file) => resolve(file)));
}

/**
 * The files in a package that the type-aware ESLint layer applies to. The
 * config in eslint.config.js scopes `projectService` to the TS and TSX
 * sources under `packages/<pkg>/src`, so only those files need a project.
 */
function typeAwareSources(pkg: string): string[] {
  const srcRoot = join(PACKAGES_ROOT, pkg, 'src');
  if (!existsSync(srcRoot)) {
    return [];
  }
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') {
          walk(path);
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(path);
      }
    }
  };
  walk(srcRoot);
  return found;
}

/**
 * Files eslint.config.js explicitly hands to the fallback project via
 * `parserOptions.projectService.allowDefaultProject`. They are the one
 * sanctioned exception to the invariant below.
 */
const ALLOW_DEFAULT_PROJECT = /packages\/core\/src\/prompts\/[^/]+\.d\.ts$/;

describe('tsconfig project coverage (#3387)', () => {
  it('finds package directories to check, so the suite cannot pass vacuously', () => {
    expect(packageDirs().length).toBeGreaterThan(1);
  });

  it('every type-aware-linted source file belongs to its own package project', async () => {
    // The invariant, checked against the resolved project rather than the
    // shape of the `exclude` array, so a narrowed `include`, a glob, or a
    // `files` list cannot slip past it.
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const orphans: string[] = [];
    for (const pkg of packageDirs()) {
      const sources = typeAwareSources(pkg);
      if (sources.length === 0) {
        continue;
      }
      const owned = projectFiles(pkg);
      for (const file of sources) {
        if (owned.has(file) || ALLOW_DEFAULT_PROJECT.test(file)) {
          continue;
        }
        if (!(await eslint.isPathIgnored(file))) {
          orphans.push(relative(REPO_ROOT, file));
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it('checks a meaningful number of source files, so the invariant is not vacuous', () => {
    const total = packageDirs().reduce(
      (sum, pkg) => sum + typeAwareSources(pkg).length,
      0,
    );
    expect(total).toBeGreaterThan(1000);
  });

  it('sets noEmit in every noemit config so a bare tsc -p cannot write output', () => {
    for (const pkg of packageDirs()) {
      const noemitPath = join(PACKAGES_ROOT, pkg, 'tsconfig.noemit.json');
      if (!existsSync(noemitPath)) {
        continue;
      }
      const options = parseTsconfig(noemitPath)['compilerOptions'];
      expect(options).toMatchObject({ noEmit: true });
    }
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
