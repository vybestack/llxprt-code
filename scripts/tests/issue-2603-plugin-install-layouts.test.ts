/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Install-layout + runtime-resolution coverage for the optional runtime
 * plugin topology (issue #2759), extending the issue-2603 artifact suites and
 * pinning the plugin-era Gemini contract (#2763).
 *
 * The sibling issue-2603 suites prove what a BASE install puts on disk. This
 * suite proves the plugin dimension of the same contract using the same
 * techniques: real on-disk fixtures shaped like a global install, no network,
 * no repo-root mutation:
 *
 *   base only                → discovery finds nothing; there is NO built-in
 *                              `gemini` provider or alias (the base stopped
 *                              shipping one in #2763); a leftover `gemini`
 *                              alias fails with an error naming the plugin
 *                              that provides it.
 *   base + Gemini plugin     → the installed package is discovered and the
 *                              real loader validates its manifest, registers
 *                              the `gemini` provider id as plugin-origin, and
 *                              contributes the `gemini` builtin alias with
 *                              the exact config the base used to ship.
 *   base + google-mcp-auth   → the installed package is discovered and the
 *                              real loader validates its manifest and
 *                              registers exactly its two MCP auth factories
 *                              (google_credentials,
 *                              service_account_impersonation) — no provider
 *                              (the plugin stopped shipping a stub in #2764).
 *   base + malformed plugin  → a discovered plugin exporting an incompatible
 *                              manifest fails actionably, never silently.
 *
 * Discovery and loading run through the REAL landed #2758 code paths
 * (`discoverRuntimePluginPackages` + `loadRuntimePlugins`); only the module
 * import boundary is aimed at the fixture-installed package copy, which is
 * exactly the dependency-injection seam the loader documents for callers.
 * The fixture materializes the plugin's full source tree as `dist` (bun
 * executes TypeScript directly) and links the plugin's own installed
 * dependencies plus the host peer packages, so the imported module graph is
 * the one a real global install would execute — including the plugin's
 * `@ai-sdk/google` runtime dependency. The npm-context check (what `npm pack`
 * actually ships) runs `npm pack --dry-run --json` per plugin and pins the
 * published file set to the allow-listed layout.
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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  OAuthManager,
  createTokenStore,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  discoverRuntimePluginPackages,
  loadRuntimePlugins,
  registerAliasProviders,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { RuntimePluginDiscoveryDeps } from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderAliasEntry } from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
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
 *   <root>/lib/node_modules/@vybestack/llxprt-plugin-<name>/{package.json,README.md,dist/**}
 *   <root>/lib/node_modules/@vybestack/llxprt-plugin-<name>/node_modules/**
 *   <root>/lib/node_modules/@vybestack/llxprt-code-{core,providers,settings}
 *
 * The CLI package carries no runtime-plugin marker; only real plugin packages
 * (copied verbatim from the repo plugin contexts) opt in via the marker. The
 * plugin's `dist` entry is materialized from the plugin's full source tree
 * because bun executes TypeScript directly and the shipped tarball's compiled
 * entry has the same named export; nothing in this suite depends on a prior
 * build. The plugin's already-installed local dependencies (pinned by the
 * plugin context's own bun.lock — for google-gemini that includes
 * `@ai-sdk/google`) are linked into the plugin's nested `node_modules`, and
 * the host peer packages are linked at the top level, exactly where a real
 * global install resolves them from. Without the local-dependency link the
 * plugin module graph cannot resolve `@ai-sdk/google` from a /tmp fixture
 * (the root cause of the #2763 layout-test failures).
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

  linkHostPeerPackages(nodeModules);

  for (const pluginDir of plugins) {
    const sourceDir = join(repoRoot, 'plugins', pluginDir);
    const manifest = parseJsonObjectFile(join(sourceDir, 'package.json'));
    const packageName = asString(manifest['name']);
    const destDir = join(nodeModules, ...packageName.split('/'));
    mkdirSync(join(destDir, 'dist'), { recursive: true });
    cpSync(join(sourceDir, 'package.json'), join(destDir, 'package.json'));
    cpSync(join(sourceDir, 'README.md'), join(destDir, 'README.md'));
    copyPluginSourceTree(sourceDir, destDir);
    linkPluginLocalDependencies(sourceDir, destDir);
  }

  return root;
}

/**
 * Copies the plugin's TypeScript source tree into the fixture's `dist`,
 * excluding test files (tests never ship; the installed copy mirrors dist).
 */
function copyPluginSourceTree(sourceDir: string, destDir: string): void {
  const srcDir = join(sourceDir, 'src');
  cpSync(srcDir, join(destDir, 'dist'), {
    recursive: true,
    filter: (source: string): boolean => {
      const relativePath = relative(srcDir, source);
      if (relativePath === '') {
        return true;
      }
      if (relativePath.endsWith('.test.ts')) {
        return false;
      }
      return relativePath.split(sep)[0] !== 'test';
    },
  });
}

/**
 * Host packages the plugin's module graph resolves against. In a real global
 * install the host provides the plugin's peer dependencies at the top-level
 * node_modules; the fixture mirrors that shape. Since #2764 the
 * google-mcp-auth plugin resolves auth, mcp, and telemetry directly (not
 * only through core/providers), so the fixture links every host package the
 * plugin contexts import.
 */
const HOST_PEER_PACKAGES = [
  '@vybestack/llxprt-code-auth',
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-mcp',
  '@vybestack/llxprt-code-providers',
  '@vybestack/llxprt-code-settings',
  '@vybestack/llxprt-code-telemetry',
] as const;

function linkHostPeerPackages(nodeModules: string): void {
  const scopedDir = join(nodeModules, '@vybestack');
  mkdirSync(scopedDir, { recursive: true });
  for (const hostPackage of HOST_PEER_PACKAGES) {
    const unscoped = hostPackage.split('/')[1];
    const repoLink = join(repoRoot, 'node_modules', '@vybestack', unscoped);
    if (!existsSync(repoLink)) {
      throw new Error(
        `expected the host package link at ${repoLink}; run 'bun install' ` +
          'at the repo root before running this suite.',
      );
    }
    materializeNode(repoLink, join(scopedDir, unscoped));
  }
}

/**
 * Links the plugin's already-installed local dependencies into the fixture's
 * nested `plugin/node_modules` — the npm shape for a package's own
 * dependencies, and the resolution source of truth the plugin context's
 * bun.lock pins. A plugin that declares runtime dependencies without a local
 * install fails here with the command that fixes it.
 */
function linkPluginLocalDependencies(sourceDir: string, destDir: string): void {
  const manifest = parseJsonObjectFile(join(sourceDir, 'package.json'));
  const runtimeDeps = Object.keys(
    (manifest['dependencies'] ?? {}) as Record<string, string>,
  );
  const sourceModules = join(sourceDir, 'node_modules');
  if (runtimeDeps.length > 0 && !existsSync(sourceModules)) {
    throw new Error(
      `plugin '${asString(manifest['name'])}' declares runtime dependencies ` +
        `but ${relative(repoRoot, sourceDir)} has no node_modules; run ` +
        `'bun install' in '${relative(repoRoot, sourceDir)}' before running ` +
        'this suite.',
    );
  }
  if (!existsSync(sourceModules)) {
    return;
  }
  const destModules = join(destDir, 'node_modules');
  mkdirSync(destModules, { recursive: true });
  for (const entry of readdirSync(sourceModules)) {
    materializeNode(join(sourceModules, entry), join(destModules, entry));
  }
}

/**
 * Links a directory into the fixture. Windows symlinks need privileges, so
 * that platform gets a dereferencing copy, which resolves identically.
 */
function materializeNode(source: string, dest: string): void {
  if (isWindows) {
    cpSync(source, dest, { recursive: true, dereference: true });
    return;
  }
  symlinkSync(source, dest, 'dir');
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
// Plugin-era Gemini contract fixtures
// ---------------------------------------------------------------------------

/**
 * The contributed alias config, byte-for-byte what the plugin declares (and
 * what the base package used to ship as composition/aliases/gemini.config
 * before #2763 moved the Gemini contribution into the plugin).
 */
const GEMINI_ALIAS_CONFIG = {
  name: 'gemini',
  modelsDevProviderId: 'google',
  description: 'Google Gemini API',
  baseProvider: 'gemini',
  'base-url': 'https://generativelanguage.googleapis.com',
  defaultModel: 'gemini-2.5-pro',
  apiKeyEnv: 'GEMINI_API_KEY',
} as const;

/**
 * A base-only install can still see a `gemini` alias: a user alias file
 * carried over from a pre-plugin install looks exactly like this. Requesting
 * it must fail with an error naming the plugin that now provides Gemini.
 */
const LEFTOVER_GEMINI_ALIAS: ProviderAliasEntry = {
  alias: 'gemini',
  config: { ...GEMINI_ALIAS_CONFIG },
  filePath: '~/.llxprt/providers/gemini.config',
  source: 'user',
};

const BASE_ONLY_OAUTH_MANAGER = new OAuthManager(
  createTokenStore(),
  undefined,
  {},
);

function makeBaseOnlyManager(): ProviderManager {
  return new ProviderManager({
    settingsService: new SettingsService() as never,
    runtimeId: 'issue-2603-plugin-install-layouts',
  });
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

  it('leaves the google-gemini provider id unresolvable and imports nothing', async () => {
    await withInstalledFixtureAsync([], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: mustNotImport,
      });
      expect(registry.getProviderFactory('google-gemini')).toBeUndefined();
      expect(registry.getProviderOrigin('google-gemini')).toBeUndefined();
    });
  });

  it('has no built-in gemini provider and advertises no gemini alias', async () => {
    await withInstalledFixtureAsync([], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: mustNotImport,
      });
      // Since #2763 the base ships no Gemini contribution at all: the
      // provider id, its origin, and the alias surface must all be empty
      // until the plugin is installed.
      expect(registry.getProviderFactory('gemini')).toBeUndefined();
      expect(registry.getProviderOrigin('gemini')).toBeUndefined();
      expect(registry.listProviderIds()).not.toContain('gemini');
      expect(registry.getContributedAliases()).toStrictEqual([]);
    });
  });

  it('fails actionably naming the plugin when a leftover alias requests gemini', async () => {
    await withInstalledFixtureAsync([], async (root) => {
      const baseOnlyRegistry = await loadRuntimePlugins(
        discoverRuntimePluginPackages(discoveryDeps(root)),
        { importModule: mustNotImport },
      );
      const manager = makeBaseOnlyManager();
      let thrown: unknown;
      try {
        registerAliasProviders(
          manager,
          [LEFTOVER_GEMINI_ALIAS],
          undefined,
          undefined,
          {},
          BASE_ONLY_OAUTH_MANAGER,
          undefined,
          false,
          { providerContributions: baseOnlyRegistry },
        );
      } catch (error) {
        thrown = error;
      }
      if (!(thrown instanceof Error)) {
        throw new Error(
          'expected registerAliasProviders to reject a gemini alias on a base-only install',
        );
      }
      expect(thrown.message).toContain(
        '@vybestack/llxprt-plugin-google-gemini',
      );
      expect(thrown.message).toContain('Install the runtime plugin');
      expect(manager.listProviders()).not.toContain('gemini');
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

  it('loads the installed package and registers the gemini provider as plugin-origin', async () => {
    await withInstalledFixtureAsync(['google-gemini'], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: fixtureImporter(root),
      });
      // The plugin owns the `gemini` provider id: the base ships no built-in
      // contribution for it (#2763), so plugin-origin is the only possibility.
      expect(registry.getProviderFactory('gemini')).toBeTypeOf('function');
      expect(registry.getProviderOrigin('gemini')).toStrictEqual({
        kind: 'plugin',
        pluginId: release.name,
        specifier: release.name,
      });
    });
  });

  it('contributes the gemini builtin alias with the exact plugin-era config', async () => {
    await withInstalledFixtureAsync(['google-gemini'], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: fixtureImporter(root),
      });
      expect(registry.getContributedAliases()).toStrictEqual([
        {
          alias: 'gemini',
          pluginId: release.name,
          config: { ...GEMINI_ALIAS_CONFIG },
        },
      ]);
    });
  });

  it('constructs a working provider from the installed gemini factory', async () => {
    await withInstalledFixtureAsync(['google-gemini'], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: fixtureImporter(root),
      });
      const factory = registry.getProviderFactory('gemini');
      if (factory === undefined) {
        throw new Error('expected the plugin-contributed gemini factory');
      }
      const provider = factory(
        {
          alias: 'gemini',
          config: { ...GEMINI_ALIAS_CONFIG },
          filePath: `plugin:${release.name}`,
          source: 'plugin',
        },
        {
          openaiApiKey: undefined,
          openaiBaseUrl: undefined,
          openaiProviderConfig: {},
          oauthManager: BASE_ONLY_OAUTH_MANAGER,
          config: undefined,
          authOnlyEnabled: false,
        },
      );
      // Constructing — not just resolving — proves the fixture-installed
      // module graph executes, including its @ai-sdk/google dependency.
      expect(provider.name).toBe('gemini');
      expect(typeof provider.generateChatCompletion).toBe('function');
    });
  });
});

