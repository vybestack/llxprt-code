/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Static enforcement of the test isolation contract (issue #3622): storage
 * preloads must call isolateStorageRoots() (which owns the OS-keyring
 * disable and the legacy-home override), and every runner must spawn test
 * processes with the session env rather than its own environment. These are
 * source-level checks so a new root or runner cannot silently drop out of
 * the contract; the behavior itself is pinned by
 * packages/storage/src/testing/isolateStorageRoots.test.ts and
 * scripts/tests/sentinel-guard-demo.test.ts.
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import {
  BUN_TEST_ROOTS,
  resolveRootCwd,
  type BunTestRoot,
} from '../bun-test-roots.js';

const RUNNERS = ['shared', 'cli', 'core', 'agents', 'auth'] as const;
type Runner = (typeof RUNNERS)[number];

function spawnEnvLinks(runner: Runner): readonly RegExp[] {
  if (runner === 'shared') {
    return [
      /env:\s*sessionEnv,/,
      /env:\s*options\.env,/,
      /sessionEnv,(?=\s*dependencies)/g,
    ];
  }
  if (runner === 'core') {
    return [
      /env:\s*options\.env\s*\?\?\s*process\.env,/,
      /env:\s*isolation\.sessionEnv/,
    ];
  }
  return [/^[\t ]*env,/m, /,\s*isolation\.sessionEnv/];
}

function runnerPath(runner: Runner): string {
  return runner === 'shared'
    ? 'scripts/run_bun_tests.ts'
    : `packages/${runner}/run-bun-tests.ts`;
}

function callsIn(source: string, name: string): readonly ts.CallExpression[] {
  const file = ts.createSourceFile(
    'runner.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText(file) === name) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return calls;
}

function assertSpawnEnv(
  call: ts.CallExpression,
  index: number,
  expected: string,
): void {
  const options = call.arguments[index];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    throw new Error('Spawn options must be an object with a session env');
  }
  const env = options.properties.find(
    (property) => property.name?.getText() === 'env',
  );
  let value: string | undefined;
  if (env !== undefined) {
    if (ts.isPropertyAssignment(env)) {
      value = env.initializer.getText();
    } else if (ts.isShorthandPropertyAssignment(env)) {
      value = env.name.text;
    }
  }
  expect(value, 'spawn options must forward the session env').toBe(expected);
}

function assertRunnerEnv(source: string, runner: Runner): void {
  const spawns = callsIn(source, 'spawn').filter(
    (call) => call.arguments[0]?.getText() !== "'taskkill'",
  );
  expect(spawns.length).toBeGreaterThan(0);
  const expectedEnv: Readonly<Record<Runner, string>> = {
    shared: 'options.env',
    core: 'options.env ?? process.env',
    cli: 'env',
    agents: 'env',
    auth: 'env',
  };
  for (const call of spawns) {
    assertSpawnEnv(call, 2, expectedEnv[runner]);
  }
  if (runner === 'shared') {
    const dispatches = callsIn(source, 'dependencies.spawn');
    expect(dispatches.length).toBeGreaterThan(0);
    for (const call of dispatches) assertSpawnEnv(call, 1, 'sessionEnv');
    const files = callsIn(source, 'runSingleTestFile');
    expect(files.length).toBeGreaterThan(0);
    for (const call of files)
      expect(call.arguments[2]?.getText()).toBe('sessionEnv');
    const attempts = callsIn(source, 'spawnTestFileOnce');
    expect(attempts.length).toBeGreaterThan(0);
    for (const call of attempts)
      expect(call.arguments[2]?.getText()).toBe('sessionEnv');
  } else {
    const retries = callsIn(source, 'runTestFileWithTimeoutRetry');
    expect(retries.length).toBeGreaterThan(0);
    for (const retry of retries) {
      const callback = retry.arguments[1];
      if (
        callback === undefined ||
        !ts.isArrowFunction(callback) ||
        !ts.isCallExpression(callback.body)
      ) {
        throw new Error('Retry must invoke runTestFile with the session env');
      }
      expect(callback.body.expression.getText()).toBe('runTestFile');
      if (runner === 'core')
        assertSpawnEnv(callback.body, 1, 'isolation.sessionEnv');
      else
        expect(
          callback.body.arguments[runner === 'agents' ? 2 : 1]?.getText(),
        ).toBe('isolation.sessionEnv');
    }
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => typeof entry === 'string')
  );
}

