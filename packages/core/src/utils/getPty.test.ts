/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isBunPosix } from './runtime.js';

const PTY_BACKENDS = ['lydell-node-pty', 'node-pty'] as const;

type SpawnFn = (...args: unknown[]) => unknown;
type PtyLike = { spawn: SpawnFn };

function requirePty<T>(pty: T | null, backend: string): T {
  expect(pty).not.toBeNull();
  if (pty === null) {
    throw new Error(`expected ${backend} backend`);
  }
  return pty;
}

/**
 * Per-test mock state shared with the hoisted `vi.mock` factories below.
 *
 * Why hoisted + file-level `vi.mock` instead of per-test `vi.doMock`:
 * `vi.doMock` registered under the bare specifiers `@lydell/node-pty` /
 * `node-pty` is bypassed on the Windows runner, where `node-pty` is a real
 * installed native addon. Vitest resolves the bare specifier to the native
 * `.node` artifact and loads it directly, so the `doMock` factory never runs
 * and the REAL module is returned — which is exactly the failure observed in
 * nightly run 30987988465. File-level `vi.mock` intercepts the specifier at
 * module-graph build time (before resolution to a native path can happen), so
 * the interception is reliable on every platform.
 *
 * `mode` selects what each backend's mock factory returns for the next fresh
 * `import('./getPty.js')`. `passthrough` delegates to `importOriginal` so the
 * real-selection test still exercises the genuine getPty logic against the
 * genuinely installed backend rather than a rewritten stub.
 */
const { ptyState } = vi.hoisted(() => ({
  ptyState: {
    mode: 'passthrough' as
      | 'passthrough'
      | 'both-fail'
      | 'primary-fail'
      | 'primary-ok',
    primary: undefined as PtyLike | undefined,
    fallback: undefined as PtyLike | undefined,
  },
}));

vi.mock('@lydell/node-pty', async (importOriginal) => {
  switch (ptyState.mode) {
    case 'primary-ok':
      return ptyState.primary;
    case 'both-fail':
    case 'primary-fail':
      throw new Error('primary pty unavailable');
    case 'passthrough':
    default:
      // Delegate to the real module so the "real backend selection" test
      // exercises genuine getPty logic. On platforms where this package is not
      // installed, importOriginal rejects — which is exactly the "primary
      // unavailable" path getPty is meant to handle.
      return importOriginal();
  }
});

vi.mock('node-pty', async (importOriginal) => {
  switch (ptyState.mode) {
    case 'both-fail':
      throw new Error('fallback pty unavailable');
    case 'primary-fail':
      return ptyState.fallback;
    case 'primary-ok':
      throw new Error('fallback pty should not be loaded');
    case 'passthrough':
    default:
      return importOriginal();
  }
});

function resetPtyState(): void {
  ptyState.mode = 'passthrough';
  ptyState.primary = undefined;
  ptyState.fallback = undefined;
}

describe('getPty', () => {
  // Scoped to the backend-substitution suite, NOT the whole file: Bun's test
  // runner cannot reset the module registry (augment-bun-vi rejects
  // vi.resetModules outright), and the runtime-selection suites below neither
  // substitute a backend nor need a fresh module. Hooks do not run for skipped
  // tests, so under Bun — where these three are skipped — the unsupported call
  // is never reached.
  describe('getPty unavailable backend handling', () => {
    beforeEach(() => {
      // Clear the module cache so the next dynamic import re-evaluates getPty
      // and re-invokes the hoisted mock factories with the mode the test sets.
      vi.resetModules();
      resetPtyState();
    });

    // Leave the shared mode as the real-module passthrough so the
    // runtime-selection suites below observe the genuine backends.
    afterEach(resetPtyState);

    it.skipIf(isBunPosix())(
      'returns null when no node-pty backend can be loaded',
      async () => {
        ptyState.mode = 'both-fail';

        const module = await import('./getPty.js');

        await expect(module.getPty()).resolves.toBeNull();
      },
    );

    it.skipIf(isBunPosix())(
      'falls back to node-pty when @lydell/node-pty cannot be loaded',
      async () => {
        const fallbackModule: PtyLike = { spawn: vi.fn() };
        ptyState.mode = 'primary-fail';
        ptyState.fallback = fallbackModule;

        const module = await import('./getPty.js');
        const pty = await module.getPty();

        expect(pty).toStrictEqual({ module: fallbackModule, name: 'node-pty' });
      },
    );

    it.skipIf(isBunPosix())(
      'uses @lydell/node-pty when the primary backend loads',
      async () => {
        const primaryModule: PtyLike = { spawn: vi.fn() };
        ptyState.mode = 'primary-ok';
        ptyState.primary = primaryModule;

        const module = await import('./getPty.js');
        const pty = await module.getPty();

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
        const module = await import('./getPty.js');
        const pty = requirePty(await module.getPty(), 'bun-pty');
        expect(pty.name).toBe('bun-pty');
        expect(typeof pty.module.spawn).toBe('function');
      },
    );
  });

  describe('getPty runtime selection (Node)', () => {
    it.skipIf(isBunPosix())(
      'returns a node-pty backend outside Bun POSIX',
      async () => {
        // The shared mode stays at passthrough here, so getPty runs its real
        // selection logic against the genuinely installed backend.
        const module = await import('./getPty.js');
        const pty = requirePty(await module.getPty(), 'node-pty');
        expect(PTY_BACKENDS).toContain(pty.name);
        expect(typeof pty.module.spawn).toBe('function');
      },
    );
  });
});
