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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { bindPluginPeerDeps } from '../bind-plugin-peers.ts';
import {
  FIRST_PARTY_RUNTIME_PLUGIN_RELEASES,
  RELEASE_PUBLISH_STEP_PREFIX,
  type FirstPartyRuntimePluginRelease,
} from '../utils/release-packages.ts';
import {
  asRecord,
  asString,
  jobSteps,
  parseWorkflowYaml,
  workflowJobOptional,
} from './typed-test-helpers.ts';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');

/**
 * The runtime (non-host) dependency contract per plugin. Since #2763 the
 * google-gemini plugin is the single home of the Gemini provider, so it owns
 * the `@ai-sdk/google` dependency; since #2764 google-mcp-auth owns the
 * Google MCP auth providers and their `google-auth-library` dependency. Host
 * packages appear ONLY under peerDependencies — never here, never under
 * devDependencies.
 */
const EXPECTED_RUNTIME_DEPENDENCIES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  '@vybestack/llxprt-plugin-google-gemini': {
    '@ai-sdk/google': '4.0.56',
  },
  '@vybestack/llxprt-plugin-google-mcp-auth': {
    'google-auth-library': '^9.11.0',
  },
};

/**
 * The host peer contract per plugin. Each plugin peers on exactly the host
 * packages it touches: google-gemini on core and providers, google-mcp-auth
 * on auth, mcp, providers, and telemetry (not core, since #2764).
 */
const EXPECTED_PEER_DEPENDENCIES: Readonly<Record<string, readonly string[]>> =
  {
    '@vybestack/llxprt-plugin-google-gemini': [
      '@vybestack/llxprt-code-core',
      '@vybestack/llxprt-code-providers',
    ],
    '@vybestack/llxprt-plugin-google-mcp-auth': [
      '@vybestack/llxprt-code-auth',
      '@vybestack/llxprt-code-mcp',
      '@vybestack/llxprt-code-providers',
      '@vybestack/llxprt-code-telemetry',
    ],
  };

function expectedRuntimeDependencies(
  releaseName: string,
): Readonly<Record<string, string>> {
  const expected = EXPECTED_RUNTIME_DEPENDENCIES[releaseName];
  if (expected === undefined) {
    throw new Error(
      `no expected runtime-dependency contract for '${releaseName}'; ` +
        'extend EXPECTED_RUNTIME_DEPENDENCIES alongside the release list.',
    );
  }
  return expected;
}