const SETUP_EXCEPTIONS = ['evals', 'integration-tests'];

function assertRootIsolation(root: BunTestRoot): void {
  const preloads =
    typeof root.preload === 'string' ? [root.preload] : (root.preload ?? []);
  const isolation = preloads.filter((preload) =>
    /storage-isolation/.test(preload),
  );
  if (isolation.length > 0) {
    for (const preload of isolation) {
      expect(
        readFileSync(join(resolveRootCwd(REPO_ROOT, root), preload), 'utf8'),
      ).toContain('isolateStorageRoots(');
    }
    return;
  }
  expect(
    SETUP_EXCEPTIONS,
    `${root.root} has no storage-isolation preload or recognized setup`,
  ).toContain(root.root);
  expect(root.credentialed).toBe(true);
  expect(root.globalSetup).toBe('globalSetup.ts');
  const setup = readFileSync(
    join(resolveRootCwd(REPO_ROOT, root), 'globalSetup.ts'),
    'utf8',
  );
  expect(setup).toMatch(/for\s*\(const key of STORAGE_ENV_KEYS\)/);
  expect(setup).toMatch(/process\.env\[key\]\s*=\s*storageDir/);
  expect(setup).toContain('STORAGE_ENV_SUBDIRECTORIES[key]');
}

const REPO_ROOT = join(import.meta.dir, '..', '..');

function readRepoFile(...segments: string[]): string {
  return readFileSync(join(REPO_ROOT, ...segments), 'utf8');
}

function findTypeScriptFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name.startsWith('.') ||
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'coverage'
    ) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

