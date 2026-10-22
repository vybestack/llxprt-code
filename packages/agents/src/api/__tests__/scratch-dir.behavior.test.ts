/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  buildSessionEnv,
  createTestSessionRoot,
  removeSessionRoot,
  type TestSession,
} from '../../../../../scripts/lib/test-session-isolation.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

const packageRoot = resolve(import.meta.dir, '../../..');
const repoRoot = resolve(packageRoot, '../..');
const scanRoots = ['packages', 'scripts', 'integration-tests', 'evals'].map(
  (name) => join(repoRoot, name),
);

function isInside(root: string, directory: string): boolean {
  const path = relative(root, directory);
  return (
    path === '' ||
    (!isAbsolute(path) && !path.startsWith(`..${sep}`) && path !== '..')
  );
}

interface BunChild {
  readonly completed: Promise<{ code: number | null; output: string }>;
  readonly kill: () => void;
}

function startBun(args: readonly string[], env: NodeJS.ProcessEnv): BunChild {
  const child = spawn(process.execPath, args, {
    cwd: packageRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
  }
  const completed = new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, output }));
    },
  );
  return {
    completed,
    kill: () => {
      child.kill();
    },
  };
}

async function sessionScratch(session: TestSession): Promise<string> {
  const { code, output } = await startBun(
    [
      '--eval',
      `import { makeScratchDir } from ${JSON.stringify(join(import.meta.dir, 'helpers/scratch-dir.ts'))}; console.log(await makeScratchDir('session-scratch-'));`,
    ],
    buildSessionEnv(process.env, session),
  ).completed;
  if (code !== 0) throw new Error(`Scratch child failed: ${output}`);
  return output.trim();
}

async function cycleScratch(): Promise<string> {
  const directory = await makeScratchDir('boundary-lifecycle-');
  try {
    await mkdir(join(directory, 'nested'));
    await writeFile(join(directory, 'nested', 'fixture.txt'), 'scratch state');
    return directory;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Agent test scratch ownership', () => {
  it('creates unique caller-owned directories outside every scanned source root', async () => {
    const first = await makeScratchDir('scratch-owner-');
    const second = await makeScratchDir('scratch-owner-');
    try {
      expect(dirname(first)).toBe(tmpdir());
      expect(first).not.toBe(second);
      expect(scanRoots.filter((root) => isInside(root, first))).toStrictEqual(
        [],
      );
      await writeFile(join(first, 'marker'), 'first owner');
      await rm(first, { recursive: true, force: true });
      expect(existsSync(second)).toBe(true);
    } finally {
      await Promise.all(
        [first, second].map((directory) =>
          rm(directory, { recursive: true, force: true }),
        ),
      );
    }
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
  });

  it('keeps scratch state within each Bun runner session and removes it with its owner', async () => {
    const first = createTestSessionRoot();
    const second = createTestSessionRoot();
    try {
      const [firstScratch, secondScratch] = await Promise.all([
        sessionScratch(first),
        sessionScratch(second),
      ]);
      expect(dirname(firstScratch)).toBe(first.tmpDir);
      expect(dirname(secondScratch)).toBe(second.tmpDir);
      removeSessionRoot(first);
      expect(existsSync(firstScratch)).toBe(false);
      expect(existsSync(secondScratch)).toBe(true);
    } finally {
      removeSessionRoot(first);
      removeSessionRoot(second);
    }
    expect(existsSync(second.root)).toBe(false);
  });

  it('creates an explicit missing parent and leaves sibling cleanup to its caller', async () => {
    const owner = await makeScratchDir('scratch-parent-');
    try {
      const parent = join(owner, 'missing', 'parent');
      const directory = await makeScratchDir('custom-', parent);
      await writeFile(join(directory, 'marker'), 'custom owner');
      expect(dirname(directory)).toBe(parent);
      expect(await readFile(join(directory, 'marker'), 'utf8')).toBe(
        'custom owner',
      );
      await rm(directory, { recursive: true, force: true });
      expect(existsSync(parent)).toBe(true);
    } finally {
      await rm(owner, { recursive: true, force: true });
    }
  });

  it('keeps the unchanged boundary scan stable during concurrent scratch creation and cleanup', async () => {
    const scan = startBun(
      ['test', 'src/api/__tests__/boundary.no-internals-subpath.test.ts'],
      process.env,
    );
    const lifecycle = { scanning: true };
    const completed = scan.completed.finally(() => {
      lifecycle.scanning = false;
    });
    const directories: string[] = [];
    try {
      do {
        directories.push(await cycleScratch());
      } while (lifecycle.scanning);
      const { code, output } = await completed;
      expect({ code, output }).toMatchObject({ code: 0 });
      expect(output).toContain('5 pass');
      expect(directories.length).toBeGreaterThan(0);
      expect(
        directories.filter((directory) =>
          scanRoots.some((root) => isInside(root, directory)),
        ),
      ).toStrictEqual([]);
    } finally {
      scan.kill();
      await completed;
    }
  }, 30_000);
});
