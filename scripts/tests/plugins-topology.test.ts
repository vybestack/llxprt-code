/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Root-isolation guard for the optional runtime plugin package topology
 * (issue #2759).
 *
 * The plugin contexts under `plugins/` are deliberately OUTSIDE the root
 * workspace set: a root `npm install` / `bun install` must never install
 * plugin-only Google dependencies, and the root lockfiles must never gain
 * plugin workspace membership. This suite pins that boundary so a future
 * workspaces edit cannot silently absorb the plugin contexts, and it keeps
 * the explicit first-party release list in `scripts/utils/release-packages.ts`
 * aligned with the plugin publish steps in `.github/workflows/release.yml`.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import {
  FIRST_PARTY_RUNTIME_PLUGIN_RELEASES,
  RELEASE_PUBLISH_STEP_PREFIX,
} from '../utils/release-packages.ts';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');

interface RootManifest {
  workspaces?: unknown;
}

interface PluginManifest {
  name?: unknown;
  version?: unknown;
  llxprt?: unknown;
  peerDependencies?: unknown;
  devDependencies?: unknown;
  dependencies?: unknown;
  files?: unknown;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Parses a Bun lockfile, which is JSONC (the format Bun emits uses trailing
 * commas), with the same tolerant parser tooling consumes. Parse errors are
 * surfaced as a thrown failure rather than silently yielding a partial
 * object, mirroring the readBunLock pattern in bun-workspaces.test.ts.
 */
function readBunLock(path: string): unknown {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(readFileSync(path, 'utf8'), errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0 || parsed === undefined) {
    throw new Error(
      `${path} is not parseable as JSONC (${errors.length} parse error(s)); ` +
        'the lockfile may be corrupted.',
    );
  }
  return parsed;
}

function pluginDir(relativeDir: string): string {
  return join(repoRoot, relativeDir);
}

describe('plugin contexts live outside the root workspace set', () => {
  it('root workspaces exclude the plugins tree', () => {
    const manifest = readJson(join(repoRoot, 'package.json')) as RootManifest;
    expect(Array.isArray(manifest.workspaces)).toBe(true);
    const workspaces = manifest.workspaces as readonly unknown[];
    const pluginWorkspace = workspaces.find(
      (entry) => typeof entry === 'string' && entry.startsWith('plugins'),
    );
    expect(pluginWorkspace).toBeUndefined();
  });

  it('each reserved plugin context exists on disk with its own manifest', () => {
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      expect(existsSync(pluginDir(release.dir))).toBe(true);
      expect(existsSync(join(pluginDir(release.dir), 'package.json'))).toBe(
        true,
      );
    }
  });

  it('root bun.lock has no plugin workspace membership and no plugin dependencies', () => {
    const lock = readBunLock(join(repoRoot, 'bun.lock')) as {
      workspaces?: Record<string, unknown>;
    };
    const workspaceKeys = Object.keys(lock.workspaces ?? {});
    expect(
      workspaceKeys.filter((key) => key.startsWith('plugins')),
    ).toStrictEqual([]);

    const serialized = JSON.stringify(lock);
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      expect(serialized).not.toContain(release.name);
    }
  });

  it('root package-lock.json has no plugin package entries', () => {
    const lockPath = join(repoRoot, 'package-lock.json');
    expect(existsSync(lockPath)).toBe(true);
    const serialized = readFileSync(lockPath, 'utf8');
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      expect(serialized).not.toContain(`"${release.name}"`);
      expect(serialized).not.toContain(`"plugins/${release.dir.split('/')[1]}`);
    }
  });
});

