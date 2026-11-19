/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import * as policy from './sandbox-bwrap-policy.js';

/**
 * The bwrap policy masks fixed host paths with private tmpfs mounts before it
 * binds workspace roots. These cases cover roots and mount sources that would
 * reach a masked path through the host namespace.
 */

const scratchRoots: string[] = [];
const taskScratch = path.resolve(process.cwd(), '..', '..', '.work', 'phase1b');
const onLinux = process.platform === 'linux';

function createRoot(): string {
  fs.mkdirSync(taskScratch, { recursive: true });
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(taskScratch, 'masks-')),
  );
  scratchRoots.push(root);
  return root;
}

function directory(...segments: string[]): string {
  const target = path.join(...segments);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function removeScratchRoots(): void {
  for (const root of scratchRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('bwrap workspace roots and the masked system paths', () => {
  afterEach(removeScratchRoots);

  const maskedAndContaining = [
    '/tmp',
    '/run',
    '/var/tmp',
    '/var',
    '/home',
    '/root',
  ];

  for (const masked of maskedAndContaining) {
    it.skipIf(!onLinux || !fs.existsSync(masked))(
      `rejects ${masked} as the workspace`,
      () => {
        const home = directory(createRoot(), 'home');

        expect(() =>
          policy.buildBwrapMountArgs({ workspaceRoot: masked, homeDir: home }),
        ).toThrow(/protected root/);
      },
    );

    it.skipIf(!onLinux || !fs.existsSync(masked))(
      `rejects ${masked} as an include root`,
      () => {
        const root = createRoot();
        const home = directory(root, 'home');
        const workspace = directory(root, 'project');

        expect(() =>
          policy.buildBwrapMountArgs({
            workspaceRoot: workspace,
            includeRoots: [masked],
            homeDir: home,
          }),
        ).toThrow(/protected root/);
      },
    );
  }

  it.skipIf(!onLinux)(
    'keeps allowing a project directory below a masked path',
    () => {
      const home = directory(createRoot(), 'home');
      const project = fs.realpathSync(
        fs.mkdtempSync('/tmp/llxprt-policy-masks-'),
      );
      try {
        const args = policy.buildBwrapMountArgs({
          workspaceRoot: project,
          homeDir: home,
        });

        expect(args).toContain(project);
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
      }
    },
  );
});

describe('bwrap workspace roots and symlinked or missing mask paths', () => {
  afterEach(removeScratchRoots);

  function symlinkedMask(): {
    readonly home: string;
    readonly link: string;
    readonly target: string;
  } {
    const root = createRoot();
    const home = directory(root, 'home');
    const target = directory(root, 'srv', 'shared-tmp');
    directory(root, 'var');
    const link = path.join(root, 'var', 'tmp');
    fs.symlinkSync(path.join('..', 'srv', 'shared-tmp'), link);
    return { home, link, target };
  }

  it('rejects a root that is the canonical target of a symlinked mask path', () => {
    const { home, link, target } = symlinkedMask();
    const workspace = fs.realpathSync(link);

    expect(workspace).toBe(target);
    expect(() => policy.assertSafeWorkspace(workspace, home, [link])).toThrow(
      /protected root/,
    );
  });

  it('rejects a root that contains the canonical target of a symlinked mask path', () => {
    const { home, link, target } = symlinkedMask();

    expect(() =>
      policy.assertSafeWorkspace(path.dirname(target), home, [link]),
    ).toThrow(/protected root/);
  });

  it('rejects a root that contains the literal path of a symlinked mask path', () => {
    const { home, link } = symlinkedMask();

    expect(() =>
      policy.assertSafeWorkspace(path.dirname(link), home, [link]),
    ).toThrow(/protected root/);
  });

  it('compares the literal path when a mask path does not exist', () => {
    const root = createRoot();
    const home = directory(root, 'home');
    const missing = path.join(root, 'var', 'tmp');

    expect(() => policy.assertSafeWorkspace(root, home, [missing])).toThrow(
      /protected root/,
    );
    expect(() =>
      policy.assertSafeWorkspace(path.dirname(missing), home, [missing]),
    ).toThrow(/protected root/);
  });

  it('keeps allowing a project directory below a symlinked mask target', () => {
    const { home, link, target } = symlinkedMask();
    const project = directory(target, 'project');

    expect(() =>
      policy.assertSafeWorkspace(project, home, [link]),
    ).not.toThrow();
  });

  it('keeps allowing an unrelated directory when the mask path is a symlink', () => {
    const { home, link } = symlinkedMask();
    const project = directory(createRoot(), 'project');

    expect(() =>
      policy.assertSafeWorkspace(project, home, [link]),
    ).not.toThrow();
  });
});

describe('bwrap profile mount sources and the masked home', () => {
  afterEach(removeScratchRoots);

  it('rejects a mount source that contains the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'team', 'alice');
    const workspace = directory(root, 'project');

    expect(() =>
      policy.buildBwrapMountArgs({
        workspaceRoot: workspace,
        homeDir: home,
        mounts: [{ from: path.join(root, 'team'), to: '/opt/team' }],
      }),
    ).toThrow(/protected bwrap control path/);
  });

  it('rejects a mount source equal to the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'team', 'alice');
    const workspace = directory(root, 'project');

    expect(() =>
      policy.buildBwrapMountArgs({
        workspaceRoot: workspace,
        homeDir: home,
        mounts: [{ from: home, to: '/opt/alice' }],
      }),
    ).toThrow(/protected bwrap control path/);
  });

  it('keeps allowing a mount source below the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'team', 'alice');
    const workspace = directory(root, 'project');
    const shared = directory(home, 'shared');

    const args = policy.buildBwrapMountArgs({
      workspaceRoot: workspace,
      homeDir: home,
      mounts: [{ from: shared, to: '/opt/shared' }],
    });

    expect(args).toContain(shared);
  });
});
