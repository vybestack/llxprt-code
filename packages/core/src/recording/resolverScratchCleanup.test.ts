/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResolverDiskIndex } from './resolverDiskIndex.js';
import { ResolverIntervalIndex } from './resolverIntervalIndex.js';

describe.each([
  ['ResolverDiskIndex', (root: string) => new ResolverDiskIndex(root)],
  ['ResolverIntervalIndex', (root: string) => new ResolverIntervalIndex(root)],
])('%s scratch cleanup', (_name, create) => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  function root(): string {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-cleanup-'));
    roots.push(dir);
    return dir;
  }

  it('leaves nothing behind after close, and closing twice is a no-op', () => {
    const scratch = root();
    const index = create(scratch);
    expect(readdirSync(scratch)).toHaveLength(1);

    index.close();
    index.close();

    expect(readdirSync(scratch)).toStrictEqual([]);
  });

  it('closes cleanly when the whole scratch root was removed first', () => {
    const scratch = root();
    const index = create(scratch);
    rmSync(scratch, { recursive: true, force: true });

    expect(() => index.close()).not.toThrow();
    expect(existsSync(scratch)).toBe(false);
  });

  it('refuses to construct under a missing scratch root', () => {
    const scratch = join(root(), 'absent');

    expect(() => create(scratch)).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });
});