const DIRECT_KEYRING_DISABLE_ASSIGNMENT =
  /process\.env(?:\.LLXPRT_TEST_DISABLE_OS_KEYRING|\[['"]LLXPRT_TEST_DISABLE_OS_KEYRING['"]\])\s*=(?!=)/;

describe('test isolation contract (issue #3622)', () => {
  it('covers every declared root and every package workspace, including roots without preloads', () => {
    const knownRoots = [
      'a2a-server',
      'agents',
      'providers',
      'tools',
      'mcp',
      'telemetry',
      'storage',
      'test-utils',
      'settings',
      'ide-integration',
      'vscode-ide-companion',
      'policy',
      'lsp',
      'zed-acp',
      'scripts-tests',
      'evals',
      'integration-tests',
    ];
    expect(BUN_TEST_ROOTS.map((root) => root.root).sort()).toEqual(
      knownRoots.sort(),
    );
    for (const root of BUN_TEST_ROOTS) assertRootIsolation(root);
    const manifest: unknown = JSON.parse(readRepoFile('package.json'));
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('workspaces' in manifest) ||
      !isStringArray(manifest.workspaces)
    ) {
      throw new Error('Expected explicit package workspaces');
    }
    expect([...manifest.workspaces].sort()).toEqual(
      [
        ...knownRoots.filter(
          (root) => !['scripts-tests', ...SETUP_EXCEPTIONS].includes(root),
        ),
        'cli',
        'core',
        'auth',
      ]
        .map((root) => `packages/${root}`)
        .sort(),
    );
    for (const workspace of ['cli', 'agents']) {
      const config = Bun.TOML.parse(
        readRepoFile(`packages/${workspace}/bunfig.toml`),
      );
      expect(config).toMatchObject({
        test: {
          preload: expect.arrayContaining([
            './test-setup-storage-isolation.ts',
          ]),
        },
      });
    }
  });

  it('rejects an added root without isolation and removal of each existing isolation declaration', () => {
    expect(() => assertRootIsolation({ root: 'new-workspace' })).toThrow();
    for (const root of BUN_TEST_ROOTS) {
      expect(() =>
        assertRootIsolation({
          ...root,
          preload: undefined,
          globalSetup: undefined,
        }),
      ).toThrow();
    }
  });

  for (const runner of RUNNERS) {
    it(`${runner} forwards session env through spawn and retry paths`, () => {
      assertRunnerEnv(readRepoFile(runnerPath(runner)), runner);
    });

    it(`${runner} rejects deletion of each spawn-env link`, () => {
      const source = readRepoFile(runnerPath(runner));
      assertRunnerEnv(source, runner);
      const links = spawnEnvLinks(runner);
      for (const pattern of links) {
        const matches = [
          ...source.matchAll(
            new RegExp(
              pattern.source,
              pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
            ),
          ),
        ];
        expect(matches.length).toBeGreaterThan(0);
        for (const match of matches) {
          const mutated =
            source.slice(0, match.index) +
            source.slice(match.index + match[0].length);
          expect(() => assertRunnerEnv(mutated, runner)).toThrow();
        }
      }
    });
  }

  it('every storage-isolation preload calls isolateStorageRoots()', () => {
    expect(BUN_TEST_ROOTS.length).toBeGreaterThan(0);
    const checked: string[] = [];
    for (const root of BUN_TEST_ROOTS) {
      const preloads =
        typeof root.preload === 'string'
          ? [root.preload]
          : (root.preload ?? []);
      for (const preload of preloads) {
        if (!/storage-isolation/.test(preload)) continue;
        const source = readFileSync(
          join(resolveRootCwd(REPO_ROOT, root), preload),
          'utf8',
        );
        expect(source, `${preload} must call isolateStorageRoots()`).toContain(
          'isolateStorageRoots(',
        );
        checked.push(`${root.root}: ${preload}`);
      }
    }
    expect(checked).toContain('tools: test-setup-storage-isolation.ts');
    expect(checked).toContain('mcp: test-setup-storage-isolation.ts');
    for (const preload of [
      'packages/cli/test-setup-storage-isolation.ts',
      'packages/core/bun-preload.ts',
      'packages/auth/bun-preload.ts',
    ]) {
      expect(readRepoFile(preload), preload).toContain('isolateStorageRoots(');
    }
    expect(checked.length).toBeGreaterThanOrEqual(6);
  });

  it('every bespoke runner spawns test processes with the session env', () => {
    const runners = [
      'packages/cli/run-bun-tests.ts',
      'packages/core/run-bun-tests.ts',
      'packages/agents/run-bun-tests.ts',
      'packages/auth/run-bun-tests.ts',
    ];
    for (const runner of runners) {
      const source = readRepoFile(...runner.split('/'));
      expect(
        source,
        `${runner} must wire createBespokeRunnerIsolation`,
      ).toContain('createBespokeRunnerIsolation');
      expect(
        source,
        `${runner} must not spawn children with the runner's own env`,
      ).not.toMatch(/env:\s*process\.env\b/);
      expect(
        source,
        `${runner} must fail the run on sentinel violations`,
      ).toContain('isolation.finalize()');
    }
  });

  it('the shared runner builds a session env and finalizes its guard', () => {
    const source = readRepoFile('scripts', 'run_bun_tests.ts');
    expect(source).toContain('buildSessionEnv');
    expect(source).toContain('createTestSessionRoot');
    expect(source).toContain('finalizeGuard');
    expect(source).not.toMatch(/env:\s*process\.env\b/);
  });

  it('centralizes the OS-keyring disable and allowlists only storage tests that control it', () => {
    const helper = readRepoFile(
      'packages',
      'storage',
      'src',
      'testing',
      'isolateStorageRoots.ts',
    );
    expect(helper).toContain('process.env[DISABLE_OS_KEYRING_ENV] = keyring');

    const assignments = findTypeScriptFiles(join(REPO_ROOT, 'packages'))
      .filter((file) =>
        DIRECT_KEYRING_DISABLE_ASSIGNMENT.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(REPO_ROOT, file).split('\\').join('/'))
      .sort();
    expect(assignments).toEqual([
      'packages/storage/src/testing/isolateStorageRoots.test.ts',
      'packages/storage/test-bun/keychain-grant-persistence.bun.ts',
      'packages/storage/test-bun/keyring-delete-verification.bun.ts',
    ]);
  });
});
