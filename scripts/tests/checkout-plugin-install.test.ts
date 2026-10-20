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

  it('fails checkout setup when the pinned installer cannot be acquired', () => {
    const root = fixture(true);
    const result = postinstall(root, { PATH: '' });
    expect(result.status).not.toBe(0);
    expect(result.stderr?.toString()).toContain('curl');
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      expect(existsSync(join(root, release.dir, 'node_modules'))).toBe(false);
    }
  });

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
