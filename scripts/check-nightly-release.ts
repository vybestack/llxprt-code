/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  NON_NPM_RELEASE_PACKAGES,
  FIRST_PARTY_RUNTIME_PLUGIN_RELEASES,
} from './utils/release-packages.ts';

export type RegistryResult = 'present' | 'absent';
export type NightlyPresence = 'proceed' | 'duplicate';

export function decideNightlyPresence(
  results: readonly RegistryResult[],
  packages: readonly string[],
): NightlyPresence {
  if (results.length !== packages.length)
    throw new Error('Registry results did not cover every release package.');
  const found = packages.filter((_, index) => results[index] === 'present');
  if (found.length === packages.length) return 'duplicate';
  if (found.length === 0) return 'proceed';
  const missing = packages.filter((_, index) => results[index] === 'absent');
  throw new Error(
    `Nightly version is partially published. Missing packages: ${missing.join(', ')}. Publish a fresh version; this run will not resume a partial release.`,
  );
}

export function expectedReleasePackages(root: string): string[] {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as { workspaces: string[] };
  const workspaceNames = rootPackage.workspaces.flatMap((workspace) => {
    const file = path.join(root, workspace, 'package.json');
    if (!fs.existsSync(file)) {
      throw new Error(`Workspace package manifest is missing: ${workspace}`);
    }
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      name: string;
      private?: boolean;
    };
    return !pkg.private && !NON_NPM_RELEASE_PACKAGES.has(pkg.name)
      ? [pkg.name]
      : [];
  });
  return [
    ...workspaceNames,
    ...FIRST_PARTY_RUNTIME_PLUGIN_RELEASES.map(({ name }) => name),
  ];
}
function hasVersions(
  value: unknown,
): value is { versions: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null || !('versions' in value)) {
    return false;
  }
  return (
    typeof value.versions === 'object' &&
    value.versions !== null &&
    !Array.isArray(value.versions)
  );
}

export async function checkNightlyPresence(
  version: string,
  packages: readonly string[],
  registry = 'https://registry.npmjs.org',
): Promise<NightlyPresence> {
  const results = await Promise.all(
    packages.map(async (name): Promise<RegistryResult> => {
      const response = await fetch(
        `${registry.replace(/\/$/, '')}/${encodeURIComponent(name)}`,
        { headers: { accept: 'application/vnd.npm.install-v1+json' } },
      );
      if (response.status === 404) return 'absent';
      if (!response.ok)
        throw new Error(
          `Unable to verify ${name}@${version}; registry check was inconclusive (HTTP ${response.status}).`,
        );
      const packument: unknown = await response.json();
      if (!hasVersions(packument)) {
        throw new Error(
          `Unable to verify ${name}@${version}; registry returned invalid package metadata.`,
        );
      }
      return version in packument.versions ? 'present' : 'absent';
    }),
  );
  return decideNightlyPresence(results, packages);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  try {
    const version = process.env.RELEASE_VERSION;
    if (!version) throw new Error('RELEASE_VERSION is required.');
    const result = await checkNightlyPresence(
      version,
      expectedReleasePackages(process.cwd()),
    );
    if (result === 'duplicate') {
      console.log(
        `::notice::Scheduled nightly ${version} is completely published; skipping the release pipeline.`,
      );
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT ?? '/dev/null',
        'is_duplicate=true\n',
      );
    } else {
      console.log(
        `Version ${version} is absent from all release packages; proceeding.`,
      );
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT ?? '/dev/null',
        'is_duplicate=false\n',
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
