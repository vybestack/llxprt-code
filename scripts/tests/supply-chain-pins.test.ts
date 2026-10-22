/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Supply-chain configuration contract (issue #3930).
 *
 * These tests read the real repository configuration (bunfig.toml, .npmrc,
 * manifests, Dockerfile, workflows) and assert the invariants that keep the
 * runtime pins and the dependency cooldown coherent:
 *
 * - the dependency cooldown never blocks the Bun runtime or our own packages,
 * - Node and Bun pins agree across `.nvmrc`, `.bun-version`, the Dockerfile
 *   and the manifests,
 * - no workflow floats on an unpinned Node line.
 */

import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import TOML from '@iarna/toml';
import semver from 'semver';
import { asRecord, asString } from './typed-test-helpers.ts';

const repoRoot = resolve(__dirname, '..', '..');

function readText(...segments: string[]): string {
  return readFileSync(join(repoRoot, ...segments), 'utf8');
}

function readManifest(...segments: string[]): Record<string, unknown> {
  return asRecord(JSON.parse(readText(...segments, 'package.json')));
}

function manifestDirs(): string[] {
  const dirs = ['.'];
  for (const parent of ['packages', 'plugins']) {
    for (const entry of readdirSync(join(repoRoot, parent))) {
      if (existsSync(join(repoRoot, parent, entry, 'package.json'))) {
        dirs.push(join(parent, entry));
      }
    }
  }
  return dirs;
}

function npmrcValues(key: string): string[] {
  return readText('.npmrc')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1));
}

describe('dependency cooldown', () => {
  const bunInstall = asRecord(
    asRecord(TOML.parse(readText('bunfig.toml')))['install'],
  );
  const bunExcludes = bunInstall['minimumReleaseAgeExcludes'];

  it('bunfig.toml holds back versions younger than 3 days (seconds)', () => {
    expect(bunInstall['minimumReleaseAge']).toBe(3 * 24 * 60 * 60);
  });

  it('.npmrc holds back versions younger than 3 days (days)', () => {
    expect(npmrcValues('min-release-age')).toStrictEqual(['3']);
  });

  it('bunfig.toml exempts the Bun runtime and every @oven/bun-* package', () => {
    expect(Array.isArray(bunExcludes)).toBe(true);
    const excludes = new Set(bunExcludes as string[]);
    expect(excludes.has('bun')).toBe(true);

    const cli = readManifest('packages', 'cli');
    const ovenPackages = Object.keys(
      asRecord(cli['optionalDependencies']),
    ).filter((name) => name.startsWith('@oven/'));
    expect(ovenPackages.length).toBeGreaterThan(0);
    for (const name of ovenPackages) {
      expect(excludes.has(name), `${name} must bypass the cooldown`).toBe(true);
    }
  });

  it('bunfig.toml exempts every first-party package name', () => {
    const excludes = new Set(bunExcludes as string[]);
    for (const dir of manifestDirs()) {
      const name = asString(readManifest(dir)['name']);
      if (name.startsWith('@vybestack/')) {
        expect(excludes.has(name), `${name} must bypass the cooldown`).toBe(
          true,
        );
      }
    }
  });

  it('.npmrc exempts the Bun runtime and our own scope', () => {
    const excludes = npmrcValues('min-release-age-exclude[]');
    expect(excludes).toContain('bun');
    expect(excludes).toContain('@oven/bun-*');
    expect(excludes).toContain('@vybestack/*');
  });
});

