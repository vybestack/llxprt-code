/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Install-layout + runtime-resolution coverage for the optional runtime
 * plugin topology (issue #2759), extending the issue-2603 artifact suites.
 *
 * The sibling issue-2603 suites prove what a BASE install puts on disk. This
 * suite proves the plugin dimension of the same contract using the same
 * techniques: real on-disk fixtures shaped like a global install, no network,
 * no repo-root mutation:
 *
 *   base only                → discovery finds nothing, requesting Gemini is
 *                              not resolvable (loader semantics: absent).
 *   base + Gemini plugin     → the installed package is discovered and the
 *                              real loader validates its manifest and
 *                              registers its factory; built-ins survive.
 *   base + google-mcp-auth   → same, for the reserved stub context.
 *
 * Discovery and loading run through the REAL landed #2758 code paths
 * (`discoverRuntimePluginPackages` + `loadRuntimePlugins`); only the module
 * import boundary is aimed at the fixture-installed package copy, which is
 * exactly the dependency-injection seam the loader documents for callers.
 * The npm-context check (what `npm pack` actually ships) runs `npm pack
 * --dry-run --json` per plugin and pins the published file set to the
 * allow-listed layout.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  discoverRuntimePluginPackages,
  loadRuntimePlugins,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { RuntimePluginDiscoveryDeps } from '@vybestack/llxprt-code-providers/composition.js';
import {
  FIRST_PARTY_RUNTIME_PLUGIN_RELEASES,
  type FirstPartyRuntimePluginRelease,
} from '../utils/release-packages.ts';
import {
  asRecord,
  asRecordArray,
  asString,
  parseJsonRecords,
} from './typed-test-helpers.ts';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');

const isWindows = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Fixture install layout
// ---------------------------------------------------------------------------

/**
 * Builds an on-disk fixture shaped like a global install of the CLI plus the
 * named plugin packages, and returns the fixture root. The layout mirrors
 * what `npm i -g` produces:
 *
 *   <root>/lib/node_modules/@vybestack/llxprt-code/{package.json,dist/index.js}
 *   <root>/lib/node_modules/@vybestack/llxprt-plugin-<name>/{package.json,README.md,dist/index.ts}
 *
 * The CLI package carries no runtime-plugin marker; only real plugin packages
 * (copied verbatim from the repo plugin contexts) opt in via the marker. The
 * plugin's `dist` entry is materialized from the plugin source because bun
 * executes TypeScript directly and the shipped tarball's compiled entry has
 * the same named export; nothing in this suite depends on a prior build.
 */
function buildInstalledFixture(plugins: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'llxprt-plugin-layouts-'));

  const nodeModules = join(root, 'lib', 'node_modules');
  const cliDir = join(nodeModules, '@vybestack', 'llxprt-code');
  mkdirSync(join(cliDir, 'dist'), { recursive: true });
  writeFileSync(
    join(cliDir, 'package.json'),
    JSON.stringify(
      { name: '@vybestack/llxprt-code', version: '0.0.0-fixture' },
      null,
      2,
    ),
  );
  writeFileSync(join(cliDir, 'dist', 'index.js'), '// inert CLI entry\n');

  for (const pluginDir of plugins) {
    const sourceDir = join(repoRoot, 'plugins', pluginDir);
    const manifest = parseJsonObjectFile(join(sourceDir, 'package.json'));
    const packageName = asString(manifest['name']);
    const destDir = join(nodeModules, ...packageName.split('/'));
    mkdirSync(join(destDir, 'dist'), { recursive: true });
    cpSync(join(sourceDir, 'package.json'), join(destDir, 'package.json'));
    cpSync(join(sourceDir, 'README.md'), join(destDir, 'README.md'));
    cpSync(
      join(sourceDir, 'src', 'index.ts'),
      join(destDir, 'dist', 'index.ts'),
    );
  }

  return root;
}

