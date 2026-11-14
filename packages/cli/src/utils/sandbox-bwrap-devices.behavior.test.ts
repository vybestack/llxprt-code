/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { buildBwrapMountArgs } from './sandbox-bwrap-policy.js';
import { runBwrapSandbox } from './sandbox-bwrap.js';

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
const gpuLaneRequired = process.env.LLXPRT_REQUIRE_GPU_TESTS === 'true';

function openable(node: string): boolean {
  try {
    fs.closeSync(
      fs.openSync(node, fs.constants.O_RDWR | fs.constants.O_NONBLOCK),
    );
    return true;
  } catch {
    return false;
  }
}

function discoverRenderNode(): string | undefined {
  if (!fs.existsSync('/dev/dri')) return undefined;
  return fs
    .readdirSync('/dev/dri')
    .filter((name) => name.startsWith('renderD'))
    .sort()
    .map((name) => `/dev/dri/${name}`)
    .find(openable);
}

function discoverDeniedDevice(): string | undefined {
  return fs
    .readdirSync('/dev')
    .map((name) => `/dev/${name}`)
    .filter((candidate) => {
      try {
        return fs.lstatSync(candidate).isCharacterDevice();
      } catch {
        return false;
      }
    })
    .find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
        return false;
      } catch {
        return true;
      }
    });
}

const renderNode = discoverRenderNode();
const deniedDevice = discoverDeniedDevice();
const hasVulkaninfo =
  spawnSync('vulkaninfo', ['--help'], { stdio: 'ignore', timeout: 5000 })
    .error === undefined;
const skipRender = skipBwrap || (renderNode === undefined && !gpuLaneRequired);
const skipVulkan = skipRender || (!hasVulkaninfo && !gpuLaneRequired);

const scratchRoots: string[] = [];

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1c-devices-'));
  scratchRoots.push(root);
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  return workspace;
}

function requireRenderNode(): string {
  if (renderNode === undefined) {
    throw new Error(
      'no accessible /dev/dri/renderD* node and LLXPRT_REQUIRE_GPU_TESTS=true',
    );
  }
  return renderNode;
}

function runInSandbox(
  devices: readonly string[] | undefined,
  command: readonly string[],
  timeout = 15000,
): SpawnSyncReturns<string> {
  const workspace = createWorkspace();
  const args = buildBwrapMountArgs({ workspaceRoot: workspace, devices });
  return spawnSync(
    'bwrap',
    [
      ...args,
      '--clearenv',
      '--setenv',
      'PATH',
      '/usr/bin:/bin',
      '--setenv',
      'HOME',
      os.homedir(),
      '--',
      ...command,
    ],
    {
      cwd: workspace,
      encoding: 'utf8',
      timeout,
      env: { PATH: '/usr/bin:/bin' },
    },
  );
}

const OPEN_RENDER_NODE = [
  'import os,sys',
  'fd=os.open(sys.argv[1],os.O_RDWR|os.O_CLOEXEC)',
  'os.close(fd)',
  'print("render-open=ok")',
].join('\n');

const GPU_TYPES = /PHYSICAL_DEVICE_TYPE_(INTEGRATED_GPU|DISCRETE_GPU)/;

