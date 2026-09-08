/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';

const ROOT = path.resolve(import.meta.dirname, '../..');

const PACKAGE_LOCK_PATH = path.join(ROOT, 'package-lock.json');
const BUN_LOCK_PATH = path.join(ROOT, 'bun.lock');
const BUILD_VSCODE_COMPANION_PATH = path.join(
  ROOT,
  'scripts/build_vscode_companion.ts',
);

const VSCE_VERSION = '3.9.2';
const RUN_VSCE_PATH = 'scripts/run_vsce.ts';

function runnerSource(): string {
  return readFile(RUN_VSCE_PATH);
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJsonObject(relPath: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const errors: ParseError[] = [];
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0 || parsed === undefined || typeof parsed !== 'object') {
    throw new Error(
      `${relPath} is not parseable JSONC (${errors.length} error)`,
    );
  }
  return parsed as Record<string, unknown>;
}

function dependencySections(
  pkg: Record<string, unknown>,
): Array<[string, Record<string, unknown>]> {
  const sections = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ];
  const result: Array<[string, Record<string, unknown>]> = [];
  for (const section of sections) {
    const value = pkg[section];
    if (value !== undefined && value !== null && typeof value === 'object') {
      result.push([section, value as Record<string, unknown>]);
    }
  }
  return result;
}

function companionScript(name: string): string {
  const pkg = readJsonObject('packages/vscode-ide-companion/package.json');
  const scripts = pkg['scripts'];
  if (
    scripts === undefined ||
    scripts === null ||
    typeof scripts !== 'object'
  ) {
    throw new Error('companion package.json should declare scripts');
  }
  const value = (scripts as Record<string, unknown>)[name];
  if (typeof value !== 'string') {
    throw new Error(
      `companion package.json script "${name}" should be a string`,
    );
  }
  return value;
}

function lockfilePackageEntries(
  lock: Record<string, unknown>,
): Array<[string, Record<string, unknown>]> {
  const packages = lock['packages'];
  if (
    packages === undefined ||
    packages === null ||
    typeof packages !== 'object'
  ) {
    return [];
  }
  return Object.entries(packages).map(([key, value]) => [
    key,
    value as Record<string, unknown>,
  ]);
}

function lockfileNames(lock: Record<string, unknown>): string[] {
  return lockfilePackageEntries(lock)
    .map(([key]) => key)
    .filter(
      (key) => key.includes('node_modules/') || key.startsWith('packages/'),
    );
}