describe('runtime pins agree', () => {
  const nvmrc = readText('.nvmrc').trim();
  const bunVersion = readText('.bun-version').trim();

  it('.nvmrc is an exact Node version', () => {
    expect(semver.valid(nvmrc)).toBe(nvmrc);
  });

  it('every manifest requires at least the pinned Node version', () => {
    const nodeRanges = manifestDirs()
      .map((dir) => ({
        dir,
        range: asRecord(readManifest(dir)['engines'] ?? {})['node'],
      }))
      .filter(
        (entry): entry is { dir: string; range: string } =>
          typeof entry.range === 'string' && entry.range.startsWith('>='),
      );
    expect(nodeRanges.length).toBeGreaterThan(0);
    for (const { dir, range } of nodeRanges) {
      expect(
        semver.gte(range.slice(2), nvmrc),
        `${dir}/package.json engines.node ${range} must not admit a Node below ${nvmrc}`,
      ).toBe(true);
    }
  });

  it('the Dockerfile base image is the pinned Node version', () => {
    const firstLine = readText('Dockerfile').split('\n')[0];
    expect(firstLine).toBe(`FROM docker.io/library/node:${nvmrc}-slim`);
  });

  it('.bun-version matches the bun dependency in the root and CLI manifests', () => {
    expect(semver.valid(bunVersion)).toBe(bunVersion);
    for (const dir of ['.', 'packages/cli']) {
      const dependencies = asRecord(readManifest(dir)['dependencies']);
      expect(dependencies['bun']).toBe(bunVersion);
    }
  });

  it('root engines.bun floor is the pinned Bun version', () => {
    const engines = asRecord(readManifest('.')['engines']);
    expect(engines['bun']).toBe(`>=${bunVersion}`);
  });

  it('plugin engines.bun floors do not admit a Bun below the pin', () => {
    for (const dir of manifestDirs().filter((d) => d.startsWith('plugins/'))) {
      const engines = asRecord(readManifest(dir)['engines']);
      const range = asString(engines['bun']);
      expect(semver.gte(range.replace('>=', ''), bunVersion)).toBe(true);
    }
  });
});

describe('workflows do not float on an unpinned runtime', () => {
  const workflowsDir = join(repoRoot, '.github', 'workflows');
  const workflows = readdirSync(workflowsDir).filter((file) =>
    file.endsWith('.yml'),
  );

  it('no workflow pins Node to a bare major line outside a matrix', () => {
    for (const file of workflows) {
      const lines = readFileSync(join(workflowsDir, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        // Matrix definitions sit deeper than step `with:` inputs; the matrix
        // consumers are required to set check-latest instead.
        if (/^ {10}node-version: '24(\.x)?'$/.test(line)) {
          throw new Error(
            `${file}:${index + 1} pins Node to a floating line; use node-version-file: .nvmrc`,
          );
        }
      });
    }
  });

  it('every matrix-driven setup-node step resolves the newest matching Node', () => {
    for (const file of workflows) {
      const text = readFileSync(join(workflowsDir, file), 'utf8');
      const steps = text.split(/\n(?= {6}- name:)/);
      for (const step of steps) {
        if (
          step.includes('actions/setup-node@') &&
          step.includes("node-version: '${{ matrix.node-version }}'")
        ) {
          expect(
            step,
            `${file} matrix setup-node needs check-latest`,
          ).toContain('check-latest: true');
        }
      }
    }
  });

  it('no workflow bootstraps a hardcoded Bun version', () => {
    for (const file of workflows) {
      const text = readFileSync(join(workflowsDir, file), 'utf8');
      expect(
        text,
        `${file} must read the Bun version from .bun-version`,
      ).not.toMatch(/bun-version: '[0-9]/);
      expect(
        text,
        `${file} must read the Bun version from .bun-version`,
      ).not.toMatch(/bash -s "bun-v[0-9]/);
    }
  });
});

describe('privileged workflows do not run third-party install scripts', () => {
  const privileged = [
    'release.yml',
    'build-sandbox.yml',
    'luther.yml',
    'e2e.yml',
  ];

  it('npm ci always skips lifecycle scripts', () => {
    for (const file of privileged) {
      const text = readText('.github', 'workflows', file);
      const installs = text.match(/npm ci\b[^\n]*/g) ?? [];
      expect(installs.length, `${file} installs with npm ci`).toBeGreaterThan(
        0,
      );
      for (const install of installs) {
        expect(install, `${file}: ${install}`).toContain('--ignore-scripts');
      }
    }
  });

  it('rollup platform packages are pinned to an exact version', () => {
    const workflowsDir = join(repoRoot, '.github', 'workflows');
    for (const file of readdirSync(workflowsDir)) {
      const text = readFileSync(join(workflowsDir, file), 'utf8');
      for (const match of text.match(/npm install @rollup\/rollup-[^\s]*/g) ??
        []) {
        expect(match, `${file}: ${match}`).toMatch(/@\d+\.\d+\.\d+$/);
      }
    }
  });
});