describe('real bwrap device grants', () => {
  afterEach(() => {
    for (const root of scratchRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(skipBwrap)('keeps /dev/dri absent without a device grant', () => {
    const result = runInSandbox(undefined, [
      '/bin/sh',
      '-c',
      'test ! -e /dev/dri',
    ]);
    expect(result.status).toBe(0);
  });

  it.skipIf(skipRender)('opens only the explicitly granted render node', () => {
    const node = requireRenderNode();
    const result = runInSandbox(
      [node],
      ['/usr/bin/python3', '-c', OPEN_RENDER_NODE, node],
    );
    const listing = runInSandbox([node], ['/bin/ls', '/dev/dri']);

    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('render-open=ok');
    expect(listing.stdout.trim()).toBe(path.basename(node));
  });

  it.skipIf(skipRender)(
    'honors the explicit dri directory grant and keeps the fresh /dev baseline',
    () => {
      const node = requireRenderNode();
      const listing = runInSandbox(
        ['/dev/dri'],
        [
          '/bin/sh',
          '-c',
          'ls /dev/dri; test -c /dev/null; test ! -e /dev/input',
        ],
      );
      const opened = runInSandbox(
        ['/dev/dri'],
        ['/usr/bin/python3', '-c', OPEN_RENDER_NODE, node],
      );

      expect(listing.status).toBe(0);
      expect(listing.stdout.split('\n').filter(Boolean)).toStrictEqual(
        fs.readdirSync('/dev/dri').sort(),
      );
      expect(opened.stdout.trim()).toBe('render-open=ok');
    },
  );

  it.skipIf(skipRender)(
    'keeps driver enumeration paths readable and sysfs immutable',
    () => {
      const node = requireRenderNode();
      const { rdev } = fs.statSync(node);
      const major = Math.floor(rdev / 256) % 4096;
      const minor = rdev % 256;
      const result = runInSandbox(
        [node],
        [
          '/bin/sh',
          '-c',
          [
            `cat /sys/dev/char/${String(major)}:${String(minor)}/device/vendor >/dev/null`,
            'if touch /sys/devices/phase1c-probe 2>/dev/null; then exit 41; fi',
          ].join('; '),
        ],
      );
      expect(result.status).toBe(0);
    },
  );

  it.skipIf(skipVulkan)(
    'enumerates a hardware Vulkan adapter only with the grant',
    () => {
      const node = requireRenderNode();
      const without = runInSandbox(undefined, [
        '/usr/bin/vulkaninfo',
        '--summary',
      ]);
      const granted = runInSandbox(
        [node],
        ['/usr/bin/vulkaninfo', '--summary'],
      );

      expect(without.stdout).not.toMatch(GPU_TYPES);
      expect(granted.stdout).toMatch(GPU_TYPES);
      const expected = process.env.LLXPRT_GPU_TEST_EXPECT;
      if (expected !== undefined && expected !== '') {
        expect(granted.stdout).toContain(expected);
      }
    },
  );

  it.skipIf(skipBwrap || deniedDevice === undefined)(
    'fails closed when the launch user cannot access a requested device',
    () => {
      const workspace = createWorkspace();
      let message = '';
      try {
        buildBwrapMountArgs({
          workspaceRoot: workspace,
          devices: [deniedDevice ?? ''],
        });
      } catch (error) {
        if (error instanceof FatalSandboxError) message = error.message;
        else throw error;
      }
      expect(message).toContain(deniedDevice ?? '');
    },
  );

  it.skipIf(skipBwrap)(
    'rejects an ordinary mount that covers a granted device path',
    () => {
      const workspace = createWorkspace();
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1c-cover-'));
      scratchRoots.push(source);
      expect(() =>
        buildBwrapMountArgs({
          workspaceRoot: workspace,
          devices: ['/dev/null'],
          mounts: [{ from: source, to: '/dev/null', mode: 'rw' }],
        }),
      ).toThrow(FatalSandboxError);
    },
  );

  it('rejects a workspace root that would cover a granted device path', () => {
    expect(() =>
      buildBwrapMountArgs({ workspaceRoot: '/dev', devices: ['/dev/null'] }),
    ).toThrow(FatalSandboxError);
  });

  it.skipIf(skipBwrap || deniedDevice === undefined)(
    'rejects a denied device before any credential proxy or session directory exists',
    async () => {
      const before = fs
        .readdirSync(os.tmpdir())
        .filter((name) => name.startsWith('llxprt-bwrap-'));
      let rejection: unknown;
      try {
        await runBwrapSandbox(
          { command: 'bwrap', devices: [deniedDevice ?? ''] },
          [],
          undefined,
          ['node', 'llxprt'],
        );
      } catch (error) {
        rejection = error;
      }
      const after = fs
        .readdirSync(os.tmpdir())
        .filter((name) => name.startsWith('llxprt-bwrap-'));

      expect(rejection).toBeInstanceOf(FatalSandboxError);
      expect(after).toStrictEqual(before);
    },
  );
});
