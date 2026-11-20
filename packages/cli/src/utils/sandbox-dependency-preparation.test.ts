/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavior tests for the separate source-checkout preparation run (#3573
 * review round): its argv, which has to carry the installer's network,
 * environment and user settings but no credential, and the script it runs,
 * which these tests execute under real bash with stand-in `bun` executables.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSourceDependencyPreparationCommand,
  buildSourceDependencyPreparationRunArgs,
  type SourceDependencyPreparationPlan,
} from './sandbox-dependency-preparation.js';

const POSIX = process.platform !== 'win32';

const PLAN: SourceDependencyPreparationPlan = {
  engine: 'docker',
  image: 'sandbox-image:1',
  containerName: 'sandbox-node-modules-run-0-prep',
  runId: 'run-id-1',
  workdir: '/work/repo',
  containerWorkdir: '/work/repo',
  includeRoots: ['/work/extra'],
  dependencyMounts: [
    'type=volume,src=vol-0,dst=/work/repo/node_modules',
    'type=volume,src=vol-1,dst=/work/repo/packages/a/node_modules',
  ],
  userFlag: '',
};

function values(args: readonly string[], flag: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === flag) found.push(args[index + 1]);
  }
  return found;
}

describe('buildSourceDependencyPreparationRunArgs', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of [
      'SANDBOX_FLAGS',
      'SANDBOX_ENV',
      'LLXPRT_SANDBOX_NETWORK',
      'SANDBOX_NETWORK',
      'LLXPRT_SANDBOX_PROXY_COMMAND',
      'LLXPRT_SANDBOX_CPUS',
      'SANDBOX_CPUS',
      'LLXPRT_SANDBOX_MEMORY',
      'SANDBOX_MEMORY',
      'LLXPRT_SANDBOX_PIDS',
      'SANDBOX_PIDS',
      'NO_PROXY',
      'no_proxy',
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'SANDBOX_PORTS',
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('is a one-shot hardened run of the same image with the planned mounts and labels', () => {
    const args = buildSourceDependencyPreparationRunArgs(PLAN);

    expect(args.slice(0, 4)).toStrictEqual([
      'run',
      '--rm',
      '--init',
      '--workdir',
    ]);
    expect(values(args, '--workdir')).toStrictEqual(['/work/repo']);
    expect(args).toContain('--cap-drop=ALL');
    expect(values(args, '--security-opt')).toContain('no-new-privileges');
    expect(values(args, '--name')).toStrictEqual([PLAN.containerName]);
    expect(values(args, '--volume')).toStrictEqual([
      '/work/repo:/work/repo',
      '/work/extra:/work/extra',
    ]);
    expect(values(args, '--mount')).toStrictEqual([...PLAN.dependencyMounts]);
    expect(values(args, '--label')).toContain(
      'com.vybestack.llxprt.sandbox-dependency-run=run-id-1',
    );
    expect(values(args, '--label')).toContain(
      'com.vybestack.llxprt.sandbox-managed=true',
    );
    const imageIndex = args.indexOf('sandbox-image:1');
    expect(imageIndex).toBeGreaterThan(0);
    expect(args.slice(imageIndex + 1, imageIndex + 7)).toStrictEqual([
      'env',
      '-u',
      'BASH_ENV',
      'bash',
      '--noprofile',
      '--norc',
    ]);
    expect(args.at(-1)).toBe(buildSourceDependencyPreparationCommand().at(-1));
  });

  it('carries no stdin, terminal, device, port or credential setting', () => {
    process.env.SANDBOX_PORTS = '3000';
    process.env.SSH_AUTH_SOCK = '/tmp/agent';
    const args = buildSourceDependencyPreparationRunArgs(PLAN);
    const text = args.join('\n');

    for (const forbidden of ['-i', '-t', '--publish', '--device']) {
      expect(args).not.toContain(forbidden);
    }
    expect(text).not.toContain('CAPABILITY');
    expect(text).not.toContain('LLXPRT_CREDENTIAL_SOCKET');
    expect(text).not.toContain('SSH_AUTH_SOCK');
    expect(text).not.toContain('--env-file');
    expect(text).not.toContain('llxprt-capability');
  });

  it('runs as the current user directly, with a writable HOME, when the launch drops to that user', () => {
    const args = buildSourceDependencyPreparationRunArgs({
      ...PLAN,
      userFlag: '--user 1000:1000',
    });

    expect(values(args, '--user')).toStrictEqual(['1000:1000']);
    expect(values(args, '--env')).toContain('HOME=/tmp');
  });

  it('keeps the image default user and HOME when no current-user switch is selected', () => {
    const args = buildSourceDependencyPreparationRunArgs(PLAN);

    expect(args).not.toContain('--user');
    expect(
      values(args, '--env').filter((e) => e.startsWith('HOME=')),
    ).toStrictEqual([]);
  });

  it('applies the user SANDBOX_FLAGS and resource limits that the main container gets', () => {
    process.env.SANDBOX_FLAGS = '--dns 10.0.0.1';
    process.env.SANDBOX_MEMORY = '2g';

    const args = buildSourceDependencyPreparationRunArgs(PLAN);

    expect(values(args, '--dns')).toStrictEqual(['10.0.0.1']);
    expect(values(args, '--memory')).toStrictEqual(['2g']);
  });

  it('passes the user SANDBOX_ENV entries and not the host environment', () => {
    process.env.SANDBOX_ENV = 'REGISTRY_TOKEN=abc,OTHER=1';
    process.env.GEMINI_API_KEY = 'host-secret';

    const args = buildSourceDependencyPreparationRunArgs(PLAN);

    expect(values(args, '--env')).toStrictEqual(
      expect.arrayContaining(['REGISTRY_TOKEN=abc', 'OTHER=1']),
    );
    expect(args.join('\n')).not.toContain('host-secret');
  });

  it('has no network at all when the sandbox network is off', () => {
    process.env.LLXPRT_SANDBOX_NETWORK = 'off';

    const args = buildSourceDependencyPreparationRunArgs(PLAN);

    expect(values(args, '--network')).toStrictEqual(['none']);
  });

  it('joins the internal sandbox network with the proxy settings in proxied mode', () => {
    process.env.LLXPRT_SANDBOX_NETWORK = 'proxied';
    process.env.LLXPRT_SANDBOX_PROXY_COMMAND = 'run-proxy';
    process.env.HTTPS_PROXY = 'http://localhost:8877';
    process.env.NO_PROXY = 'internal.example';

    const args = buildSourceDependencyPreparationRunArgs(PLAN);

    expect(values(args, '--network')).toStrictEqual(['llxprt-code-sandbox']);
    const env = values(args, '--env');
    expect(env).toContain('HTTPS_PROXY=http://llxprt-code-sandbox-proxy:8877/');
    expect(env).toContain('http_proxy=http://llxprt-code-sandbox-proxy:8877/');
    expect(env).toContain('NO_PROXY=internal.example');
  });
});

