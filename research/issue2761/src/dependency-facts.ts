/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Emits `dependency-facts.json` by READING installed package metadata and the
 * npm registry. Nothing here is hand-typed, so the decision document cannot
 * quietly drift away from what is actually installed.
 *
 * The question it answers: does `@ai-sdk/google@2.0.85` sit on the same
 * provider protocol as the AI SDK stack llxprt already ships, and what would
 * adopting the current `latest` instead cost in protocol terms?
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROBE_ROOT, makeRedactor, writeArtifact } from './harness.ts';

const REPO_ROOT = join(PROBE_ROOT, '..', '..');

interface InstalledPackage {
  readonly name: string;
  readonly resolvedVersion: string | null;
  readonly dependencies: Record<string, string> | null;
  readonly peerDependencies: Record<string, string> | null;
  readonly engines: Record<string, string> | null;
}

function readInstalled(
  root: string,
  name: string,
  nestedUnder?: string,
): InstalledPackage {
  const prefix =
    nestedUnder === undefined
      ? [root, 'node_modules']
      : [root, 'node_modules', ...nestedUnder.split('/'), 'node_modules'];
  const manifestPath = join(...prefix, ...name.split('/'), 'package.json');
  if (!existsSync(manifestPath)) {
    return {
      name,
      resolvedVersion: null,
      dependencies: null,
      peerDependencies: null,
      engines: null,
    };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    version?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    engines?: Record<string, string>;
  };
  return {
    name,
    resolvedVersion: manifest.version ?? null,
    dependencies: manifest.dependencies ?? null,
    peerDependencies: manifest.peerDependencies ?? null,
    engines: manifest.engines ?? null,
  };
}

interface DependencyClosure {
  /** Every package reachable from the root through `dependencies` edges. */
  readonly closure: string[];
  /** The root's own declared `dependencies`. */
  readonly direct: string[];
  /** The root's declared `peerDependencies`, which are not walked. */
  readonly peer: string[];
}

/**
 * Walks installed manifests transitively from `packageName`.
 *
 * The Vertex argument rests on `google-auth-library` being absent from
 * everything `@ai-sdk/google` pulls in, and a direct-dependency list cannot
 * support that claim, so the whole reachable set is recorded.
 */
function readDependencyClosure(
  root: string,
  packageName: string,
): DependencyClosure {
  const queue: string[] = [packageName];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift() ?? '';
    if (visited.has(next)) {
      continue;
    }
    visited.add(next);
    const manifestPath = join(
      root,
      'node_modules',
      ...next.split('/'),
      'package.json',
    );
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      queue.push(dep);
    }
  }
  visited.delete(packageName);
  const rootManifestPath = join(
    root,
    'node_modules',
    ...packageName.split('/'),
    'package.json',
  );
  const rootManifest = existsSync(rootManifestPath)
    ? (JSON.parse(readFileSync(rootManifestPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      })
    : null;
  return {
    closure: [...visited].sort(),
    direct: Object.keys(rootManifest?.dependencies ?? {}).sort(),
    peer: Object.keys(rootManifest?.peerDependencies ?? {}).sort(),
  };
}

