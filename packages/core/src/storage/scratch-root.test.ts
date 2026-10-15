/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createScratchDir,
  createScratchDirSync,
  getScratchRoot,
  removeScratchDir,
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

describe('sweep while another process owns a live root', () => {
  const parents: string[] = [];
  afterEach(() => {
    for (const parent of parents.splice(0))
      rmSync(parent, { recursive: true, force: true });
  });

  it('keeps the root and its contents of a running process, then reclaims it once that process is gone', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-live-')));
    parents.push(tmp);
    const script = `
      import { writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { createScratchDirSync, getScratchRoot } from ${JSON.stringify(MODULE)};
      const dir = createScratchDirSync('llxprt-resolver-');
      writeFileSync(join(dir, 'rows'), 'live');
      process.stdout.write(getScratchRoot() + '\\n');
      process.stdin.resume();
    `;
    const child = spawn('bun', ['-e', script], {
      env: { ...process.env, TMPDIR: tmp },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const exited = new Promise<void>((resolve) => child.once('exit', resolve));
    try {
      const childRoot = await new Promise<string>((resolve, reject) => {
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('\n')) resolve(output.trim());
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('child exited early')));
      });
      expect(dirname(childRoot)).toBe(tmp);

      expect(sweepDeadScratchRoots(tmp)).toStrictEqual([]);
      expect(existsSync(childRoot)).toBe(true);

      child.kill('SIGKILL');
      await exited;
      expect(sweepDeadScratchRoots(tmp)).toStrictEqual([basename(childRoot)]);
      expect(existsSync(childRoot)).toBe(false);
    } finally {
      child.kill('SIGKILL');
      await exited;
    }
  });
});

describe('removeScratchDir', () => {
  const parents: string[] = [];
  afterEach(() => {
    for (const parent of parents.splice(0))
      rmSync(parent, { recursive: true, force: true });
  });

  function parent(): string {
    const dir = mkdtempSync(join(tmpdir(), 'scratch-rmdir-test-'));
    parents.push(dir);
    return dir;
  }

  it('removes the named files and the directory', () => {
    const dir = join(parent(), 'owned');
    mkdirSync(dir);
    writeFileSync(join(dir, 'rows'), 'x');

    removeScratchDir(dir, ['rows']);

    expect(existsSync(dir)).toBe(false);
  });

  it('accepts a directory or file that is already gone', () => {
    const missing = join(parent(), 'gone');
    const half = join(parent(), 'half');
    mkdirSync(half);

    expect(() => removeScratchDir(missing, ['rows'])).not.toThrow();
    expect(() => removeScratchDir(half, ['rows'])).not.toThrow();
    expect(existsSync(half)).toBe(false);
  });

  it('reports an entry the caller did not create instead of deleting it', () => {
    const dir = join(parent(), 'owned');
    mkdirSync(dir);
    writeFileSync(join(dir, 'rows'), 'x');
    writeFileSync(join(dir, 'stranger'), 'y');

    expect(() => removeScratchDir(dir, ['rows'])).toThrow(
      expect.objectContaining({ code: 'ENOTEMPTY' }),
    );
    expect(existsSync(join(dir, 'stranger'))).toBe(true);
  });
});
