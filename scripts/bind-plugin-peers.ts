/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pins the host peerDependencies of every first-party runtime plugin
 * (issue #2759) to the release version being published.
 *
 * The plugin contexts sit OUTSIDE the root workspaces, so
 * scripts/bind-release-deps.ts never sees them and their checked-in `^X.Y.0`
 * peer ranges would trail the host packages forever: publishing plugin
 * 0.13.0 with peers `^0.12.0` makes npm treat the published plugin as
 * incompatible with the actual 0.13.0 host. release.yml runs this script in
 * the same step that stamps the plugin versions, immediately after the
 * `npm version` loop, driven by the explicit first-party list in
 * scripts/utils/release-packages.ts (FIRST_PARTY_RUNTIME_PLUGIN_RELEASES).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { messageOf } from './utils/error-guards.ts';
import {
  FIRST_PARTY_RUNTIME_PLUGIN_RELEASES,
  type FirstPartyRuntimePluginRelease,
} from './utils/release-packages.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type DependencyMap = Record<string, unknown>;

type PackageJson = {
  name?: string;
  version?: string;
  [key: string]: unknown;
} & Partial<Record<'peerDependencies', DependencyMap>>;

export interface BindPluginPeerDepsOptions {
  /** Release version the plugin manifests were just stamped with. */
  version: string;
  /** Repository root containing the plugin directories (test seam). */
  rootDir?: string;
}

function readJson(filePath: string): PackageJson {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as PackageJson;
}

// Mirrors scripts/version.ts: plain JSON round-trip with a trailing newline
// so release manifest writes stay deterministic.
function writeJson(filePath: string, data: PackageJson): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function pluginPackageJsonPath(
  rootDir: string,
  release: FirstPartyRuntimePluginRelease,
): string {
  return join(rootDir, release.dir, 'package.json');
}

function readVersionedPluginPackage(
  rootDir: string,
  release: FirstPartyRuntimePluginRelease,
  version: string,
): PackageJson {
  const pkgJsonPath = pluginPackageJsonPath(rootDir, release);
  const pkg = readJson(pkgJsonPath);
  if (pkg.name !== release.name) {
    throw new Error(
      `${pkgJsonPath} declares name ${String(pkg.name)}; expected ${release.name}.`,
    );
  }
  if (pkg.version !== version) {
    throw new Error(
      `${pkgJsonPath} is at version ${String(pkg.version)}; expected ${version}. Run the plugin npm version loop before binding peers.`,
    );
  }
  return pkg;
}

// Mutates the provided dependency map in place; callers pass package JSON objects they own.
function bindHostPeerRanges(
  peers: DependencyMap,
  pkgJsonPath: string,
  version: string,
  hostPeers: readonly string[],
): boolean {
  for (const hostPackage of hostPeers) {
    if (typeof peers[hostPackage] !== 'string') {
      throw new Error(
        `${pkgJsonPath} does not peer-depend on ${hostPackage}; cannot bind its range.`,
      );
    }
  }

  let changed = false;
  for (const hostPackage of hostPeers) {
    const targetRange = `^${version}`;
    if (peers[hostPackage] !== targetRange) {
      peers[hostPackage] = targetRange;
      changed = true;
    }
  }
  return changed;
}

export function bindPluginPeerDeps({
  version,
  rootDir = ROOT,
}: BindPluginPeerDepsOptions): number {
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('A non-empty release version is required.');
  }

  let changed = 0;
  for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
    const pkgJsonPath = pluginPackageJsonPath(rootDir, release);
    const pkg = readVersionedPluginPackage(rootDir, release, version);
    const peers = pkg.peerDependencies;
    if (
      peers === undefined ||
      typeof peers !== 'object' ||
      Array.isArray(peers)
    ) {
      throw new Error(
        `${pkgJsonPath} has no peerDependencies object; cannot bind host peer ranges.`,
      );
    }

    if (!bindHostPeerRanges(peers, pkgJsonPath, version, release.hostPeers)) {
      console.log(`  ${release.name} peers already bound to ^${version}`);
      continue;
    }

    writeJson(pkgJsonPath, pkg);
    changed += 1;
    console.log(`  Bound ${release.name} host peers to ^${version}`);
  }
  return changed;
}

function printUsage(): void {
  console.log('Usage: bun scripts/bind-plugin-peers.ts <version>');
}

function main(): void {
  const version = process.argv[2];
  if (version === undefined) {
    console.error('Error: no version specified.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    bindPluginPeerDeps({ version });
  } catch (error) {
    console.error(`Error: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
