/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadRuntimePlugins } from '@vybestack/llxprt-code-providers/composition.js';
import { FIRST_PARTY_RUNTIME_PLUGIN_RELEASES } from '../utils/release-packages.ts';
import { asRecord } from './typed-test-helpers.ts';

const repoRoot = resolve(import.meta.dirname, '../..');
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function fixture(checkout: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'checkout-plugin-install-'));
  fixtures.push(root);
  mkdirSync(join(root, 'node_modules'));
  mkdirSync(join(root, 'scripts', 'utils'), { recursive: true });
  for (const file of ['postinstall.cjs', 'detect-installer.cjs']) {
    cpSync(join(repoRoot, 'scripts', file), join(root, 'scripts', file));
  }
  const installer = join(repoRoot, 'scripts', 'install-checkout-plugins.ts');
  if (existsSync(installer)) {
    cpSync(installer, join(root, 'scripts', 'install-checkout-plugins.ts'));
  }
  cpSync(
    join(repoRoot, 'scripts', 'utils', 'release-packages.ts'),
    join(root, 'scripts', 'utils', 'release-packages.ts'),
  );
  cpSync(join(repoRoot, 'package.json'), join(root, 'package.json'));
  cpSync(join(repoRoot, 'package-lock.json'), join(root, 'package-lock.json'));
  if (checkout) mkdirSync(join(root, '.git'));
  for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
    cpSync(join(repoRoot, release.dir), join(root, release.dir), {
      recursive: true,
      filter: (source) => !source.split(/[\\/]/).includes('node_modules'),
    });
  }
  return root;
}

