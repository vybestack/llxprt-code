/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { getPty, loadNodePty, type PtyModule } from './getPty.js';
import { isBunPosix } from './runtime.js';

const PTY_BACKENDS = ['lydell-node-pty', 'node-pty'] as const;

function requirePty<T>(pty: T | null, backend: string): T {
  expect(pty).not.toBeNull();
  if (pty === null) {
    throw new Error(`expected ${backend} backend`);
  }
  return pty;
}

function stubBackend(): PtyModule {
  return { spawn: vi.fn() } as unknown as PtyModule;
}

function failingLoader(reason: string): () => Promise<PtyModule> {
  return () => Promise.reject(new Error(reason));
}

describe('getPty', () => {
  /**
   * Exercise node backend selection through injected loaders rather than the
   * module registry. Bun cannot reset that registry between tests, but this
   * runtime-independent helper runs the same selection used on Node/Windows.
   */
  describe('node-pty backend handling', () => {
    it('returns null when no node-pty backend can be loaded', async () => {
      await expect(
        loadNodePty({
          loadPrimary: failingLoader('primary pty unavailable'),
          loadFallback: failingLoader('fallback pty unavailable'),
        }),
      ).resolves.toBeNull();
    });

    it('falls back to node-pty when @lydell/node-pty cannot be loaded', async () => {
      const fallbackModule = stubBackend();

      const pty = await loadNodePty({
        loadPrimary: failingLoader('primary pty unavailable'),
        loadFallback: () => Promise.resolve(fallbackModule),
      });

      expect(pty).toStrictEqual({ module: fallbackModule, name: 'node-pty' });
    });

    it('uses @lydell/node-pty when the primary backend loads', async () => {
      const primaryModule = stubBackend();

      const pty = await loadNodePty({
        loadPrimary: () => Promise.resolve(primaryModule),
        loadFallback: failingLoader('fallback pty should not be loaded'),
      });

      expect(pty).toStrictEqual({
        module: primaryModule,
        name: 'lydell-node-pty',
      });
    });
  });

  describe('getPty runtime selection (Bun)', () => {
    it.skipIf(!isBunPosix())(
      'returns the bun-pty backend under Bun',
      async () => {
        const pty = requirePty(await getPty(), 'bun-pty');
        expect(pty.name).toBe('bun-pty');
        expect(typeof pty.module.spawn).toBe('function');
      },
    );
  });

  describe('getPty runtime selection (Node)', () => {
    // No loaders: this exercises the real installed backends through the
    // default loaders, so it still proves the genuine selection path.
    it.skipIf(isBunPosix())(
      'returns a node-pty backend outside Bun POSIX',
      async () => {
        const pty = requirePty(await getPty(), 'node-pty');
        expect(PTY_BACKENDS).toContain(pty.name);
        expect(typeof pty.module.spawn).toBe('function');
      },
    );
  });
});
