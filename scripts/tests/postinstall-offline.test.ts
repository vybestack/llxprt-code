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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repoRoot = resolve(import.meta.dirname, '../..');
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

interface CheckoutFixture {
  readonly root: string;
  readonly preloaded: string;
  readonly spawned: string;
}

// Records every child process the lifecycle script tries to start and refuses
// to start it, so a download or install attempt can neither reach the network
// nor run a tool on this machine.
const CHILD_PROCESS_RECORDER = `import childProcess from 'node:child_process';
import fs from 'node:fs';

fs.writeFileSync(process.env.POSTINSTALL_PRELOADED_MARKER, 'loaded');
for (const name of [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
]) {
  childProcess[name] = (...args) => {
    fs.appendFileSync(
      process.env.POSTINSTALL_SPAWN_LOG,
      JSON.stringify({ name, command: args[0], args: args[1] }) + '\\n',
    );
    throw new Error('postinstall must not start a child process: ' + name);
  };
}
`;

function checkoutFixture(): CheckoutFixture {
  const root = mkdtempSync(join(tmpdir(), 'postinstall-offline-'));
  fixtures.push(root);
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'node_modules'));
  cpSync(join(repoRoot, 'scripts'), join(root, 'scripts'), {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).some((part) => part === 'tests'),
  });
  cpSync(join(repoRoot, 'package.json'), join(root, 'package.json'));
  writeFileSync(join(root, 'recorder.ts'), CHILD_PROCESS_RECORDER);
  return {
    root,
    preloaded: join(root, 'preloaded.marker'),
    spawned: join(root, 'spawned.jsonl'),
  };
}

function runPostinstall(
  fixture: CheckoutFixture,
  userAgent: string,
): ReturnType<typeof spawnSync> {
  const node = Bun.which('node');
  if (node === null) throw new Error('Node is required for postinstall');
  return spawnSync(node, [join(fixture.root, 'scripts', 'postinstall.cjs')], {
    cwd: fixture.root,
    env: {
      ...process.env,
      npm_config_user_agent: userAgent,
      NODE_OPTIONS: `--import=${pathToFileURL(join(fixture.root, 'recorder.ts')).href}`,
      POSTINSTALL_PRELOADED_MARKER: fixture.preloaded,
      POSTINSTALL_SPAWN_LOG: fixture.spawned,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function spawnedCommands(fixture: CheckoutFixture): string {
  return existsSync(fixture.spawned)
    ? readFileSync(fixture.spawned, 'utf8')
    : '';
}

describe('postinstall in a Git checkout', () => {
  it.each([
    ['npm', 'npm/11.6.2'],
    ['bun', 'bun/1.4.4'],
  ])(
    'starts no child process and downloads nothing under %s',
    (_installer, userAgent) => {
      const fixture = checkoutFixture();

      const result = runPostinstall(fixture, userAgent);

      expect(readFileSync(fixture.preloaded, 'utf8')).toBe('loaded');
      expect(spawnedCommands(fixture)).toBe('');
      expect(result.status).toBe(0);
    },
  );
});
