/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runCoordinatedWorkspaceBuild } from '../build.ts';
import { prepareWorkspaceBuild } from '../prepare-workspace-build.ts';

interface WorkspaceFixture {
  readonly path: string;
  readonly name: string;
}

const fixtureRoots: string[] = [];

function addWorkspace(root: string, workspace: WorkspaceFixture): string {
  const workspaceDir = resolve(root, workspace.path);
  mkdirSync(join(workspaceDir, 'dist'), { recursive: true });
  writeFileSync(
    join(workspaceDir, 'package.json'),
    JSON.stringify({ name: workspace.name }),
  );
  writeFileSync(join(workspaceDir, 'dist', 'stale.js'), 'stale');
  const link = join(root, 'node_modules', workspace.name);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(
    workspaceDir,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return workspaceDir;
}

function createFixture(
  workspaces: unknown,
  workspaceFixtures: readonly WorkspaceFixture[] = [],
): string {
  const container = mkdtempSync(join(tmpdir(), 'prepare-workspace-build-'));
  fixtureRoots.push(container);
  const root = join(container, 'repo');
  mkdirSync(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, workspaces }),
  );

  for (const workspace of workspaceFixtures) {
    addWorkspace(root, workspace);
  }

  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('prepareWorkspaceBuild', () => {
  it('removes every declared workspace dist before returning', () => {
    const workspaces = [
      { path: 'packages/alpha', name: '@fixture/alpha' },
      { path: 'packages/beta', name: '@fixture/beta' },
    ] as const;
    const root = createFixture(
      workspaces.map(({ path }) => path),
      workspaces,
    );

    prepareWorkspaceBuild(root);

    expect(
      workspaces.map(({ path }) => existsSync(join(root, path, 'dist'))),
    ).toEqual([false, false]);
  });

  it('coordinates preparation, generation, compilation, and verification in order', () => {
    const effects: string[] = [];

    runCoordinatedWorkspaceBuild({
      prepare: () => effects.push('prepared'),
      generate: () => effects.push('generated'),
      compile: () => effects.push('compiled'),
      verify: () => effects.push('verified'),
    });

    expect(effects).toEqual(['prepared', 'generated', 'compiled', 'verified']);
  });

  it('stops the coordinated build when preparation fails', () => {
    const effects: string[] = [];

    expect(() =>
      runCoordinatedWorkspaceBuild({
        prepare: () => {
          effects.push('prepare-attempted');
          throw new Error('workspace gate failed');
        },
        generate: () => effects.push('generated'),
        compile: () => effects.push('compiled'),
        verify: () => effects.push('verified'),
      }),
    ).toThrow('workspace gate failed');
    expect(effects).toEqual(['prepare-attempted']);
  });

  it('propagates generation failures after preparation and stops fanout', () => {
    const effects: string[] = [];

    expect(() =>
      runCoordinatedWorkspaceBuild({
        prepare: () => effects.push('prepared'),
        generate: () => {
          effects.push('generate-attempted');
          throw new Error('generation failed');
        },
        compile: () => effects.push('compiled'),
        verify: () => effects.push('verified'),
      }),
    ).toThrow('generation failed');
    expect(effects).toEqual(['prepared', 'generate-attempted']);
  });

  it('propagates compilation failures and skips verification', () => {
    const effects: string[] = [];

    expect(() =>
      runCoordinatedWorkspaceBuild({
        prepare: () => effects.push('prepared'),
        generate: () => effects.push('generated'),
        compile: () => {
          effects.push('compile-attempted');
          throw new Error('compilation failed');
        },
        verify: () => effects.push('verified'),
      }),
    ).toThrow('compilation failed');
    expect(effects).toEqual(['prepared', 'generated', 'compile-attempted']);
  });

  it('keeps the build:packages entry point in the coordinated order', () => {
    const repoRoot = join(__dirname, '..', '..');
    const rootPackage: unknown = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    );
    if (typeof rootPackage !== 'object' || rootPackage === null) {
      throw new Error('Expected root package.json to contain an object.');
    }
    const scripts = Reflect.get(rootPackage, 'scripts');
    if (typeof scripts !== 'object' || scripts === null) {
      throw new Error(
        'Expected root package.json scripts to contain an object.',
      );
    }
    const buildPackages = Reflect.get(scripts, 'build:packages');
    if (typeof buildPackages !== 'string') {
      throw new Error('Expected a build:packages script.');
    }

    expect(buildPackages.split(' && ')).toEqual([
      'bun scripts/prepare-workspace-build.ts',
      'npm run generate',
      'npm run build --workspaces',
      'bun scripts/verify-lazy-mcp-build-coherence.ts',
    ]);
  });

  it('runs the installed workspace-link gate before deleting output', () => {
    const workspaces = [
      { path: 'packages/alpha', name: '@fixture/alpha' },
    ] as const;
    const root = createFixture(
      workspaces.map(({ path }) => path),
      workspaces,
    );
    rmSync(join(root, 'node_modules', '@fixture', 'alpha'));

    expect(() => prepareWorkspaceBuild(root)).toThrow(
      /no node_modules entry.*@fixture\/alpha/s,
    );
    expect(existsSync(join(root, 'packages/alpha/dist/stale.js'))).toBe(true);
  });

  it('rejects a path-shaped package name without deleting output', () => {
    const workspace = { path: 'packages/alpha', name: '@fixture/alpha' };
    const root = createFixture([workspace.path], [workspace]);
    writeFileSync(
      join(root, workspace.path, 'package.json'),
      JSON.stringify({ name: '../packages/alpha' }),
    );
    rmSync(join(root, 'node_modules', '@fixture', 'alpha'));

    expect(() => prepareWorkspaceBuild(root)).toThrow(/invalid package name/i);
    expect(existsSync(join(root, workspace.path, 'dist', 'stale.js'))).toBe(
      true,
    );
  });

  it('rejects an empty workspace entry without deleting repository output', () => {
    const root = createFixture(['']);
    const marker = join(root, 'dist', 'keep.js');
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, 'keep');

    expect(() => prepareWorkspaceBuild(root)).toThrow(/empty/i);
    expect(existsSync(marker)).toBe(true);
  });

  it('rejects an absolute workspace entry without deleting outside output', () => {
    const root = createFixture([]);
    const outside = addWorkspace(root, {
      path: '../absolute-outside',
      name: '@fixture/absolute-outside',
    });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        workspaces: [outside],
      }),
    );

    expect(() => prepareWorkspaceBuild(root)).toThrow(/absolute/i);
    expect(existsSync(join(outside, 'dist', 'stale.js'))).toBe(true);
  });

  it('rejects traversal without deleting outside output', () => {
    const root = createFixture(
      ['../traversal-outside'],
      [
        {
          path: '../traversal-outside',
          name: '@fixture/traversal-outside',
        },
      ],
    );
    const marker = join(dirname(root), 'traversal-outside', 'dist', 'stale.js');

    expect(() => prepareWorkspaceBuild(root)).toThrow(/child|repository/i);
    expect(existsSync(marker)).toBe(true);
  });

  it('rejects a workspace link that escapes the checkout without deleting outside output', () => {
    const root = createFixture([]);
    const outside = addWorkspace(root, {
      path: '../linked-outside',
      name: '@fixture/linked-outside',
    });
    const workspaceLink = join(root, 'packages', 'linked-outside');
    mkdirSync(dirname(workspaceLink), { recursive: true });
    symlinkSync(
      outside,
      workspaceLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        workspaces: ['packages/linked-outside'],
      }),
    );

    expect(() => prepareWorkspaceBuild(root)).toThrow(
      /outside the repository/i,
    );
    expect(existsSync(join(outside, 'dist', 'stale.js'))).toBe(true);
  });

  for (const malformed of [
    { label: 'missing', manifest: undefined },
    { label: 'empty', manifest: [] },
    { label: 'non-array', manifest: 'packages/alpha' },
    { label: 'glob-based', manifest: ['packages/*'] },
  ] as const) {
    it(`rejects a ${malformed.label} workspace declaration`, () => {
      const root = createFixture(malformed.manifest);
      if (malformed.manifest === undefined) {
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({ name: 'fixture', private: true }),
        );
      }

      expect(() => prepareWorkspaceBuild(root)).toThrow(/workspaces|glob/i);
    });
  }
});
