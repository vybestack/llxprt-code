/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScratchRootOwner } from './scratch-root.js';

describe('explicit scratch root owner', () => {
  it('lets standalone probes create test owners and cleans their roots on exit', () => {
    const factory = new URL(
      './__tests__/support/scratch-owner.ts',
      import.meta.url,
    );
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `import { createTestScratchOwner } from ${JSON.stringify(factory.href)};
         const owner = createTestScratchOwner();
         owner.createDirSync('probe-');
         process.stdout.write(owner.getRoot());`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/llxprt-scratch-\d+-[A-Za-z0-9]{6}$/);
    expect(existsSync(result.stdout)).toBe(false);
  });

  it('lets the test preload clean factory and production owners without removing another process root', () => {
    const parent = new ScratchRootOwner();
    try {
      const directory = parent.createDirSync('preload-');
      const test = join(directory, 'scratch-preload.test.ts');
      const factory = new URL(
        './__tests__/support/scratch-owner.ts',
        import.meta.url,
      );
      const production = new URL('./scratch-root.ts', import.meta.url);
      const preload = fileURLToPath(
        new URL(
          '../../../../scripts/tests/scratch-root-cleanup.ts',
          import.meta.url,
        ),
      );
      writeFileSync(
        test,
        `import { it } from 'bun:test';
         import { writeFileSync } from 'node:fs';
         import { ScratchRootOwner } from ${JSON.stringify(production.href)};
         import { createTestScratchOwner } from ${JSON.stringify(factory.href)};
         it('creates roots', () => {
           const roots = [createTestScratchOwner(), new ScratchRootOwner()].map(owner => owner.getRoot());
           writeFileSync(${JSON.stringify(join(directory, 'roots.txt'))}, roots.join('\\n'));
         });`,
      );
      const result = spawnSync(
        process.execPath,
        ['test', '--preload', preload, test],
        {
          encoding: 'utf8',
          cwd: directory,
        },
      );
      expect(result.status).toBe(0);
      const roots = readFileSync(join(directory, 'roots.txt'), 'utf8').split(
        '\n',
      );
      expect(roots).toHaveLength(2);
      for (const root of roots) {
        expect(root).toMatch(/llxprt-scratch-\d+-[A-Za-z0-9]{6}$/);
        expect(existsSync(root)).toBe(false);
      }
      expect(existsSync(directory)).toBe(true);
    } finally {
      parent.removeRoot();
    }
  });

  it('reuses one lazy root across consumers and recreates it after cleanup', async () => {
    const owner = new ScratchRootOwner();
    try {
      const first = owner.getRoot();
      const a = owner.createDirSync('one-');
      const b = await owner.createDir('two-');
      expect(dirname(a)).toBe(first);
      expect(dirname(b)).toBe(first);
      expect(readdirSync(first).sort()).toStrictEqual(
        [a, b].map((path) => path.slice(first.length + 1)).sort(),
      );
      owner.removeRoot();
      expect(existsSync(first)).toBe(false);
      const second = owner.getRoot();
      expect(second).not.toBe(first);
      expect(dirname(owner.createDirSync('reused-'))).toBe(second);
    } finally {
      owner.removeRoot();
    }
  });

  it('does not allocate at startup and keeps one exit cleanup across root recreation', () => {
    const module = join(
      dirname(fileURLToPath(import.meta.url)),
      'scratch-root.ts',
    );
    const result = spawnSync(
      'bun',
      [
        '-e',
        `
        import { existsSync, readdirSync } from 'node:fs';
        import { tmpdir } from 'node:os';
        import { ScratchRootOwner } from ${JSON.stringify(module)};
        const roots = () => readdirSync(tmpdir()).filter(name => name.startsWith('llxprt-scratch-' + process.pid + '-'));
        const before = roots();
        const hooks = process.listenerCount('exit');
        const owner = new ScratchRootOwner();
        const startup = roots();
        const first = owner.getRoot();
        owner.removeRoot();
        const second = owner.getRoot();
        process.stdout.write(JSON.stringify({ before, startup, hooks: process.listenerCount('exit') - hooks, firstExists: existsSync(first), second }));
      `,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    const output: unknown = JSON.parse(result.stdout);
    if (typeof output !== 'object' || output === null)
      throw new Error('Invalid scratch owner child result');
    if (!('before' in output) || !('startup' in output) || !('hooks' in output))
      throw new Error('Missing scratch owner child census');
    if (!('firstExists' in output) || !('second' in output))
      throw new Error('Missing scratch owner child paths');
    if (typeof output.second !== 'string')
      throw new Error('Invalid scratch owner child path');
    expect(output.startup).toStrictEqual(output.before);
    expect(output.hooks).toBe(1);
    expect(output.firstExists).toBe(false);
    expect(existsSync(output.second)).toBe(false);
  });
});
