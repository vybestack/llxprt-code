/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import * as policy from './sandbox-bwrap-policy.js';

const bwrapProbe =
  process.platform === 'linux'
    ? spawnSync(
        'bwrap',
        [
          '--unshare-user',
          '--unshare-pid',
          '--disable-userns',
          '--ro-bind',
          '/',
          '/',
          '--',
          '/bin/true',
        ],
        { stdio: 'ignore', timeout: 1500 },
      )
    : undefined;
const skipBwrap =
  process.platform !== 'linux' ||
  (bwrapProbe?.status !== 0 &&
    process.env.LLXPRT_REQUIRE_BWRAP_TESTS !== 'true');

const scratchRoots: string[] = [];
const taskScratch = path.resolve(process.cwd(), '..', '..', '.work', 'phase1b');

function createRoot(): string {
  fs.mkdirSync(taskScratch, { recursive: true });
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(taskScratch, 'policy-')),
  );
  scratchRoots.push(root);
  return root;
}

function directory(...segments: string[]): string {
  const target = path.join(...segments);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('bwrap workspace overlap detection', () => {
  it('rejects an include root whose name starts with two dots but lies inside the workspace', () => {
    const root = createRoot();
    const home = directory(root, 'home');
    const workspace = directory(root, 'project');
    const nested = directory(workspace, '..cache');

    expect(() =>
      policy.buildBwrapMountArgs({
        workspaceRoot: workspace,
        includeRoots: [nested],
        homeDir: home,
      }),
    ).toThrow(/overlap/);
  });

  it('rejects a workspace whose name starts with two dots but lies inside protected storage', () => {
    const root = createRoot();
    const home = directory(root, 'home');
    const storage = directory(root, 'storage');
    const workspace = directory(storage, '..work');

    expect(() =>
      policy.buildBwrapMountArgs({
        workspaceRoot: workspace,
        homeDir: home,
        maskedRoots: [storage],
      }),
    ).toThrow(/protected host storage/);
  });

  it('accepts sibling roots whose names start with two dots', () => {
    const root = createRoot();
    const home = directory(root, 'home');
    const workspace = directory(root, 'project');
    const sibling = directory(root, '..sibling');

    const args = policy.buildBwrapMountArgs({
      workspaceRoot: workspace,
      includeRoots: [sibling],
      homeDir: home,
    });

    expect(args).toContain(sibling);
  });
});

describe('bwrap workspace roots and the masked home', () => {
  it('rejects a workspace that contains the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'team', 'alice');

    expect(() =>
      policy.buildBwrapMountArgs({
        workspaceRoot: path.join(root, 'team'),
        homeDir: home,
      }),
    ).toThrow(/protected root/);
  });

  it('rejects an include root that contains the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'team', 'alice');
    const workspace = directory(root, 'project');

    expect(() =>
      policy.buildBwrapMountArgs({
        workspaceRoot: workspace,
        includeRoots: [path.join(root, 'team')],
        homeDir: home,
      }),
    ).toThrow(/protected root/);
  });

  it('keeps allowing a project below the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'team', 'alice');
    const workspace = directory(home, 'projects', 'app');

    const args = policy.buildBwrapMountArgs({
      workspaceRoot: workspace,
      homeDir: home,
    });

    expect(args).toContain(workspace);
  });
});

describe('bwrap runtime roots inside the workspace', () => {
  it.skipIf(skipBwrap)(
    'keeps a runtime root read-only while the rest of the workspace stays writable',
    () => {
      const root = createRoot();
      const home = directory(root, 'home');
      const checkout = directory(root, 'checkout');
      const runtime = directory(checkout, 'packages');
      fs.writeFileSync(path.join(runtime, 'source.js'), 'original\n');
      const args = policy.buildBwrapMountArgs({
        workspaceRoot: checkout,
        homeDir: home,
        runtimeRoots: [runtime],
      });

      const result = spawnSync(
        'bwrap',
        [
          ...args,
          '--clearenv',
          '--',
          '/bin/sh',
          '-c',
          [
            'printf kept > workspace-file',
            'if printf changed > packages/source.js; then exit 31; fi',
            'if printf planted > packages/planted.js; then exit 32; fi',
          ].join('; '),
        ],
        {
          cwd: checkout,
          encoding: 'utf8',
          timeout: 10_000,
          env: { PATH: '/usr/bin:/bin' },
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(
        fs.readFileSync(path.join(checkout, 'workspace-file'), 'utf8'),
      ).toBe('kept');
      expect(fs.readFileSync(path.join(runtime, 'source.js'), 'utf8')).toBe(
        'original\n',
      );
      expect(fs.existsSync(path.join(runtime, 'planted.js'))).toBe(false);
    },
    30_000,
  );

  it.skipIf(skipBwrap)(
    'leaves a runtime root outside the workspace read-only',
    () => {
      const root = createRoot();
      const home = directory(root, 'home');
      const workspace = directory(root, 'project');
      const runtime = directory(root, 'runtime');
      const args = policy.buildBwrapMountArgs({
        workspaceRoot: workspace,
        homeDir: home,
        runtimeRoots: [runtime],
      });

      const result = spawnSync(
        'bwrap',
        [
          ...args,
          '--clearenv',
          '--',
          '/bin/sh',
          '-c',
          `if printf changed > ${runtime}/file; then exit 31; fi`,
        ],
        {
          cwd: workspace,
          encoding: 'utf8',
          timeout: 10_000,
          env: { PATH: '/usr/bin:/bin' },
        },
      );

      expect(result.status).toBe(0);
    },
    30_000,
  );
});

describe('bwrap storage roots that need their own mask', () => {
  it('masks the real directory behind a symbolic link that leaves the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'home');
    const outside = directory(root, 'outside-data');
    const link = path.join(home, 'data-link');
    fs.symlinkSync(outside, link);

    expect(policy.storageRootsRequiringMask([link], home)).toStrictEqual([
      outside,
    ]);
  });

  it('leaves out a storage root that the home mask already hides', () => {
    const root = createRoot();
    const home = directory(root, 'home');
    const inside = directory(home, '.local', 'share', 'llxprt-code');

    expect(policy.storageRootsRequiringMask([inside], home)).toStrictEqual([]);
  });

  it('leaves out a symbolic link whose target stays inside the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'home');
    const target = directory(home, 'real-data');
    const link = path.join(home, 'data-link');
    fs.symlinkSync(target, link);

    expect(policy.storageRootsRequiringMask([link], home)).toStrictEqual([]);
  });

  it('masks a plain storage root outside the home directory', () => {
    const root = createRoot();
    const home = directory(root, 'home');
    const outside = directory(root, 'xdg-data');

    expect(policy.storageRootsRequiringMask([outside], home)).toStrictEqual([
      outside,
    ]);
  });

  it('resolves the home directory before comparing, so a linked home hides its storage', () => {
    const root = createRoot();
    const realHome = directory(root, 'real-home');
    const linkedHome = path.join(root, 'linked-home');
    fs.symlinkSync(realHome, linkedHome);
    const storage = directory(realHome, 'data');

    expect(
      policy.storageRootsRequiringMask([storage], linkedHome),
    ).toStrictEqual([]);
  });
});
