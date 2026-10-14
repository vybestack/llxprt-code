/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
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

describe('sweep at scratch root creation', () => {
  const parents: string[] = [];
  afterEach(() => {
    for (const parent of parents.splice(0))
      rmSync(parent, { recursive: true, force: true });
  });

  function runChild(script: string, tmp: string) {
    return spawnSync('bun', ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: tmp },
    });
  }

  it('removes dead roots and keeps live and own roots when the first root is created', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-startup-')));
    parents.push(tmp);
    const exited = spawnSync('bun', ['-e', '0']);
    const dead = join(tmp, `llxprt-scratch-${exited.pid}-abc123`);
    const live = join(tmp, `llxprt-scratch-${process.pid}-abc123`);
    mkdirSync(join(dead, 'leftover'), { recursive: true });
    mkdirSync(live);

    const script = `
      import { getScratchRoot } from ${JSON.stringify(MODULE)};
      getScratchRoot();
    `;
    const result = runChild(script, tmp);

    expect(result.status).toBe(0);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it('does not sweep again when the root is recreated in the same process', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-once-')));
    parents.push(tmp);
    const exited = spawnSync('bun', ['-e', '0']);
    const late = join(tmp, `llxprt-scratch-${exited.pid}-abc123`);

    const script = `
      import { existsSync, mkdirSync } from 'node:fs';
      import { getScratchRoot, removeScratchRoot } from ${JSON.stringify(MODULE)};
      getScratchRoot();
      removeScratchRoot();
      mkdirSync(${JSON.stringify(late)});
      getScratchRoot();
      process.stdout.write(String(existsSync(${JSON.stringify(late)})));
    `;
    const result = runChild(script, tmp);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('true');
  });

  it('keeps sweeping the remaining roots when one entry cannot be removed', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-fail-')));
    parents.push(dir);
    const blocked = join(dir, 'llxprt-scratch-999998-abc123');
    const removable = join(dir, 'llxprt-scratch-999999-abc123');
    mkdirSync(join(blocked, 'inner'), { recursive: true });
    mkdirSync(removable);
    chmodSync(blocked, 0o500);

    try {
      const removed = sweepDeadScratchRoots(dir, () => false);
      expect(removed).toStrictEqual(['llxprt-scratch-999999-abc123']);
      expect(existsSync(removable)).toBe(false);
      expect(existsSync(blocked)).toBe(true);
    } finally {
      chmodSync(blocked, 0o700);
    }
  });
});
