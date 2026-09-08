/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it, vi } from 'bun:test';
import path from 'node:path';
import { resolveBunEntry } from './bun-entry-resolver.js';

describe('resolveBunEntry', () => {
  it('prefers source TS entry packages/cli/index.ts when readable', async () => {
    const pathChecker = vi.fn(
      async (target: string) =>
        target === path.resolve('/repo/packages/cli/index.ts'),
    );

    const result = await resolveBunEntry({
      moduleDir: path.resolve('/repo/packages/cli/src/launcher'),
      pathChecker,
    });

    expect(result).toBe(path.resolve('/repo/packages/cli/index.ts'));
  });

  it('returns null when source entry is not readable and the dist/src/launcher layout is absent', async () => {
    const pathChecker = vi.fn(async () => false);

    const result = await resolveBunEntry({
      moduleDir: path.resolve('/repo/packages/cli/src/launcher'),
      pathChecker,
    });

    expect(result).toBeNull();
  });

  it('returns null when the injected pathChecker throws', async () => {
    const pathChecker = vi.fn(async () => {
      throw new Error('EACCES: permission denied');
    });

    const result = await resolveBunEntry({
      moduleDir: path.resolve('/repo/packages/cli/src/launcher'),
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

  it('returns the source entry when no bundle is present but source is readable', async () => {
    const source = path.resolve('/repo/packages/cli/index.ts');
    const pathChecker = vi.fn(async (target: string) => target === source);

    const result = await resolveBunEntry({
      moduleDir: path.resolve('/repo/packages/cli/src/launcher'),
      pathChecker,
    });

    expect(result).toBe(source);
  });

  describe('prebuilt CLI bundle preference (issue #2999)', () => {
    const cliDir = path.resolve('/repo/packages/cli');
    const bundlePath = path.join(cliDir, 'bundle', 'llxprt.js');
    const sourcePath = path.join(cliDir, 'index.ts');
    const launcherDir = path.join(cliDir, 'src', 'launcher');

    it('resolves the prebuilt bundle when both bundle and source exist', async () => {
      const pathChecker = vi.fn(async (target: string) =>
        [bundlePath, sourcePath].includes(target),
      );

      const result = await resolveBunEntry({
        moduleDir: launcherDir,
        pathChecker,
      });

      expect(result).toBe(bundlePath);
    });

    function isInstalledEntryCandidate(
      target: string,
      installedBundlePath: string,
    ): boolean {
      return (
        target === installedBundlePath ||
        target.endsWith('index.ts') ||
        target.endsWith('index.js')
      );
    }

    it('prefers the bundle in an installed layout even when every candidate path exists', async () => {
      const instDir = path.resolve(
        '/global/lib/node_modules/@vybestack/llxprt-code',
      );
      const instBundle = path.join(instDir, 'bundle', 'llxprt.js');
      // Accept the source/dist entries too, not just the bundle. A checker
      // that accepts only the bundle would still pass if the bundle were
      // consulted last; making the other candidates "exist" proves the bundle
      // actually wins the precedence contest.
      const pathChecker = vi.fn(async (target: string) =>
        isInstalledEntryCandidate(target, instBundle),
      );

      const result = await resolveBunEntry({
        moduleDir: path.join(instDir, 'src', 'launcher'),
        pathChecker,
      });

      expect(result).toBe(instBundle);
    });

    it('falls back to source index.ts when the bundle is absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) => target === sourcePath,
      );

      const result = await resolveBunEntry({
        moduleDir: launcherDir,
        pathChecker,
      });

      expect(result).toBe(sourcePath);
    });

    it('resolves source when forceSourceEntry is true even if a bundle exists', async () => {
      const pathChecker = vi.fn(async (target: string) =>
        [bundlePath, sourcePath].includes(target),
      );

      const result = await resolveBunEntry({
        moduleDir: launcherDir,
        pathChecker,
        forceSourceEntry: true,
      });

      expect(result).toBe(sourcePath);
    });

    it('honors LLXPRT_FORCE_SOURCE_ENTRY=1 from the environment', async () => {
      // The option and the env var must be interchangeable: the launchers set
      // the env var, while in-process callers pass the option.
      const pathChecker = vi.fn(async (target: string) =>
        [bundlePath, sourcePath].includes(target),
      );
      setEnv('LLXPRT_FORCE_SOURCE_ENTRY', '1');

      try {
        const result = await resolveBunEntry({
          moduleDir: launcherDir,
          pathChecker,
        });

        expect(result).toBe(sourcePath);
      } finally {
        restoreEnv();
      }
    });

    it('returns null under force-source when the source is missing but a bundle exists', async () => {
      // The escape hatch is strict: falling back to the bundle here would run
      // exactly the artifact the caller asked to bypass, silently.
      const pathChecker = vi.fn(
        async (target: string) => target === bundlePath,
      );

      const result = await resolveBunEntry({
        moduleDir: launcherDir,
        pathChecker,
        forceSourceEntry: true,
      });

      expect(result).toBeNull();
    });

    it('returns null when neither bundle nor source is readable', async () => {
      const pathChecker = vi.fn(async () => false);

      const result = await resolveBunEntry({
        moduleDir: launcherDir,
        pathChecker,
      });

      expect(result).toBeNull();
    });

    it('prefers the bundle over the dist entry in an installed layout', async () => {
      const instDir = path.resolve(
        '/global/lib/node_modules/@vybestack/llxprt-code',
      );
      const instBundle = path.join(instDir, 'bundle', 'llxprt.js');
      const instDist = path.join(instDir, 'dist', 'index.js');
      const pathChecker = vi.fn(async (target: string) =>
        [instBundle, instDist].includes(target),
      );

      const result = await resolveBunEntry({
        moduleDir: path.join(instDir, 'dist', 'src', 'launcher'),
        pathChecker,
      });

      expect(result).toBe(instBundle);
    });
  });

  describe('installed workspace layout (dist/src/launcher)', () => {
    it('resolves dist/index.js when running from dist/src/launcher and source entry is absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === path.resolve('/inst/@vybestack/llxprt-code/dist/index.js'),
      );

      const result = await resolveBunEntry({
        moduleDir: path.resolve(
          '/inst/@vybestack/llxprt-code/dist/src/launcher',
        ),
        pathChecker,
      });

      expect(result).toBe(
        path.resolve('/inst/@vybestack/llxprt-code/dist/index.js'),
      );
    });

    it('prefers source entry over dist/index.js in a monorepo checkout with no bundle', async () => {
      const source = path.resolve('/repo/packages/cli/index.ts');
      const distEntry = path.resolve('/repo/packages/cli/dist/index.js');
      // Bundle is absent; source must win over dist.
      const pathChecker = vi.fn(async (target: string) =>
        [source, distEntry].includes(target),
      );

      const result = await resolveBunEntry({
        moduleDir: path.resolve('/repo/packages/cli/dist/src/launcher'),
        pathChecker,
      });

      expect(result).toBe(source);
    });

    it('climbs from dist/src/launcher to find dist/index.js at package root', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target ===
          path.resolve(
            '/global/lib/node_modules/@vybestack/llxprt-code/dist/index.js',
          ),
      );

      const result = await resolveBunEntry({
        moduleDir: path.resolve(
          '/global/lib/node_modules/@vybestack/llxprt-code/dist/src/launcher',
        ),
        pathChecker,
      });

      expect(result).toBe(
        path.resolve(
          '/global/lib/node_modules/@vybestack/llxprt-code/dist/index.js',
        ),
      );
    });

    it('returns null when dist/index.js is absent in installed layout', async () => {
      const pathChecker = vi.fn(async () => false);

      const result = await resolveBunEntry({
        moduleDir: path.resolve(
          '/inst/@vybestack/llxprt-code/dist/src/launcher',
        ),
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
        async (target: string) =>
          target === path.resolve('/opt/foo/dist/index.js'),
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
        target.endsWith(path.join('dist', 'index.js')),
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
          target === path.resolve('/pkg/@vybestack/llxprt-code/dist/index.js'),
      );

      const result = await resolveBunEntry({
        moduleDir: path.resolve(
          '/pkg/@vybestack/llxprt-code/dist/src/launcher',
        ),
        pathChecker,
      });

      expect(result).toBe(
        path.resolve('/pkg/@vybestack/llxprt-code/dist/index.js'),
      );
    });

    it('matches the dist/src/launcher layout case-insensitively', async () => {
      const moduleDir = path.join(
        path.parse(process.cwd()).root,
        'pkg',
        'llxprt-code',
        'Dist',
        'Src',
        'Launcher',
      );
      const launcherEntryPath = path.join(
        path.dirname(path.dirname(moduleDir)),
        'index.js',
      );
      const pathChecker = vi.fn(
        async (target: string) => target === launcherEntryPath,
      );

      const result = await resolveBunEntry({ moduleDir, pathChecker });

      expect(result).toBe(launcherEntryPath);
    });
  });
});
