/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'bun:test';
import { buildBwrapMountArgs } from './sandbox-bwrap-policy.js';

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
const bwrapAvailable = bwrapProbe?.status === 0;
const skipBwrap =
  process.platform !== 'linux' ||
  (!bwrapAvailable && process.env.LLXPRT_REQUIRE_BWRAP_TESTS !== 'true');
const scratchRoots: string[] = [];
const taskScratch = path.resolve(process.cwd(), '..', '..', '.work', 'phase1b');

function createFixture(): {
  readonly root: string;
  readonly workspace: string;
  readonly sibling: string;
  readonly readOnlySource: string;
} {
  fs.mkdirSync(taskScratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(taskScratch, 'behavior-'));
  scratchRoots.push(root);
  const workspace = path.join(root, 'workspace:with spaces');
  const sibling = path.join(root, 'sibling');
  fs.mkdirSync(workspace);
  fs.mkdirSync(sibling);
  const readOnlySource = path.join(sibling, 'readonly-canary');
  fs.writeFileSync(readOnlySource, 'keep this value\n');
  return { root, workspace, sibling, readOnlySource };
}

function removeScratchRoots(): void {
  for (const root of scratchRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('real bwrap workspace policy', () => {
  afterEach(removeScratchRoots);

  it.skipIf(skipBwrap)(
    'writes within the workspace, masks sibling paths, and keeps declared read-only mounts immutable',
    () => {
      const fixture = createFixture();
      const readOnlyPath = '/tmp/llxprt-bwrap-readonly-canary';
      const args = buildBwrapMountArgs({
        workspaceRoot: fixture.workspace,
        mounts: [
          {
            from: fixture.readOnlySource,
            to: readOnlyPath,
            mode: 'ro',
          },
        ],
      });
      const result = spawnSync(
        'bwrap',
        [
          ...args,
          '--clearenv',
          '--setenv',
          'PATH',
          '/usr/bin:/bin',
          '--',
          '/bin/sh',
          '-c',
          [
            'printf workspace > workspace-canary',
            'test ! -e ../sibling/readonly-canary',
            `if printf changed > ${readOnlyPath}; then exit 31; fi`,
            'printf private > /tmp/private-canary',
            'test ! -e /home/acoliver/.ssh',
          ].join('; '),
        ],
        {
          cwd: fixture.workspace,
          encoding: 'utf8',
          timeout: 5000,
          env: { PATH: '/usr/bin:/bin' },
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(
        fs.readFileSync(
          path.join(fixture.workspace, 'workspace-canary'),
          'utf8',
        ),
      ).toBe('workspace');
      expect(fs.readFileSync(fixture.readOnlySource, 'utf8')).toBe(
        'keep this value\n',
      );
      expect(fs.existsSync(path.join(fixture.root, 'private-canary'))).toBe(
        false,
      );
    },
  );

  it.skipIf(skipBwrap)(
    'launches the source-checkout CLI entry through the production bwrap launcher',
    () => {
      const fixture = createFixture();
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('../../index.ts', import.meta.url)),
          '--sandbox',
          '--sandbox-engine',
          'bwrap',
          '--version',
        ],
        {
          cwd: fixture.workspace,
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env, LLXPRT_REQUIRE_BWRAP_TESTS: 'true' },
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    },
    60_000,
  );

  it.skipIf(skipBwrap)(
    'keeps host networking on and blocks host TCP when networking is off',
    async () => {
      const fixture = createFixture();
      const server = net.createServer((socket) => socket.destroy());
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('expected a TCP listener address');
      }
      const script = [
        'import socket,sys; s=socket.socket(); s.settimeout(1);',
        'try: s.connect(("127.0.0.1", int(sys.argv[1]))); result=0',
        'except OSError: result=7',
        'print(result); s.close()',
      ].join('\n');
      const run = (network: 'on' | 'off') => {
        const args = buildBwrapMountArgs({
          workspaceRoot: fixture.workspace,
          network,
        });
        return spawnSync(
          'bwrap',
          [
            ...args,
            '--clearenv',
            '--',
            '/usr/bin/python3',
            '-c',
            script,
            String(address.port),
          ],
          {
            cwd: fixture.workspace,
            encoding: 'utf8',
            timeout: 5000,
            env: { PATH: '/usr/bin:/bin' },
          },
        );
      };

      const onResult = run('on');
      const offResult = run('off');
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });

      expect(onResult.status).toBe(0);
      expect(offResult.status).toBe(0);
      expect(onResult.stdout.trim()).toBe('0');
      expect(offResult.stdout.trim()).toBe('7');
    },
  );

  it.skipIf(skipBwrap)(
    'masks declared external credential and storage roots while preserving the workspace',
    () => {
      const fixture = createFixture();
      const privateRoot = fs.mkdtempSync(
        path.join(taskScratch, 'masked-root-'),
      );
      scratchRoots.push(privateRoot);
      fs.writeFileSync(path.join(privateRoot, 'credential-canary'), 'secret');
      const args = buildBwrapMountArgs({
        workspaceRoot: fixture.workspace,
        maskedRoots: [privateRoot],
      });
      const result = spawnSync(
        'bwrap',
        [
          ...args,
          '--',
          '/bin/sh',
          '-c',
          'test ! -e "$1/credential-canary" && printf masked',
          'probe',
          privateRoot,
        ],
        { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('masked');
      expect(
        fs.existsSync(path.join(fixture.workspace, 'credential-canary')),
      ).toBe(false);
    },
  );

  it.skipIf(skipBwrap)('hides host home and runtime entries', () => {
    const fixture = createFixture();
    const args = buildBwrapMountArgs({ workspaceRoot: fixture.workspace });
    const result = spawnSync(
      'bwrap',
      [
        ...args,
        '--clearenv',
        '--',
        '/bin/sh',
        '-c',
        'test ! -e /home/acoliver/.ssh && test ! -e /run/user/1000 && test -z "$DBUS_SESSION_BUS_ADDRESS"',
      ],
      {
        cwd: fixture.workspace,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: '/usr/bin:/bin',
          DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
        },
      },
    );

    expect(result.status).toBe(0);
  });

  it.skipIf(skipBwrap)(
    'ends detached descendants when its private PID namespace is torn down',
    async () => {
      const fixture = createFixture();
      const canary = path.join(fixture.workspace, 'detached-descendant-canary');
      const script = [
        'import subprocess,sys',
        'subprocess.Popen(["/bin/sh", "-c", \'sleep 0.5; printf alive > "$1"\', "descendant", sys.argv[1]], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)',
      ].join(';');
      const result = spawnSync(
        'bwrap',
        [
          '--unshare-user',
          '--unshare-pid',
          '--disable-userns',
          '--die-with-parent',
          '--ro-bind',
          '/',
          '/',
          '--dev',
          '/dev',
          '--bind',
          fixture.workspace,
          fixture.workspace,
          '--',
          '/usr/bin/python3',
          '-c',
          script,
          canary,
        ],
        {
          cwd: fixture.workspace,
          encoding: 'utf8',
          timeout: 5000,
          env: { PATH: '/usr/bin:/bin' },
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(fs.existsSync(canary)).toBe(false);
    },
  );

  it.skipIf(skipBwrap)(
    'keeps host D-Bus out while retaining workspace files and private temp',
    () => {
      const fixture = createFixture();
      const args = buildBwrapMountArgs({ workspaceRoot: fixture.workspace });
      const result = spawnSync(
        'bwrap',
        [
          ...args,
          '--clearenv',
          '--setenv',
          'PATH',
          '/usr/bin:/bin',
          '--',
          '/bin/sh',
          '-c',
          'test -z "$DBUS_SESSION_BUS_ADDRESS" && test ! -S /run/user/1000/bus && printf private > /tmp/runtime-canary',
        ],
        {
          cwd: fixture.workspace,
          encoding: 'utf8',
          timeout: 15000,
          env: {
            PATH: '/usr/bin:/bin',
            DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(fixture.root, 'runtime-canary'))).toBe(
        false,
      );
    },
  );
});

describe('bwrap protected destination validation', () => {
  afterEach(removeScratchRoots);

  it('allows profile mounts below a masked temporary root', () => {
    const fixture = createFixture();
    const args = buildBwrapMountArgs({
      workspaceRoot: fixture.workspace,
      mounts: [{ from: fixture.readOnlySource, to: '/tmp/llxprt-cache' }],
    });

    expect(args).toContain('/tmp/llxprt-cache');
  });

  it('rejects a profile mount that replaces a protected root ancestor', () => {
    const fixture = createFixture();
    expect(() =>
      buildBwrapMountArgs({
        workspaceRoot: fixture.workspace,
        mounts: [{ from: fixture.sibling, to: '/' }],
      }),
    ).toThrow(/protected bwrap control path/);
  });

  it('rejects a profile mount that exposes the entire host home through an alternate destination', () => {
    const fixture = createFixture();

    expect(() =>
      buildBwrapMountArgs({
        workspaceRoot: fixture.workspace,
        mounts: [{ from: '/home', to: '/tmp/exposed-home', mode: 'ro' }],
      }),
    ).toThrow(/protected|home/i);
  });

  it('rejects a profile mount that would reveal the host home over its masked view', () => {
    const fixture = createFixture();
    // The host home is whatever the policy is told it is (HOME by default), so
    // the test names its own instead of assuming the developer's account.
    const homeDir = path.join(fixture.root, 'host-home');
    fs.mkdirSync(homeDir);

    expect(() =>
      buildBwrapMountArgs({
        workspaceRoot: fixture.workspace,
        homeDir,
        mounts: [{ from: fixture.sibling, to: fs.realpathSync(homeDir) }],
      }),
    ).toThrow(/protected bwrap control path/);
  });
});

describe('bwrap SSH agent policy', () => {
  afterEach(removeScratchRoots);

  it('binds only the declared Unix agent socket at its private runtime path', async () => {
    const fixture = createFixture();
    const socketPath = path.join(fixture.root, 'agent.sock');
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    const args = buildBwrapMountArgs({
      workspaceRoot: fixture.workspace,
      sshAgentSocket: socketPath,
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    expect(args).toContain(socketPath);
    expect(args).toContain('/run/llxprt/ssh-agent.sock');
  });
});