describe('base + @vybestack/llxprt-plugin-google-mcp-auth install', () => {
  const release = releaseByDir('google-mcp-auth');

  it('discovers exactly the installed plugin by its manifest marker', () => {
    withInstalledFixture(['google-mcp-auth'], (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      expect(discovered).toStrictEqual([release.name]);
    });
  });

  it('loads the installed package and registers its MCP auth factories as plugin-origin', async () => {
    await withInstalledFixtureAsync(['google-mcp-auth'], async (root) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      const registry = await loadRuntimePlugins(discovered, {
        importModule: fixtureImporter(root),
      });
      // #2764: the plugin contributes MCP auth factories, not a provider.
      expect(registry.getProviderFactory('google-mcp-auth')).toBeUndefined();
      const factories = registry.getMcpAuthFactories();
      expect(
        factories.map((factory) => factory.contribution.authProviderType),
      ).toStrictEqual(['google_credentials', 'service_account_impersonation']);
      for (const factory of factories) {
        expect(factory.contribution.createAuthProvider).toBeTypeOf('function');
        expect(factory.origin).toStrictEqual({
          kind: 'plugin',
          pluginId: release.name,
          specifier: release.name,
        });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Malformed installed plugin
// ---------------------------------------------------------------------------

describe('base + a malformed plugin install', () => {
  /**
   * Builds a fixture whose installed plugin declares the discovery marker
   * (so real discovery finds it) but exports an incompatible manifest
   * (apiVersion 2). Everything else about the package is a real install.
   */
  function withIncompatibleManifestFixture<T>(
    run: (root: string, pluginName: string) => T,
  ): T {
    const root = buildInstalledFixture([]);
    try {
      const pluginName = '@vybestack/llxprt-plugin-google-gemini';
      const destDir = join(
        root,
        'lib',
        'node_modules',
        '@vybestack',
        'llxprt-plugin-google-gemini',
      );
      mkdirSync(join(destDir, 'dist'), { recursive: true });
      cpSync(
        join(repoRoot, 'plugins', 'google-gemini', 'package.json'),
        join(destDir, 'package.json'),
      );
      writeFileSync(
        join(destDir, 'dist', 'index.ts'),
        [
          '// Fixture: discovered marker, incompatible exported manifest.',
          'export const llxprtRuntimePlugin = {',
          '  apiVersion: 2,',
          `  id: '${pluginName}',`,
          '  providers: [],',
          '};',
          '',
        ].join('\n'),
      );
      return run(root, pluginName);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('rejects the discovered plugin actionably instead of ignoring it', async () => {
    await withIncompatibleManifestFixture(async (root, pluginName) => {
      const discovered = discoverRuntimePluginPackages(discoveryDeps(root));
      expect(discovered).toStrictEqual([pluginName]);
      let thrown: unknown;
      try {
        await loadRuntimePlugins(discovered, {
          importModule: fixtureImporter(root),
        });
      } catch (error) {
        thrown = error;
      }
      if (!(thrown instanceof Error)) {
        throw new Error(
          'expected loadRuntimePlugins to reject an incompatible plugin manifest',
        );
      }
      expect(thrown.message).toContain(pluginName);
      expect(thrown.message).toContain('apiVersion 2');
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