function findHostTool(name: string): string {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (dir !== '' && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Host tool '${name}' is not on PATH`);
}

describe('the preparation script', () => {
  describe.skipIf(!POSIX)('under real bash', () => {
    let root = '';
    let repo = '';
    let binDir = '';
    let toolsDir = '';

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-prep-script-'));
      repo = path.join(root, 'repo');
      binDir = path.join(root, 'bin');
      toolsDir = path.join(root, 'tools');
      fs.mkdirSync(repo);
      fs.mkdirSync(binDir);
      fs.mkdirSync(toolsDir);
      // The script's command is `env ... bash ...`; these two are the only
      // host tools it needs. Nothing else from the host PATH is reachable, so
      // a Bun installed in /usr/bin or /bin cannot leak into a case.
      for (const tool of ['env', 'bash']) {
        fs.symlinkSync(findHostTool(tool), path.join(toolsDir, tool));
      }
      fs.writeFileSync(path.join(repo, 'package.json'), '{}\n');
      fs.writeFileSync(path.join(repo, 'bun.lock'), '{}\n');
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    function installBun(exitCode: number): string {
      const record = path.join(root, 'bun-args.txt');
      fs.writeFileSync(
        path.join(binDir, 'bun'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$@" > ${JSON.stringify(record)}`,
          `exit ${exitCode}`,
        ].join('\n'),
        { mode: 0o755 },
      );
      return record;
    }

    function runScript(): { status: number | null; stderr: string } {
      const [command, ...args] = buildSourceDependencyPreparationCommand();
      const result = spawnSync(command, args, {
        cwd: repo,
        encoding: 'utf8',
        // No Bun except the stand-in in binDir, whatever the host has.
        env: { PATH: `${binDir}${path.delimiter}${toolsDir}` },
      });
      return { status: result.status, stderr: result.stderr };
    }

    it('installs without saving and exits 0', () => {
      const record = installBun(0);

      expect(runScript().status).toBe(0);
      expect(fs.readFileSync(record, 'utf8')).toBe('install\n--no-save\n');
    });

    it('exits 1 when the install fails', () => {
      installBun(17);

      expect(runScript().status).toBe(1);
    });

    it('exits 64 before installing when package.json or bun.lock is missing', () => {
      const record = installBun(0);
      fs.rmSync(path.join(repo, 'bun.lock'));

      expect(runScript().status).toBe(64);
      expect(fs.existsSync(record)).toBe(false);
    });

    it('exits 65 when the image has no Bun', () => {
      expect(runScript().status).toBe(65);
    });
  });
});
