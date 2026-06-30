/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { isBunPosix } from './runtime.js';

const PTY_BACKENDS = ['lydell-node-pty', 'node-pty'] as const;

function requirePty<T>(pty: T | null, backend: string): T {
  expect(pty).not.toBeNull();
  if (pty === null) {
    throw new Error(`expected ${backend} backend`);
  }
  return pty;
}

describe('getPty unavailable backend handling', () => {
  afterEach(() => {
    vi.doUnmock('@lydell/node-pty');
    vi.doUnmock('node-pty');
    vi.resetModules();
  });

  it.skipIf(isBunPosix())(
    'returns null when no node-pty backend can be loaded',
    async () => {
      vi.doMock('@lydell/node-pty', () => {
        throw new Error('primary pty unavailable');
      });
      vi.doMock('node-pty', () => {
        throw new Error('fallback pty unavailable');
      });

      const module = await import('./getPty.js');

      await expect(module.getPty()).resolves.toBeNull();
    },
  );

  it.skipIf(isBunPosix())(
    'falls back to node-pty when @lydell/node-pty cannot be loaded',
    async () => {
      const fallbackModule = { spawn: vi.fn() };
      vi.doMock('@lydell/node-pty', () => {
        throw new Error('primary pty unavailable');
      });
      vi.doMock('node-pty', () => fallbackModule);

      const module = await import('./getPty.js');
      const pty = await module.getPty();

      expect(pty).toStrictEqual({ module: fallbackModule, name: 'node-pty' });
    },
  );

  it.skipIf(isBunPosix())(
    'uses @lydell/node-pty when the primary backend loads',
    async () => {
      const primaryModule = { spawn: vi.fn() };
      vi.doMock('@lydell/node-pty', () => primaryModule);
      vi.doMock('node-pty', () => {
        throw new Error('fallback pty should not be loaded');
      });

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
      const module = await import('./getPty.js');
      const pty = requirePty(await module.getPty(), 'node-pty');
      expect(PTY_BACKENDS).toContain(pty.name);
      expect(typeof pty.module.spawn).toBe('function');
    },
  );
});
