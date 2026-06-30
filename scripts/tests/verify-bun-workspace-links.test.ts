/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyBunWorkspaceLinks } from '../verify-bun-workspace-links.mjs';

/**
 * How node_modules/<name> should be populated for a declared workspace:
 *  - 'link'    → a symlink back to the in-repo workspace directory (the only
 *                shape that proves a real LOCAL workspace link).
 *  - 'copy'    → a real directory standing in for a registry-fetched package
 *                of the same name (present, but NOT the local source).
 *  - 'missing' → no node_modules entry at all.
 */
type LinkMode = 'link' | 'copy' | 'missing';

interface WorkspaceSpec {
  /** Path under the fixture root, e.g. "packages/core". */
  path: string;
  /** The package name written into that workspace's package.json. */
  name: string;
  /** Whether to write the workspace's package.json on disk (default true). */
  createPkgJson?: boolean;
  /** How to populate node_modules/<name> (default 'link'). */
  link?: LinkMode;
}

const fixtures: string[] = [];

/**
 * Builds an isolated fixture repository whose `package.json` declares the given
 * workspaces and whose node_modules layout is populated per spec. The fixture
 * exercises the real {@link verifyBunWorkspaceLinks} against on-disk state, so
 * each test reproduces exactly what the CI smoke job inspects after an install.
 *
 * When `rawWorkspaces` is provided it is written verbatim as the `workspaces`
 * value (used to drive the vacuous-array and glob guards); otherwise the value
 * is derived from the concrete `specs`.
 */
function buildFixture(opts: {
  specs?: WorkspaceSpec[];
  rawWorkspaces?: unknown;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'verify-bun-links-'));
  fixtures.push(dir);

  const specs = opts.specs ?? [];
  const workspaces =
    'rawWorkspaces' in opts ? opts.rawWorkspaces : specs.map((s) => s.path);

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-root', workspaces }, null, 2),
  );

  for (const spec of specs) {
    const wsDir = join(dir, spec.path);
    mkdirSync(wsDir, { recursive: true });
    if (spec.createPkgJson !== false) {
      writeFileSync(
        join(wsDir, 'package.json'),
        JSON.stringify({ name: spec.name }, null, 2),
      );
    }

    const mode: LinkMode = spec.link ?? 'link';
    if (mode === 'missing') {
      continue;
    }

    const entry = join(dir, 'node_modules', spec.name);
    mkdirSync(dirname(entry), { recursive: true });
    if (mode === 'link') {
      // The correct shape: node_modules/<name> is a symlink to the in-repo
      // workspace, so realpath(entry) === realpath(workspace).
      symlinkSync(wsDir, entry, 'dir');
    } else {
      // 'copy' — a real directory simulating a same-named registry package.
      mkdirSync(entry, { recursive: true });
      writeFileSync(
        join(entry, 'package.json'),
        JSON.stringify({ name: spec.name }),
      );
    }
  }

  return dir;
}

/**
 * Runs the verifier with the process CWD pointed at `dir`, since the check
 * resolves `package.json` and `node_modules` relative to the working
 * directory. The original CWD is always restored.
 */
function runIn(dir: string): string[] {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return verifyBunWorkspaceLinks();
  } finally {
    process.chdir(original);
  }
}

afterEach(() => {
  while (fixtures.length > 0) {
    const dir = fixtures.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('verifyBunWorkspaceLinks', () => {
  it('returns no failures when every declared workspace is locally linked', () => {
    const dir = buildFixture({
      specs: [
        { path: 'packages/core', name: '@fixture/core', link: 'link' },
        { path: 'packages/cli', name: '@fixture/cli', link: 'link' },
      ],
    });

    expect(runIn(dir)).toStrictEqual([]);
  });

  it('fails on an empty workspaces array rather than passing vacuously', () => {
    // A zero-length list would make the verification loop run no iterations;
    // the guard must treat that as a hard failure so the CI job cannot pass
    // without actually checking anything.
    const dir = buildFixture({ rawWorkspaces: [] });

    const failures = runIn(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/non-empty `workspaces` array/);
  });

  it('fails when workspaces is not an array', () => {
    // A malformed declaration (e.g. a bare string) must also be rejected by the
    // vacuous-pass guard instead of being silently coerced.
    const dir = buildFixture({ rawWorkspaces: 'packages/core' });

    const failures = runIn(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/non-empty `workspaces` array/);
  });

  it('fails fast when a workspace entry is a glob pattern', () => {
    // The check resolves each entry as a literal directory and cannot expand
    // globs; a glob must produce an explicit, accurate error rather than a
    // misleading "no package.json on disk" further down.
    const dir = buildFixture({
      specs: [{ path: 'packages/core', name: '@fixture/core', link: 'link' }],
      rawWorkspaces: ['packages/core', 'packages/*'],
    });

    const failures = runIn(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/glob patterns/);
  });

  it('reports a declared workspace that has no package.json on disk', () => {
    const dir = buildFixture({
      specs: [
        {
          path: 'packages/core',
          name: '@fixture/core',
          createPkgJson: false,
          link: 'missing',
        },
      ],
    });

    const failures = runIn(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/no package\.json on disk/);
    expect(failures[0]).toMatch(/packages\/core/);
  });

  it('reports a workspace the manager produced no node_modules entry for', () => {
    const dir = buildFixture({
      specs: [
        { path: 'packages/core', name: '@fixture/core', link: 'missing' },
      ],
    });

    const failures = runIn(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/no node_modules entry/);
    expect(failures[0]).toMatch(/@fixture\/core/);
  });

  it('rejects a same-named registry copy that is not the local workspace', () => {
    // A bare existence check would accept this; the realpath comparison must
    // detect that node_modules/<name> resolves to a registry copy instead of
    // the in-repo workspace source.
    const dir = buildFixture({
      specs: [{ path: 'packages/core', name: '@fixture/core', link: 'copy' }],
    });

    const failures = runIn(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/did not link the LOCAL workspace/);
    expect(failures[0]).toMatch(/@fixture\/core/);
  });

  it('reports only the broken workspace when another is correctly linked', () => {
    // Mixed state: one good local link, one registry copy. The good workspace
    // must not appear in the diagnostics; only the broken one is reported.
    const dir = buildFixture({
      specs: [
        { path: 'packages/core', name: '@fixture/core', link: 'link' },
        { path: 'packages/cli', name: '@fixture/cli', link: 'copy' },
      ],
    });

    const failures = runIn(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/did not link the LOCAL workspace/);
    expect(failures[0]).toMatch(/@fixture\/cli/);
    expect(failures[0]).not.toMatch(/@fixture\/core/);
  });

  it('reports a workspace whose package.json is malformed instead of throwing', () => {
    // A corrupt workspace manifest must be funneled into the failure list (the
    // verifier's contract), not raised as an unhandled SyntaxError that crashes
    // the CI job with a raw stack trace.
    const dir = buildFixture({
      specs: [{ path: 'packages/core', name: '@fixture/core', link: 'link' }],
    });
    writeFileSync(join(dir, 'packages/core', 'package.json'), '{ not valid');

    const failures = runIn(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/Could not parse package\.json/);
    expect(failures[0]).toMatch(/packages\/core/);
  });
});