function expectedPeerDependencies(releaseName: string): readonly string[] {
  const expected = EXPECTED_PEER_DEPENDENCIES[releaseName];
  if (expected === undefined) {
    throw new Error(
      `no expected peer-dependency contract for '${releaseName}'; ` +
        'extend EXPECTED_PEER_DEPENDENCIES alongside the release list.',
    );
  }
  return expected;
}

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

  it('declares host packages only under peerDependencies; runtime dependencies carry no host packages', () => {
    for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
      const manifest = readJson(
        join(pluginDir(release.dir), 'package.json'),
      ) as PluginManifest;
      const peers = manifest.peerDependencies as Record<string, string>;
      expect(Object.keys(peers).sort()).toStrictEqual(
        [...expectedPeerDependencies(release.name)].sort(),
      );
      for (const hostPackage of expectedPeerDependencies(release.name)) {
        expect(peers[hostPackage]).toMatch(/^\^0\.12\.0$/);
      }
      // A non-host runtime dependencies section is part of the contract:
      // google-gemini must ship @ai-sdk/google (it owns the Gemini provider
      // since #2763), google-mcp-auth must ship google-auth-library (it owns
      // the Google MCP auth providers since #2764). Either way, no host
      // package may appear as a runtime dependency.
      const runtimeDeps = (manifest.dependencies ?? {}) as Record<
        string,
        string
      >;
      expect(runtimeDeps).toStrictEqual(
        expectedRuntimeDependencies(release.name),
      );
      expect(
        Object.keys(runtimeDeps).filter((dep) => dep.startsWith('@vybestack/')),
      ).toStrictEqual([]);
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
      // provides host types via tsconfig paths instead. Runtime dependencies
      // are pinned per release by the peerDependencies test above.
      expect(devDeps['@vybestack/llxprt-code-core']).toBeUndefined();
      expect(devDeps['@vybestack/llxprt-code-providers']).toBeUndefined();
      expect(Object.keys(devDeps).sort()).toStrictEqual([
        '@types/bun',
        '@types/node',
        'typescript',
      ]);
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
            dependencies?: Record<string, unknown>;
            devDependencies?: Record<string, unknown>;
            peerDependencies?: Record<string, unknown>;
          }
        >;
        packages?: Record<string, unknown>;
      };
      const rootEntry = lock.workspaces?.[''];
      expect(rootEntry?.name).toBe(release.name);
      // The dev install is toolchain-only: `bun install --omit=peer` inside
      // the plugin directory (issue #2759). Peers are provided by the host at
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
      // Runtime dependencies in the lock mirror the manifest contract:
      // google-gemini pins @ai-sdk/google, google-mcp-auth pins
      // google-auth-library.
      const rootDeps = (rootEntry?.dependencies ?? {}) as Record<
        string,
        unknown
      >;
      expect(rootDeps).toStrictEqual(expectedRuntimeDependencies(release.name));
      // Peers stay recorded as the consumer-facing contract on the root
      // workspace entry, and the resolved-package graph contains NO host
      // resolutions at all: neither registry entries (the caret ranges can
      // never truthfully resolve today) nor repo-relative file: links
      // (linking hosts re-resolves their unpublished workspace deps and
      // breaks the install).
      const rootPeers = rootEntry?.peerDependencies;
      expect(Object.keys(rootPeers ?? {}).sort()).toStrictEqual(
        [...expectedPeerDependencies(release.name)].sort(),
      );
      const packages = (lock.packages ?? {}) as Record<string, unknown>;
      const serialized = JSON.stringify(packages);
      expect(serialized).not.toContain('@vybestack/');
      // Where the manifest declares the Google SDK, the lock resolves it at
      // the pinned version together with its transitive provider packages.
      const expectedDeps = expectedRuntimeDependencies(release.name);
      const pinnedSdk = expectedDeps['@ai-sdk/google'];
      if (pinnedSdk !== undefined) {
        for (const required of [
          '@ai-sdk/google',
          '@ai-sdk/provider',
          '@ai-sdk/provider-utils',
        ]) {
          expect(required in packages).toBe(true);
        }
        const sdkEntry = packages['@ai-sdk/google'] as unknown;
        if (!Array.isArray(sdkEntry) || sdkEntry.length === 0) {
          throw new Error(
            `plugin bun.lock for '${release.name}' has no resolved ` +
              '@ai-sdk/google entry',
          );
        }
        expect(asString(sdkEntry[0])).toBe(`@ai-sdk/google@${pinnedSdk}`);
      }
      // Where the manifest declares the Google auth library, the lock
      // resolves it alongside its transitive packages.
      if (expectedDeps['google-auth-library'] !== undefined) {
        expect('google-auth-library' in packages).toBe(true);
      }
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