function parseJsonObjectFile(path: string): Record<string, unknown> {
  return asRecord(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Runs `run` with a fresh fixture and removes it afterwards, so a failing
 * assertion never leaks temp state (the sibling suites register afterEach
 * disposals; a scoped helper keeps that guarantee per call site).
 */
function withInstalledFixture<T>(
  plugins: readonly string[],
  run: (fixtureRoot: string) => T,
): T {
  const root = buildInstalledFixture(plugins);
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Real-filesystem discovery deps anchored at the fixture's CLI entry. */
function discoveryDeps(fixtureRoot: string): RuntimePluginDiscoveryDeps {
  const cliEntry = join(
    fixtureRoot,
    'lib',
    'node_modules',
    '@vybestack',
    'llxprt-code',
    'dist',
    'index.js',
  );
  return {
    fromPath: cliEntry,
    exists: (path) => existsSync(path),
    listDir: (path) => readdirSync(path),
    readFile: (path) => readFileSync(path, 'utf8'),
  };
}

/**
 * Module-resolution boundary for the loader: accepts only BARE package names
 * (the provenance rule the CLI enforces before calling the loader) and
 * imports the package copy as installed in the fixture — the same module a
 * real global install would execute.
 */
function fixtureImporter(
  fixtureRoot: string,
): (specifier: string) => Promise<unknown> {
  return async (specifier: string) => {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      throw new Error(
        `runtime plugin specifier must be a bare package name, got '${specifier}'`,
      );
    }
    const segments = specifier.split('/');
    if (segments.length !== 2) {
      throw new Error(
        `expected a scoped bare package name, got '${specifier}'`,
      );
    }
    const installedEntry = join(
      fixtureRoot,
      'lib',
      'node_modules',
      segments[0],
      segments[1],
      'dist',
      'index.ts',
    );
    return import(pathToFileURL(installedEntry).href);
  };
}

/** An importModule that fails the test's expectations if the loader calls it. */
async function mustNotImport(specifier: string): Promise<unknown> {
  throw new Error(
    `loader imported '${specifier}' but the base-only install has no plugins`,
  );
}

/**
 * Looks up a first-party release by the plugin's bare directory name (the
 * convention this suite uses for fixture builders). Release entries carry the
 * repo-relative dir ('plugins/<name>'), so the key is qualified here.
 */
function releaseByDir(dir: string): FirstPartyRuntimePluginRelease {
  const release = FIRST_PARTY_RUNTIME_PLUGIN_RELEASES.find(
    (entry) => entry.dir === `plugins/${dir}`,
  );
  if (release === undefined) {
    throw new Error(`no first-party release entry for plugin dir '${dir}'`);
  }
  return release;
}

// ---------------------------------------------------------------------------
// Base-only install
// ---------------------------------------------------------------------------

describe('base-only install (issue-2603 layout, no plugin packages)', () => {
  it('discovers no runtime plugins', () => {
    withInstalledFixture([], (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      expect(discovered).toStrictEqual([]);
    });
  });

  it('leaves Gemini unresolvable and imports nothing', async () => {
    await withInstalledFixtureAsync([], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: mustNotImport,
      });
      expect(registry.getProviderFactory('google-gemini')).toBeUndefined();
      expect(registry.getProviderOrigin('google-gemini')).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Base + one plugin installed
// ---------------------------------------------------------------------------

describe('base + @vybestack/llxprt-plugin-google-gemini install', () => {
  const release = releaseByDir('google-gemini');

  it('discovers exactly the installed plugin by its manifest marker', () => {
    withInstalledFixture(['google-gemini'], (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      expect(discovered).toStrictEqual([release.name]);
    });
  });

  it('loads the installed package and registers its factory as plugin-origin', async () => {
    await withInstalledFixtureAsync(['google-gemini'], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: fixtureImporter(root),
      });
      expect(registry.getProviderFactory('google-gemini')).toBeTypeOf(
        'function',
      );
      expect(registry.getProviderOrigin('google-gemini')).toStrictEqual({
        kind: 'plugin',
        pluginId: release.name,
        specifier: release.name,
      });
    });
  });

  it('does not displace the built-in Gemini contribution', async () => {
    await withInstalledFixtureAsync(['google-gemini'], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: fixtureImporter(root),
      });
      expect(registry.getProviderOrigin('gemini')?.kind).toBe('builtin');
    });
  });
});

describe('base + @vybestack/llxprt-plugin-google-mcp-auth install', () => {
  const release = releaseByDir('google-mcp-auth');

  it('discovers exactly the reserved stub by its manifest marker', () => {
    withInstalledFixture(['google-mcp-auth'], (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      expect(discovered).toStrictEqual([release.name]);
    });
  });

  it('loads the reserved stub and registers its factory as plugin-origin', async () => {
    await withInstalledFixtureAsync(['google-mcp-auth'], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: fixtureImporter(root),
      });
      expect(registry.getProviderFactory('google-mcp-auth')).toBeTypeOf(
        'function',
      );
      expect(registry.getProviderOrigin('google-mcp-auth')).toStrictEqual({
        kind: 'plugin',
        pluginId: release.name,
        specifier: release.name,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Shipped layout: what `npm pack` would publish
// ---------------------------------------------------------------------------

describe('npm pack ships only the allow-listed plugin layout', () => {
  const allowedTopLevel = ['dist', 'README.md', 'package.json'];

  /**
   * Runs `npm pack --dry-run --json` in the release's repo-relative plugin
   * directory and returns the packed file paths. Takes the release entry so
   * the cwd derives from `release.dir` itself — re-prefixing a bare name here
   * is how a doubled `plugins/plugins/...` cwd (spawn ENOENT) would sneak in.
   */
  function packedFilePaths(release: FirstPartyRuntimePluginRelease): string[] {
    const result = spawnSync(
      'npm',
      ['pack', '--dry-run', '--json', '--loglevel=error'],
      {
        cwd: join(repoRoot, release.dir),
        encoding: 'utf8',
      },
    );
    if (result.error !== undefined) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `npm pack --dry-run failed for ${release.dir}: ${result.stderr}`,
      );
    }
    const records = parseJsonRecords(result.stdout);
    if (records.length !== 1) {
      throw new Error(
        `expected exactly one npm pack record for ${release.dir}, got ${records.length}`,
      );
    }
    const files = asRecordArray(records[0]['files']);
    const paths: string[] = [];
    for (const entry of files) {
      paths.push(asString(asRecord(entry)['path']));
    }
    return paths;
  }

  it.skipIf(isWindows)(
    'ships package.json, README, and dist only — never sources or lockfiles',
    () => {
      for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
        const paths = packedFilePaths(release);
        expect(paths).toContain('package.json');
        expect(paths).toContain('README.md');
        for (const path of paths) {
          const topLevel = path.split('/')[0];
          expect(allowedTopLevel).toContain(topLevel);
        }
        expect(paths.some((path) => path.startsWith('src/'))).toBe(false);
        expect(paths.some((path) => path.includes('tsconfig'))).toBe(false);
        expect(paths.some((path) => path.includes('bun.lock'))).toBe(false);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Async fixture wrapper (async test bodies cannot use the sync helper)
// ---------------------------------------------------------------------------

async function withInstalledFixtureAsync<T>(
  plugins: readonly string[],
  run: (fixtureRoot: string) => Promise<T>,
): Promise<T> {
  const root = buildInstalledFixture(plugins);
  try {
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
