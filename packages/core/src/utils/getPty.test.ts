/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { getPty, type PtyModule } from './getPty.js';
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
   * Backend selection is driven through getPty's injected loaders rather than
   * by substituting `@lydell/node-pty` / `node-pty` in the module registry.
   *
   * These three cases only ever EXECUTE on Windows: `getPty` short-circuits to
   * the Bun.Terminal adapter under Bun POSIX, and this package's suites run
   * exclusively under Bun (`bun run-bun-tests.ts`). Bun's test runner cannot
   * reset the module registry and evaluates a module-mock factory once,
   * eagerly, so the module-substitution approach these tests used silently
   * handed them the REAL module on the only platform that runs them — which is
   * how they failed in CI while passing everywhere a developer would look
   * (issue #3061). Injected loaders behave identically on every runtime.
   */
  describe('getPty unavailable backend handling', () => {
    it.skipIf(isBunPosix())(
      'returns null when no node-pty backend can be loaded',
      async () => {
        await expect(
          getPty({
            loadPrimary: failingLoader('primary pty unavailable'),
            loadFallback: failingLoader('fallback pty unavailable'),
          }),
        ).resolves.toBeNull();
      },
    );

    it.skipIf(isBunPosix())(
      'falls back to node-pty when @lydell/node-pty cannot be loaded',
      async () => {
        const fallbackModule = stubBackend();

        const pty = await getPty({
          loadPrimary: failingLoader('primary pty unavailable'),
          loadFallback: () => Promise.resolve(fallbackModule),
        });

        expect(pty).toStrictEqual({ module: fallbackModule, name: 'node-pty' });
      },
    );

    it.skipIf(isBunPosix())(
      'uses @lydell/node-pty when the primary backend loads',
      async () => {
        const primaryModule = stubBackend();

        const pty = await getPty({
          loadPrimary: () => Promise.resolve(primaryModule),
          loadFallback: failingLoader('fallback pty should not be loaded'),
        });

        expect(pty).toStrictEqual({
          module: primaryModule,
          name: 'lydell-node-pty',
        });
      },
    );
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