describe('release automation rewrites plugin host peer ranges', () => {
  const releaseYml = readFileSync(
    join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  const releaseSteps = jobSteps(
    workflowJobOptional(parseWorkflowYaml(releaseYml), 'release'),
  );
  const versionStep = releaseSteps.find(
    (step) => step.name === 'Version runtime plugin packages',
  );

  const TARGET_VERSION = '0.13.0';

  function writePluginFixture(
    rootDir: string,
    release: FirstPartyRuntimePluginRelease,
    manifest: Record<string, unknown>,
  ): void {
    mkdirSync(join(rootDir, release.dir), { recursive: true });
    writeFileSync(
      join(rootDir, release.dir, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  /**
   * A plugin manifest as the release pipeline sees it right after the
   * `npm version` loop: version already stamped to the release, host peers
   * still at the stale checked-in caret ranges. Peers and runtime
   * dependencies mirror each release's real contract.
   */
  function versionedManifest(
    release: FirstPartyRuntimePluginRelease,
  ): Record<string, unknown> {
    const peerDependencies: Record<string, string> = {};
    for (const hostPackage of release.hostPeers) {
      peerDependencies[hostPackage] = '^0.12.0';
    }
    return {
      name: release.name,
      version: TARGET_VERSION,
      peerDependencies,
      dependencies: expectedRuntimeDependencies(release.name),
      devDependencies: { typescript: '5.8.3' },
    };
  }

  function readPluginManifest(
    rootDir: string,
    release: FirstPartyRuntimePluginRelease,
  ): Record<string, unknown> {
    return JSON.parse(
      readFileSync(join(rootDir, release.dir, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
  }

  it('binds host peer ranges in the versioning step, after the npm version loop', () => {
    if (versionStep === undefined) {
      throw new Error("missing step: 'Version runtime plugin packages'");
    }
    const run = asString(versionStep.run);
    const versionLoopEnd = run.indexOf('done');
    const bindCall = run.indexOf(
      'bun scripts/bind-plugin-peers.ts "$RELEASE_VERSION"',
    );
    expect(versionLoopEnd).toBeGreaterThan(-1);
    expect(bindCall).toBeGreaterThan(versionLoopEnd);
    // The bind consumes the same release version output the loop stamps
    // the plugin manifests with, so peers can never trail the version.
    expect(asRecord(versionStep.env)?.RELEASE_VERSION).toBe(
      '${{ steps.version.outputs.RELEASE_VERSION }}',
    );
  });

  it('rewrites every host peer range to the release version and leaves other sections untouched', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'plugin-peer-bind-'));
    try {
      for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
        writePluginFixture(rootDir, release, versionedManifest(release));
      }

      const changed = bindPluginPeerDeps({
        version: TARGET_VERSION,
        rootDir,
      });

      expect(changed).toBe(FIRST_PARTY_RUNTIME_PLUGIN_RELEASES.length);
      for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
        const pkg = readPluginManifest(rootDir, release);
        const expectedPeers: Record<string, string> = {};
        for (const hostPackage of release.hostPeers) {
          expectedPeers[hostPackage] = `^${TARGET_VERSION}`;
        }
        expect(pkg['peerDependencies']).toStrictEqual(expectedPeers);
        // Only the host peer ranges move; the stamped version and every
        // other manifest section stay exactly as the release wrote them.
        expect(pkg['version']).toBe(TARGET_VERSION);
        expect(pkg['dependencies']).toStrictEqual(
          expectedRuntimeDependencies(release.name),
        );
        expect(pkg['devDependencies']).toStrictEqual({
          typescript: '5.8.3',
        });
      }
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('reports no changes when the peer ranges already match the release version', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'plugin-peer-bind-'));
    try {
      for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
        writePluginFixture(rootDir, release, versionedManifest(release));
      }
      bindPluginPeerDeps({ version: TARGET_VERSION, rootDir });

      const secondPass = bindPluginPeerDeps({
        version: TARGET_VERSION,
        rootDir,
      });

      expect(secondPass).toBe(0);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('fails fast without writing when a plugin manifest lacks a host peer dependency', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'plugin-peer-bind-'));
    try {
      const gemini = FIRST_PARTY_RUNTIME_PLUGIN_RELEASES.find(
        (release) => release.dir === 'plugins/google-gemini',
      );
      if (gemini === undefined) {
        throw new Error(
          'expected plugins/google-gemini in the first-party release list',
        );
      }
      const incomplete = versionedManifest(gemini);
      delete (incomplete['peerDependencies'] as Record<string, unknown>)[
        '@vybestack/llxprt-code-providers'
      ];
      for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
        writePluginFixture(rootDir, release, incomplete);
      }

      expect(() =>
        bindPluginPeerDeps({ version: TARGET_VERSION, rootDir }),
      ).toThrow('does not peer-depend on @vybestack/llxprt-code-providers');

      // The failure raised before any manifest was written.
      const pkg = readPluginManifest(rootDir, gemini);
      expect(
        (pkg['peerDependencies'] as Record<string, unknown>)[
          '@vybestack/llxprt-code-core'
        ],
      ).toBe('^0.12.0');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('fails fast when a plugin manifest is not yet at the release version', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'plugin-peer-bind-'));
    try {
      for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
        const unversioned = versionedManifest(release);
        unversioned['version'] = '0.12.0';
        writePluginFixture(rootDir, release, unversioned);
      }

      expect(() =>
        bindPluginPeerDeps({ version: TARGET_VERSION, rootDir }),
      ).toThrow('Run the plugin npm version loop before binding peers');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
