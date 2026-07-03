/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveBunEntry } from './bun-entry-resolver.js';

describe('resolveBunEntry', () => {
  it('prefers source TS entry packages/cli/index.ts when readable', async () => {
    const pathChecker = vi.fn(
      async (target: string) => target === '/repo/packages/cli/index.ts',
    );

    const result = await resolveBunEntry({
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
    });

    expect(result).toBe('/repo/packages/cli/index.ts');
  });

  it('returns null when source entry is not readable and the dist/src/launcher layout is absent', async () => {
    const pathChecker = vi.fn(async () => false);

    const result = await resolveBunEntry({
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
    });

    expect(result).toBeNull();
  });

  it('returns null when the injected pathChecker throws', async () => {
    const pathChecker = vi.fn(async () => {
      throw new Error('EACCES: permission denied');
    });

    const result = await resolveBunEntry({
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
    });

    expect(result).toBeNull();
  });

  it('returns null when moduleDir is an empty string', async () => {
    const pathChecker = vi.fn(async () => false);

    const result = await resolveBunEntry({
      moduleDir: '',
      pathChecker,
    });

    expect(result).toBeNull();
  });

  it('prefers the source entry when it is readable', async () => {
    const pathChecker = vi.fn(async () => true);

    const result = await resolveBunEntry({
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
    });

    expect(result).toBe('/repo/packages/cli/index.ts');
  });

  describe('installed workspace layout (dist/src/launcher)', () => {
    it('resolves dist/index.js when running from dist/src/launcher and source entry is absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === '/inst/@vybestack/llxprt-code/dist/index.js',
      );

      const result = await resolveBunEntry({
        moduleDir: '/inst/@vybestack/llxprt-code/dist/src/launcher',
        pathChecker,
      });

      expect(result).toBe('/inst/@vybestack/llxprt-code/dist/index.js');
    });

    it('prefers source entry over dist/index.js in a monorepo checkout', async () => {
      const pathChecker = vi.fn(async () => true);

      const result = await resolveBunEntry({
        moduleDir: '/repo/packages/cli/dist/src/launcher',
        pathChecker,
      });

      expect(result).toBe('/repo/packages/cli/index.ts');
    });

    it('climbs from dist/src/launcher to find dist/index.js at package root', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target ===
          '/global/lib/node_modules/@vybestack/llxprt-code/dist/index.js',
      );

      const result = await resolveBunEntry({
        moduleDir:
          '/global/lib/node_modules/@vybestack/llxprt-code/dist/src/launcher',
        pathChecker,
      });

      expect(result).toBe(
        '/global/lib/node_modules/@vybestack/llxprt-code/dist/index.js',
      );
    });

    it('returns null when dist/index.js is absent in installed layout', async () => {
      const pathChecker = vi.fn(async () => false);

      const result = await resolveBunEntry({
        moduleDir: '/inst/@vybestack/llxprt-code/dist/src/launcher',
        pathChecker,
      });

      expect(result).toBeNull();
    });

    it('returns null when no entry is readable from a dist/src/launcher layout', async () => {
      const pathChecker = vi.fn(async () => false);

      const result = await resolveBunEntry({
        moduleDir: '/other/dist/src/launcher',
        pathChecker,
      });

      expect(result).toBeNull();
    });

    it('does not resolve a stray dist/index.js when moduleDir has a dist ancestor but not the dist/src/launcher layout', async () => {
      // moduleDir is under .../dist/sub/launcher, NOT dist/src/launcher.
      // A resolver that anchors on any ancestor named "dist" would wrongly
      // grab .../dist/index.js. It must require the dist/src/launcher layout.
      const pathChecker = vi.fn(
        async (target: string) => target === '/opt/foo/dist/index.js',
      );

      const result = await resolveBunEntry({
        moduleDir: '/opt/foo/dist/sub/launcher',
        pathChecker,
      });

      expect(result).toBeNull();
    });

    it('ignores a substring "dist" in a path component that is not the actual dist/src/launcher layout', async () => {
      // "distribution" contains the substring "dist". A loose includes('dist')
      // gate would wrongly engage dist resolution. The resolver must anchor on
      // the real dist/src/launcher layout suffix, not a substring.
      const pathChecker = vi.fn(async (target: string) =>
        target.endsWith('/dist/index.js'),
      );

      const result = await resolveBunEntry({
        moduleDir: '/opt/distribution/cli/src/launcher',
        pathChecker,
      });

      expect(result).toBeNull();
    });

    it('does not resolve dist/index.js from an unrelated dist/src/launcher without a readable package entry', async () => {
      const pathChecker = vi.fn(async () => false);

      const result = await resolveBunEntry({
        moduleDir: '/stray/dist/src/launcher',
        pathChecker,
      });

      expect(result).toBeNull();
    });

    it('terminates ancestor climbing at filesystem root when no entry is readable', async () => {
      const pathChecker = vi.fn(async () => false);

      const result = await resolveBunEntry({
        moduleDir: '/',
        pathChecker,
      });

      expect(result).toBeNull();
    });

    it('resolves dist/index.js only when the moduleDir is exactly under dist/src/launcher', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === '/pkg/@vybestack/llxprt-code/dist/index.js',
      );

      const result = await resolveBunEntry({
        moduleDir: '/pkg/@vybestack/llxprt-code/dist/src/launcher',
        pathChecker,
      });

      expect(result).toBe('/pkg/@vybestack/llxprt-code/dist/index.js');
    });

    it('matches the dist/src/launcher layout case-insensitively (Windows)', async () => {
      const pathChecker = vi.fn(
        async (target: string) => target === 'C:/pkg/llxprt-code/Dist/index.js',
      );

      const result = await resolveBunEntry({
        moduleDir: 'C:/pkg/llxprt-code/Dist/Src/Launcher',
        pathChecker,
      });

      expect(result).toBe('C:/pkg/llxprt-code/Dist/index.js');
    });
  });
});