function majorOf(version: string | null): number | null {
  if (version === null) {
    return null;
  }
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

interface RegistryFacts {
  readonly latest: string | null;
  readonly latestProviderDependency: string | null;
}

async function readRegistry(packageName: string): Promise<RegistryFacts> {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`);
  if (!response.ok) {
    return { latest: null, latestProviderDependency: null };
  }
  const doc = (await response.json()) as {
    'dist-tags'?: Record<string, string>;
    versions?: Record<string, { dependencies?: Record<string, string> }>;
  };
  const latest = doc['dist-tags']?.latest ?? null;
  const latestDeps =
    latest !== null ? (doc.versions?.[latest]?.dependencies ?? null) : null;
  return {
    latest,
    latestProviderDependency: latestDeps?.['@ai-sdk/provider'] ?? null,
  };
}

export interface DependencyFacts {
  readonly generatedAt: string;
  readonly probeContext: {
    readonly aiSdkGoogle: InstalledPackage;
    readonly aiSdkProvider: InstalledPackage;
    readonly aiSdkProviderUtils: InstalledPackage;
    readonly googleGenai: InstalledPackage;
    readonly zod: InstalledPackage;
  };
  readonly llxprtRootTree: {
    readonly ai: InstalledPackage;
    readonly aiSdkOpenai: InstalledPackage;
    readonly aiSdkProvider: InstalledPackage;
    readonly aiSdkProviderUtils: InstalledPackage;
    readonly googleGenai: InstalledPackage;
    readonly zod: InstalledPackage;
    /**
     * The root tree hoists an older `@ai-sdk/provider-utils` for other
     * consumers, so the versions the AI SDK v5 packages actually resolve are
     * recorded separately rather than being papered over by the hoisted one.
     */
    readonly aiSdkProviderUtilsNestedUnderAi: InstalledPackage;
    readonly aiSdkProviderNestedUnderAi: InstalledPackage;
  };
  readonly protocol: {
    readonly probeProviderProtocolMajor: number | null;
    readonly rootProviderProtocolMajor: number | null;
    readonly matches: boolean;
    readonly registryLatest: string | null;
    readonly registryLatestProviderDependency: string | null;
    readonly registryLatestProviderProtocolMajor: number | null;
    readonly v4MixingRejected: true;
    readonly v4MixingRationale: string;
  };
  readonly vertex: {
    readonly aiSdkGoogleDependencyClosure: string[];
    readonly aiSdkGoogleDependencyClosureTransitive: string[];
    readonly aiSdkGooglePeerDependencies: string[];
    readonly aiSdkGoogleDeclaresGoogleAuthLibrary: boolean;
    readonly googleGenaiDeclaresGoogleAuthLibrary: boolean;
    /**
     * What adopting `@ai-sdk/google-vertex` would actually drag in. Recorded
     * so the Vertex cost is visible rather than hidden behind a package name.
     */
    readonly aiSdkGoogleVertex: {
      readonly latest: string | null;
      readonly latestDependencies: Record<string, string> | null;
      readonly newestProtocolV2Line: string | null;
      readonly newestProtocolV2Dependencies: Record<string, string> | null;
    };
  };
}

/**
 * Finds the newest published version whose `@ai-sdk/provider` dependency is on
 * the same protocol major as the probe pin, so the Vertex comparison is not
 * quietly made against a v4-protocol release.
 */
async function readVertexPackageFacts(
  targetProtocolMajor: number | null,
): Promise<DependencyFacts['vertex']['aiSdkGoogleVertex']> {
  const response = await fetch('https://registry.npmjs.org/@ai-sdk/google-vertex');
  if (!response.ok) {
    return {
      latest: null,
      latestDependencies: null,
      newestProtocolV2Line: null,
      newestProtocolV2Dependencies: null,
    };
  }
  const doc = (await response.json()) as {
    'dist-tags'?: Record<string, string>;
    versions?: Record<string, { dependencies?: Record<string, string> }>;
  };
  const latest = doc['dist-tags']?.latest ?? null;
  const versions = doc.versions ?? {};
  let matching: string | null = null;
  for (const version of Object.keys(versions)) {
    const range = versions[version]?.dependencies?.['@ai-sdk/provider'];
    if (range === undefined) {
      continue;
    }
    if (majorOf(range.replace(/^[^\d]*/, '')) === targetProtocolMajor) {
      matching = version;
    }
  }
  return {
    latest,
    latestDependencies:
      latest === null ? null : (versions[latest]?.dependencies ?? null),
    newestProtocolV2Line: matching,
    newestProtocolV2Dependencies:
      matching === null ? null : (versions[matching]?.dependencies ?? null),
  };
}
export async function collectDependencyFacts(): Promise<DependencyFacts> {
  const aiSdkGoogle = readInstalled(PROBE_ROOT, '@ai-sdk/google');
  const probeProvider = readInstalled(PROBE_ROOT, '@ai-sdk/provider');
  const rootProvider = readInstalled(REPO_ROOT, '@ai-sdk/provider');
  const googleGenaiProbe = readInstalled(PROBE_ROOT, '@google/genai');
  const registry = await readRegistry('@ai-sdk/google');
  const closure = readDependencyClosure(PROBE_ROOT, '@ai-sdk/google');

  const probeMajor = majorOf(probeProvider.resolvedVersion);
  const rootMajor = majorOf(rootProvider.resolvedVersion);
  const latestProviderRange = registry.latestProviderDependency;
  const latestProviderMajor = majorOf(
    latestProviderRange === null ? null : latestProviderRange.replace(/^[^\d]*/, ''),
  );

  // True only if google-auth-library is reachable anywhere beneath
  // @ai-sdk/google, directly, transitively, or as a declared peer. That is what
  // the Vertex argument needs, and a direct-dependency list cannot show it.
  const hasGoogleAuth =
    closure.closure.includes('google-auth-library') ||
    closure.direct.includes('google-auth-library') ||
    closure.peer.includes('google-auth-library');

  return {
    generatedAt: new Date().toISOString(),
    probeContext: {
      aiSdkGoogle,
      aiSdkProvider: probeProvider,
      aiSdkProviderUtils: readInstalled(PROBE_ROOT, '@ai-sdk/provider-utils'),
      googleGenai: googleGenaiProbe,
      zod: readInstalled(PROBE_ROOT, 'zod'),
    },
    llxprtRootTree: {
      ai: readInstalled(REPO_ROOT, 'ai'),
      aiSdkOpenai: readInstalled(REPO_ROOT, '@ai-sdk/openai'),
      aiSdkProvider: rootProvider,
      aiSdkProviderUtils: readInstalled(REPO_ROOT, '@ai-sdk/provider-utils'),
      googleGenai: readInstalled(REPO_ROOT, '@google/genai'),
      zod: readInstalled(REPO_ROOT, 'zod'),
      aiSdkProviderUtilsNestedUnderAi: readInstalled(
        REPO_ROOT,
        '@ai-sdk/provider-utils',
        'ai',
      ),
      aiSdkProviderNestedUnderAi: readInstalled(REPO_ROOT, '@ai-sdk/provider', 'ai'),
    },
    protocol: {
      probeProviderProtocolMajor: probeMajor,
      rootProviderProtocolMajor: rootMajor,
      matches: probeMajor !== null && probeMajor === rootMajor,
      registryLatest: registry.latest,
      registryLatestProviderDependency: latestProviderRange,
      registryLatestProviderProtocolMajor: latestProviderMajor,
      v4MixingRejected: true,
      v4MixingRationale:
        'llxprt ships the AI SDK v5 generation (ai + @ai-sdk/openai on ' +
        '@ai-sdk/provider v2). Adopting the current @ai-sdk/google latest ' +
        'would put a provider-protocol v4 model object into the same tree as ' +
        'v2-protocol providers, so it is rejected for this decision.',
    },
    vertex: {
      aiSdkGoogleDependencyClosure: closure.direct,
      aiSdkGoogleDependencyClosureTransitive: closure.closure,
      aiSdkGooglePeerDependencies: closure.peer,
      aiSdkGoogleDeclaresGoogleAuthLibrary: hasGoogleAuth,
      googleGenaiDeclaresGoogleAuthLibrary:
        'google-auth-library' in (googleGenaiProbe.dependencies ?? {}),
      aiSdkGoogleVertex: await readVertexPackageFacts(probeMajor),
    },
  };
}

if (import.meta.main) {
  const facts = await collectDependencyFacts();
  const path = writeArtifact('dependency-facts.json', facts, makeRedactor(''));
  process.stdout.write(`wrote ${path}\n`);
}

