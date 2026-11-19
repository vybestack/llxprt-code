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