function postinstall(
  root: string,
  environment: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawnSync> {
  const node = Bun.which('node');
  if (node === null)
    throw new Error('Node is required for the npm lifecycle fixture');
  return spawnSync(node, [join(root, 'scripts', 'postinstall.cjs')], {
    cwd: root,
    env: {
      ...process.env,
      npm_config_user_agent: 'npm/11.6.2',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

describe('checkout postinstall plugin contexts', () => {
  it('keeps source-package consumers base-only even when plugin sources are present', () => {
    const root = fixture(false);
    const result = postinstall(root);
    expect(result.status).toBe(0);
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      expect(existsSync(join(root, release.dir, 'node_modules'))).toBe(false);
    }
  });

  it('reports cleanup failure context without replacing the error or repeating deletion', () => {
    const root = fixture(true);
    const preload = join(root, 'cleanup-failure.ts');
    const observed = join(root, 'cleanup-observed.json');
    writeFileSync(
      preload,
      `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
if (process.argv[1]?.endsWith('install-checkout-plugins.ts')) {
  const remove = fs.rmSync;
  const failure = Object.assign(new Error('fixture cleanup permission denied'), {
    code: 'EPERM', errno: 1, syscall: 'rm',
  });
  let attempts = 0;
  fs.rmSync = (...args: Parameters<typeof fs.rmSync>): void => {
    if (String(args[0]).includes('plugin-installer-')) {
      attempts += 1;
      throw failure;
    }
    remove(...args);
  };
  syncBuiltinESMExports();
  process.on('uncaughtExceptionMonitor', (error) => {
    fs.writeFileSync(${JSON.stringify(observed)}, JSON.stringify({
      sameError: error === failure, attempts,
    }));
  });
}
`,
    );
    const result = postinstall(root, {
      PATH: '',
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    });
    expect(result.status).not.toBe(0);
    expect(JSON.parse(readFileSync(observed, 'utf8'))).toEqual({
      sameError: true,
      attempts: 1,
    });
    const prefix = '[checkout-plugin-cleanup] ';
    const line = result.stderr
      ?.toString()
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(prefix));
    expect(line).toBeDefined();
    if (line === undefined) throw new Error('Missing cleanup failure context');
    const diagnostic = asRecord(JSON.parse(line.slice(prefix.length)));
    const toolRoot = diagnostic['toolRoot'];
    expect(typeof toolRoot).toBe('string');
    expect(diagnostic['cwd']).toBe(realpathSync(root));
    expect(diagnostic['pid']).toEqual(expect.any(Number));
    expect(diagnostic['parentPid']).toEqual(expect.any(Number));
    expect(diagnostic['platform']).toBe(process.platform);
    const commands = diagnostic['commands'];
    if (!Array.isArray(commands)) throw new Error('Missing installer commands');
    expect(commands).toHaveLength(1);
    const command = asRecord(commands[0]);
    expect(command['command']).toBe('curl');
    expect(command['cwd']).toBe(toolRoot);
    expect(command['status']).toBeNull();
    expect(command['signal']).toBeNull();
    expect(command['error']).toContain('ENOENT');
    expect(command['args']).toContain('--output');
    expect(result.stderr?.toString()).toContain(
      'fixture cleanup permission denied',
    );
  });

  it('fails checkout setup when the pinned installer cannot be acquired', () => {
    const root = fixture(true);
    const result = postinstall(root, { PATH: '' });
    expect(result.status).not.toBe(0);
    expect(result.stderr?.toString()).toContain('curl');
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      expect(existsSync(join(root, release.dir, 'node_modules'))).toBe(false);
    }
  });
  it('identifies the runtime and private executable after successful commands without hiding cleanup failure', () => {
    const root = fixture(true);
    const preload = join(root, 'private-image-failure.ts');
    const observed = join(root, 'private-image-observed.json');
    writeFileSync(
      preload,
      `import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
if (process.argv[1]?.endsWith('install-checkout-plugins.ts')) {
  const remove = fs.rmSync;
  const failure = Object.assign(new Error('fixture private image busy'), { code: 'EBUSY' });
  let attempts = 0;
  let child: ReturnType<typeof spawn> | undefined;
  fs.rmSync = (...args: Parameters<typeof fs.rmSync>): void => {
    if (!String(args[0]).includes('plugin-installer-')) return remove(...args);
    attempts += 1;
    const bun = join(String(args[0]), 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
    child = spawn(bun, ['--eval', 'const fs=require("node:fs");const fd=fs.openSync(process.execPath,"r");process.stdout.write(String(fs.fstatSync(fd).size));setInterval(() => {}, 1000)'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    throw failure;
  };
  syncBuiltinESMExports();
  process.on('uncaughtException', (error) => {
    if (!child || child.stdout === null) throw error;
    const held = child;
    let heldSize: number | undefined;
    process.stderr.write(String(error.stack) + '\\n');
    held.once('exit', (code, signal) => {
      fs.writeFileSync(${JSON.stringify(observed)}, JSON.stringify({
        sameError: error === failure, attempts, childPid: held.pid,
        joined: true, code, signal, heldSize,
      }));
      process.exitCode = 1;
    });
    held.stdout.once('data', (data: Buffer) => { heldSize = Number(data.toString()); held.kill(); });
    held.once('error', () => { process.exitCode = 1; });
  });
}
`,
    );
    const result = postinstall(root, {
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      PRIVATE_IMAGE_DIAGNOSTIC_SECRET: 'must-not-appear-in-diagnostic',
    });
    expect(result.status).not.toBe(0);
    const lifecycle = asRecord(JSON.parse(readFileSync(observed, 'utf8')));
    expect(lifecycle['sameError']).toBe(true);
    expect(lifecycle['attempts']).toBe(1);
    expect(lifecycle['joined']).toBe(true);
    expect(lifecycle['childPid']).toEqual(expect.any(Number));
    const prefix = '[checkout-plugin-cleanup] ';
    const line = result.stderr
      ?.toString()
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(prefix));
    if (line === undefined) throw new Error('Missing private image context');
    expect(line).not.toContain('must-not-appear-in-diagnostic');
    const diagnostic = asRecord(JSON.parse(line.slice(prefix.length)));
    expect(diagnostic['execPath']).toBe(
      realpathSync(Bun.which('node') ?? 'missing-node'),
    );
    expect(asRecord(diagnostic['runtime'])['node']).toEqual(expect.any(String));
    const image = asRecord(diagnostic['privateImage']);
    expect(image['owner']).toBe('unproven');
    expect(asRecord(image['metadata'])['size']).toBeGreaterThan(0);
    expect(lifecycle['heldSize']).toBe(asRecord(image['metadata'])['size']);
    expect(lifecycle['signal']).toBe('SIGTERM');
    const commands = diagnostic['commands'];
    if (!Array.isArray(commands)) throw new Error('Missing installer commands');
    expect(commands).toHaveLength(5);
    expect(commands.map((command) => asRecord(command)['status'])).toEqual([
      0, 0, 0, 0, 0,
    ]);
    expect(image['path']).toBe(asRecord(commands[2])['command']);
    if (process.platform === 'win32') {
      const candidates = asRecord(image['probe'])['processCandidates'];
      if (!Array.isArray(candidates))
        throw new Error('Missing native process candidates');
      expect(
        candidates.some(
          (candidate) =>
            asRecord(candidate)['pid'] === lifecycle['childPid'] &&
            asRecord(candidate)['role'] === 'exact-private-bun',
        ),
      ).toBe(true);
    }
    expect(result.stderr?.toString()).toContain('fixture private image busy');
  }, 120_000);

  it('fails on a real frozen-lock installation error without installing later contexts', () => {
    const root = fixture(true);
    const lock = join(root, 'plugins', 'google-gemini', 'bun.lock');
    const invalid = 'invalid frozen plugin lock';
    writeFileSync(lock, invalid);
    const result = postinstall(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr?.toString()).toContain('--frozen-lockfile');
    expect(readFileSync(lock, 'utf8')).toBe(invalid);
    expect(
      existsSync(join(root, 'plugins', 'google-mcp-auth', 'node_modules')),
    ).toBe(false);
  }, 120_000);

  it('installs the declared independent locks and loads all real contributions in a checkout', async () => {
    const root = fixture(true);
    const locks = [
      'package-lock.json',
      ...FIRST_PARTY_RUNTIME_PLUGIN_RELEASES.map((release) =>
        join(release.dir, 'bun.lock'),
      ),
    ];
    const declaredLocks = locks.map((file) =>
      readFileSync(join(repoRoot, file)),
    );
    const result = postinstall(root);
    expect({
      status: result.status,
      stderr: result.stderr?.toString(),
    }).toEqual({ status: 0, stderr: expect.any(String) });
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      expect(
        existsSync(
          join(root, release.dir, 'node_modules', 'google-auth-library'),
        ),
      ).toBe(true);
    }
    expect(locks.map((file) => readFileSync(join(root, file)))).toEqual(
      declaredLocks,
    );
    symlinkSync(
      join(repoRoot, 'node_modules', 'zod'),
      join(root, 'node_modules', 'zod'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const scoped = join(root, 'node_modules', '@vybestack');
    mkdirSync(scoped, { recursive: true });
    for (const name of [
      'auth',
      'core',
      'mcp',
      'providers',
      'settings',
      'telemetry',
      'storage',
      'tools',
      'policy',
      'ide-integration',
    ]) {
      symlinkSync(
        join(repoRoot, 'packages', name),
        join(scoped, `llxprt-code-${name}`),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    const registry = await loadRuntimePlugins(
      FIRST_PARTY_RUNTIME_PLUGIN_RELEASES.map((release) => release.name),
      {
        importModule: async (name) => {
          const release = FIRST_PARTY_RUNTIME_PLUGIN_RELEASES.find(
            (entry) => entry.name === name,
          );
          if (release === undefined)
            throw new Error(`Undeclared plugin ${name}`);
          return import(
            pathToFileURL(join(root, release.dir, 'src', 'index.ts')).href
          );
        },
      },
    );
    expect(registry.listProviderIds()).toEqual([
      'openai',
      'openai-responses',
      'openaivercel',
      'openai-vercel',
      'anthropic',
      'gemini',
    ]);
    expect(registry.getProviderOrigin('gemini')?.kind).toBe('plugin');
    expect(
      registry.getContributedAliases().map((entry) => entry.alias),
    ).toEqual(['gemini']);
    expect(
      registry
        .getMcpAuthFactories()
        .map((entry) => entry.contribution.authProviderType),
    ).toEqual(['google_credentials', 'service_account_impersonation']);
    expect(
      asRecord(
        JSON.parse(
          readFileSync(
            join(
              root,
              'plugins/google-gemini/node_modules/google-auth-library/package.json',
            ),
            'utf8',
          ),
        ),
      )['version'],
    ).toBe('10.6.2');
    expect(
      asRecord(
        JSON.parse(
          readFileSync(
            join(
              root,
              'plugins/google-mcp-auth/node_modules/google-auth-library/package.json',
            ),
            'utf8',
          ),
        ),
      )['version'],
    ).toBe('9.15.1');
  }, 120_000);
});