describe('each plugin context is a self-contained release unit', () => {
  it('declares the discovery marker the #2758 loader scans for', () => {
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      const manifest = readJson(
        join(pluginDir(release.dir), 'package.json'),
      ) as PluginManifest;
      expect(manifest.name).toBe(release.name);
      expect(manifest.llxprt).toStrictEqual({ runtimePlugin: true });
    }
  });

  it('declares host packages as peerDependencies, never runtime dependencies', () => {
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      const manifest = readJson(
        join(pluginDir(release.dir), 'package.json'),
      ) as PluginManifest;
      const peers = manifest.peerDependencies as Record<string, string>;
      expect(Object.keys(peers).sort()).toStrictEqual([
        '@vybestack/llxprt-code-core',
        '@vybestack/llxprt-code-providers',
      ]);
      expect(peers['@vybestack/llxprt-code-core']).toMatch(/^\^0\.12\.0$/);
      expect(peers['@vybestack/llxprt-code-providers']).toMatch(
        /^\^0\.12\.0$/,
      );
      const runtimeDeps = Object.keys(
        (manifest.dependencies as Record<string, string>) ?? {},
      );
      expect(runtimeDeps).toStrictEqual([]);
    }
  });

  it('installs toolchain-only devDependencies; host packages never appear as deps', () => {
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      const manifest = readJson(
        join(pluginDir(release.dir), 'package.json'),
      ) as PluginManifest;
      const devDeps = (manifest.devDependencies ?? {}) as Record<
        string,
        string
      >;
      // Toolchain stays registry-pinned exactly as before.
      expect(devDeps['@types/bun']).toBe('1.3.14');
      expect(devDeps['@types/node']).toBe('^24.2.1');
      expect(devDeps['typescript']).toBe('5.8.3');
      // Host packages must NOT be linked here: a relative file: dev link
      // makes bun re-resolve the host packages' own unpublished workspace
      // dependencies and the install fails (issue #2759). The repo context
      // provides host types via tsconfig paths instead.
      expect(devDeps['@vybestack/llxprt-code-core']).toBeUndefined();
      expect(devDeps['@vybestack/llxprt-code-providers']).toBeUndefined();
      expect(Object.keys(devDeps).sort()).toStrictEqual([
        '@types/bun',
        '@types/node',
        'typescript',
      ]);
      expect(
        Object.keys((manifest.dependencies as Record<string, string>) ?? {}),
      ).toStrictEqual([]);
    }
  });

  it('requires a bun version that can re-install the unresolved-peer lock', () => {
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      const manifest = readJson(
        join(pluginDir(release.dir), 'package.json'),
      ) as { engines?: { bun?: unknown } };
      // bun 1.3.x rejects the plugin lockfile (unresolved root peers) on
      // every install after the first and hangs re-resolving; 1.4.2 fixed
      // it. The engines floor keeps plugin-local installs honest.
      expect(manifest.engines?.bun).toBe('>=1.4.2');
    }
  });

  it('ships only build output and README, never host or source code', () => {
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      const manifest = readJson(
        join(pluginDir(release.dir), 'package.json'),
      ) as PluginManifest;
      expect(manifest.files).toStrictEqual(['dist', 'README.md']);
    }
  });

  it('has its own bun.lock whose root workspace is the plugin package', () => {
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      const lockPath = join(pluginDir(release.dir), 'bun.lock');
      expect(existsSync(lockPath)).toBe(true);
      const lock = readBunLock(lockPath) as {
        workspaces?: Record<
          string,
          {
            name?: string;
            devDependencies?: Record<string, unknown>;
          }
        >;
        packages?: Record<string, unknown>;
      };
      const rootEntry = lock.workspaces?.[''];
      expect(rootEntry?.name).toBe(release.name);
      // The install is toolchain-only: `bun install --omit=peer` inside the
      // plugin directory (issue #2759). Peers are provided by the host at
      // real runtime; no registry publish of the host packages at these
      // caret ranges exists to resolve them during development.
      const rootDevDeps = (rootEntry?.devDependencies ?? {}) as Record<
        string,
        unknown
      >;
      expect(Object.keys(rootDevDeps).sort()).toStrictEqual([
        '@types/bun',
        '@types/node',
        'typescript',
      ]);
      // Peers stay recorded as the consumer-facing contract on the root
      // workspace entry, and the resolved-package graph contains NO host
      // resolutions at all: neither registry entries (the caret ranges can
      // never truthfully resolve today) nor repo-relative file: links
      // (linking hosts re-resolves their unpublished workspace deps and
      // breaks the install).
      const rootPeers = (rootEntry as unknown as {
        peerDependencies?: Record<string, unknown>;
      }).peerDependencies;
      expect(Object.keys(rootPeers ?? {}).sort()).toStrictEqual([
        '@vybestack/llxprt-code-core',
        '@vybestack/llxprt-code-providers',
      ]);
      const packages = (lock.packages ?? {}) as Record<string, unknown>;
      const serialized = JSON.stringify(packages);
      expect(serialized).not.toContain('@vybestack/');
    }
  });
});

describe('release automation publishes plugins from the explicit list', () => {
  const releaseYml = readFileSync(
    join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );

  it('publishes each plugin after the base CLI package, in list order', () => {
    const cliStep = releaseYml.indexOf(
      'Publish @vybestack/llxprt-code\n',
      releaseYml.indexOf('Publish @vybestack/llxprt-code-zed-acp'),
    );
    expect(cliStep).toBeGreaterThan(-1);

    let cursor = cliStep;
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      const step = releaseYml.indexOf(
        `${RELEASE_PUBLISH_STEP_PREFIX}${release.name}`,
        cursor,
      );
      expect(step).toBeGreaterThan(-1);
      cursor = step;
    }
  });

  it('does not derive the plugin list by scanning the plugins directory', () => {
    expect(releaseYml).not.toMatch(/plugins\/\*/);
    expect(releaseYml).not.toMatch(/ls plugins/);
  });
});
