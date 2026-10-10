/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createScratchDir,
  createScratchDirSync,
  getScratchRoot,
  removeScratchRoot,
  sweepDeadScratchRoots,
} from './scratch-root.js';

const MODULE = join(dirname(fileURLToPath(import.meta.url)), 'scratch-root.ts');

describe('process-owned scratch root', () => {
  afterEach(() => removeScratchRoot());

  it('names the root after this pid under the OS temp dir', () => {
    const root = getScratchRoot();
    expect(dirname(root)).toBe(tmpdir());
    expect(basename(root)).toMatch(
      new RegExp(`^llxprt-scratch-${process.pid}-[A-Za-z0-9]{6}$`),
    );
    expect(getScratchRoot()).toBe(root);
  });

  it('creates sync and async scratch dirs inside the root', async () => {
    const a = createScratchDirSync('a-');
    const b = await createScratchDir('b-');
    expect(dirname(a)).toBe(getScratchRoot());
    expect(dirname(b)).toBe(getScratchRoot());
  });

  it('removeScratchRoot deletes everything and a later use creates a fresh root', () => {
    const first = getScratchRoot();
    createScratchDirSync('x-');
    removeScratchRoot();
    expect(existsSync(first)).toBe(false);
    expect(getScratchRoot()).not.toBe(first);
  });

  it('removes the root when the process exits normally', () => {
    const script = `
      import { createScratchDirSync, getScratchRoot } from ${JSON.stringify(MODULE)};
      createScratchDirSync('child-');
      process.stdout.write(getScratchRoot());
    `;
    const result = spawnSync('bun', ['-e', script], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/llxprt-scratch-\d+-[A-Za-z0-9]{6}$/);
    expect(existsSync(result.stdout)).toBe(false);
  });
});

describe('startup sweep of dead scratch roots', () => {
  const parents: string[] = [];
  afterEach(() => {
    for (const parent of parents.splice(0))
      rmSync(parent, { recursive: true, force: true });
  });

  function parent(): string {
    const dir = mkdtempSync(join(tmpdir(), 'scratch-sweep-test-'));
    parents.push(dir);
    return dir;
  }

  it('removes a dead-pid root, keeps a live-pid root and unrelated entries', () => {
    const dir = parent();
    const dead = join(dir, 'llxprt-scratch-999999-abc123');
    const live = join(dir, `llxprt-scratch-${process.pid}-abc123`);
    const lookalike = join(dir, 'llxprt-scratch-999999-toolong1');
    const unrelated = join(dir, 'history-value-ticket-abc123');
    for (const path of [dead, live, lookalike, unrelated])
      mkdirSync(path, { recursive: true });

    const removed = sweepDeadScratchRoots(dir, (pid) => pid === process.pid);

    expect(removed).toStrictEqual(['llxprt-scratch-999999-abc123']);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(lookalike)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('uses real process liveness by default', () => {
    const dir = parent();
    const exited = spawnSync('bun', ['-e', '0']);
    const live = join(dir, `llxprt-scratch-${process.pid}-abc123`);
    const dead = join(dir, `llxprt-scratch-${exited.pid}-abc123`);
    mkdirSync(live);
    mkdirSync(dead);

    expect(sweepDeadScratchRoots(dir)).toStrictEqual([basename(dead)]);
    expect(existsSync(live)).toBe(true);
  });
});