describe('issue #2754 — VSCE is release-only packaging tooling', () => {
  it('A1: companion is a workspace-facing package but declares no VSCE dependency', () => {
    const companion = readJsonObject(
      'packages/vscode-ide-companion/package.json',
    );
    for (const [, deps] of dependencySections(companion)) {
      expect(
        Object.prototype.hasOwnProperty.call(deps, '@vscode/vsce'),
        'companion package.json must not declare @vscode/vsce',
      ).toBe(false);
    }
  });

  it('A1: root package.json declares no @vscode/vsce dependency', () => {
    const root = readJsonObject('package.json');
    for (const [, deps] of dependencySections(root)) {
      expect(
        Object.prototype.hasOwnProperty.call(deps, '@vscode/vsce'),
        'root package.json must not declare @vscode/vsce',
      ).toBe(false);
    }
  });

  it('A1: package-lock.json has no @vscode/vsce or @vscode/vsce-sign entry', () => {
    const lock = readJsonObject('package-lock.json');
    const names = lockfileNames(lock);
    const vsceEntries = names.filter((name) =>
      name.startsWith('node_modules/@vscode/vsce'),
    );
    expect(vsceEntries).toEqual([]);
  });

  it('A1: companion workspace entry in package-lock.json declares no VSCE dependency', () => {
    const lock = readJsonObject('package-lock.json');
    const packages = lock['packages'];
    const entry = (packages as Record<string, unknown>)[
      'packages/vscode-ide-companion'
    ];
    expect(entry).toBeDefined();
    for (const [, deps] of dependencySections(
      entry as Record<string, unknown>,
    )) {
      expect(
        Object.prototype.hasOwnProperty.call(deps, '@vscode/vsce'),
        'companion package-lock entry must not declare @vscode/vsce',
      ).toBe(false);
    }
  });

  it('A2: companion package.json declares no VSCE dependency (Bun side)', () => {
    const companion = readJsonObject(
      'packages/vscode-ide-companion/package.json',
    );
    for (const [, deps] of dependencySections(companion)) {
      expect(
        Object.prototype.hasOwnProperty.call(deps, '@vscode/vsce'),
        'bun.lock mirrors the companion manifest; VSCE must be absent',
      ).toBe(false);
    }
  });

  it('A2: bun.lock has no @vscode/vsce package entry', () => {
    const lock = readJsonObject('bun.lock');
    const names = lockfileNames(lock);
    const vsceEntries = names.filter((name) => name.includes('@vscode/vsce'));
    expect(vsceEntries).toEqual([]);
  });

  it('A3: companion build scripts compile with tsc/esbuild and never invoke VSCE', () => {
    expect(companionScript('build')).toBe('npm run build:dev');
    expect(companionScript('build:dev')).toBe(
      'npm run check-types && npm run lint && bun esbuild.ts',
    );
    expect(companionScript('build:prod')).toBe('bun esbuild.ts --production');
    expect(companionScript('check-types')).toBe('tsc --noEmit');
    expect(companionScript('lint')).toBe('eslint src');
  });

  it('A3: companion prepare/generate scripts never invoke VSCE', () => {
    expect(companionScript('prepare')).not.toContain('vsce');
    expect(companionScript('generate:notices')).not.toContain('vsce');
  });

  it('A4: the runner pins an exact VSCE version, not a range', () => {
    // A caret/tilde would let an unreviewed VSCE ship the extension.
    expect(VSCE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(runnerSource()).toContain(
      `export const VSCE_VERSION = '${VSCE_VERSION}'`,
    );
  });

  it('A4: the runner installs the pinned version and never a floating one', () => {
    const source = runnerSource();
    expect(source).toContain('`@vscode/vsce@${VSCE_VERSION}`');
    // No lifecycle scripts: VSCE's transitive install scripts build
    // signing/credential binaries that packaging does not use.
    expect(source).toContain('--ignore-scripts');
  });

  it('A4/A6: the runner caches VSCE under node_modules so it never ships', () => {
    // node_modules is gitignored and is excluded by the repo-copy filters used
    // by the release tooling, so the packaging tool cannot leak into an
    // artifact or perturb a packed tree.
    const source = runnerSource();
    expect(source).toContain("join(root, 'node_modules', '.cache'");
  });

  it('A4: companion package script packages through the pinned runner', () => {
    const command = companionScript('package');
    expect(command).toContain('scripts/run_vsce.ts');
    expect(command).toContain('package --no-dependencies');
  });

  it('A5: release.yml Publish VS Code extension step uses the pinned runner and preserves publishing flags', () => {
    const releaseYml = readFile('.github/workflows/release.yml');
    const publishStep = releaseYml.slice(
      releaseYml.indexOf('Publish VS Code extension'),
      releaseYml.indexOf('\n      - name: Publish @vybestack'),
    );
    expect(publishStep).toContain('scripts/run_vsce.ts publish');
    expect(publishStep).toContain('--packagePath');
    expect(publishStep).toContain('--azure-credential');
    expect(publishStep).toContain('--skip-duplicate');
  });

  it('A5: no unpinned npx @vscode/vsce invocation appears anywhere', () => {
    const releaseYml = readFile('.github/workflows/release.yml');
    const companion = readFile('packages/vscode-ide-companion/package.json');
    const buildScript = readFile('scripts/build_vscode_companion.ts');
    for (const source of [releaseYml, companion, buildScript]) {
      expect(source).not.toMatch(/npx\s+@vscode\/vsce(?!@)/g);
    }
  });

  it('A5: build_vscode_companion.ts packages via the companion package script', () => {
    const source = readFile('scripts/build_vscode_companion.ts');
    expect(source).toContain('run package');
  });
});

describe('issue #2754 — package-lock and bun.lock are clean (fixture-light)', () => {
  it('package-lock.json and bun.lock both exist and are parseable', () => {
    expect(fs.existsSync(PACKAGE_LOCK_PATH)).toBe(true);
    expect(fs.existsSync(BUN_LOCK_PATH)).toBe(true);
    readJsonObject('package-lock.json');
    readJsonObject('bun.lock');
  });

  it('the .ts packaging script exists (release-only packaging path)', () => {
    expect(fs.existsSync(BUILD_VSCODE_COMPANION_PATH)).toBe(true);
  });

  it('A6: companion .vscodeignore excludes node_modules from the VSIX', () => {
    const ignore = readFile('packages/vscode-ide-companion/.vscodeignore');
    expect(ignore.split('\n')).toContain('**');
  });
});
