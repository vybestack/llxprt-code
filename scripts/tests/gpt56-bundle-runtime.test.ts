/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'bun:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = join(repoRoot, 'scripts/tests/fixtures/gpt56-bundle-smoke.ts');
const tokenizerWasm = join(
  repoRoot,
  'node_modules/@dqbd/tiktoken/tiktoken_bg.wasm',
);
const tempDirectories: string[] = [];
const bunAvailable =
  spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;

afterEach(() => {
  const cleanupErrors: unknown[] = [];
  for (const directory of tempDirectories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'Failed to remove test directories',
    );
  }
});

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, NO_PROXY: '*', no_proxy: '*' },
  });
  if (result.error) {
    throw new Error(
      `${command} ${args.join(' ')} failed to spawn: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}):\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function writePortableBuildScript(directory: string): string {
  const script = join(directory, 'build.ts');
  writeFileSync(
    script,
    `import { portableTiktokenPlugin } from ${JSON.stringify(join(repoRoot, 'scripts/portable-tiktoken-plugin.ts'))};
await Bun.build({
  entrypoints: [${JSON.stringify(fixture)}],
  outdir: ${JSON.stringify(directory)},
  target: 'node',
  format: 'esm',
  plugins: [portableTiktokenPlugin],
  conditions: ['production'],
  banner: "import { fileURLToPath } from 'node:url'; import { dirname } from 'node:path'; globalThis.__dirname = dirname(fileURLToPath(import.meta.url));",
});
`,
  );
  return script;
}

describe.skipIf(!bunAvailable)('GPT-5.6 bundled runtime', () => {
  it('executes o200k from an isolated bundle and adjacent WASM', () => {
    const buildDirectory = createTemporaryDirectory('llxprt-gpt56-build-');
    run('bun', [writePortableBuildScript(buildDirectory)], repoRoot);
    copyFileSync(tokenizerWasm, join(buildDirectory, 'tiktoken_bg.wasm'));

    const bundle = join(buildDirectory, 'gpt56-bundle-smoke.js');
    expect(readFileSync(bundle, 'utf8')).toContain(
      'var candidates = globalThis.__dirname',
    );

    const executionDirectory = createTemporaryDirectory('llxprt-gpt56-cwd-');
    expect(run(process.execPath, [bundle], executionDirectory)).toBe('10');
  });
});
