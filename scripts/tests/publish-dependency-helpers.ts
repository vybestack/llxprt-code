/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Publish dependency invariant helpers (#2352).
 *
 * These helpers distinguish mandatory dependencies (package.json
 * `dependencies`) from optional dependencies (`optionalDependencies`) and
 * verify that the root packaging bridge declares every shipped workspace's
 * external dependency with a semver range that is a SUBSET of the workspace's
 * range (so npm can never install a version the workspace rejects).
 *
 * Internal packages are identified by a manifest-derived set passed to the
 * helper, NOT by a naming prefix — this prevents a non-internal package with
 * a similar name from being wrongly skipped.
 *
 * Special protocols are handled explicitly:
 *
 * - **npm aliases** (`npm:realName@version`): the version is extracted from
 *   after the last `@`, the alias target is compared, and the semver range
 *   is checked for subset.
 * - **file: protocol** (`file:../sibling`): must resolve to an internal
 *   package from the manifest-derived set; otherwise rejected.
 * - **workspace: protocol** (`workspace:*`, `workspace:^`): same as file:.
 * - **link: protocol** (`link:../sibling`): same as file:.
 * - **Registry ranges** (e.g. `^3.0.1`, `>=2.1.35 <4`): the root range must
 *   be a subset of the workspace range via `semver.subset`. If subset throws
 *   (invalid range), treated as incompatible (fail-closed).
 *
 * `semver` is a transitive dependency already installed in the repo and
 * used by the project's npm tooling; it is imported here for range
 * intersection and subset checks.
 */

import semver from 'semver';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The dependency sections of a package.json manifest. */
export interface ManifestDependencies {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

/** Root manifest includes files/workspaces for shipped-workspace discovery. */
export interface RootManifest extends ManifestDependencies {
  readonly files?: string[];
  readonly workspaces?: string[];
}

/**
 * The kind of a dependency declaration: mandatory (`dependencies`),
 * optional (`optionalDependencies`), or peer (`peerDependencies`).
 */
export type DependencyKind = 'mandatory' | 'optional' | 'peer';

/**
 * Result of resolving a protocol specifier (file:, workspace:, link:)
 * against a workspace name→directory map (F8).
 */
export interface ProtocolTargetResolution {
  readonly resolved: boolean;
  readonly workspaceDir?: string;
}

/**
 * A function that resolves a protocol specifier against a real workspace
 * name→directory map and target manifests (F8). If the specifier resolves
 * to a known internal workspace, returns `{ resolved: true, workspaceDir }`.
 * Otherwise returns `{ resolved: false }`.
 *
 * When not provided, `checkDependencyCoverage` falls back to a name-only
 * `internalPackages` set check.
 *
 * The optional `consumerWorkspace` parameter provides the consuming
 * workspace's directory (relative to repoRoot) so that `file:`/`link:`
 * specifiers are resolved relative to the consumer, not the target.
 */
export type ProtocolTargetResolver = (
  depName: string,
  specifier: string,
  consumerWorkspace?: string,
) => ProtocolTargetResolution;

/** Whether a version specifier uses a non-registry protocol. */
export function isProtocolSpecifier(version: string): boolean {
  return (
    version.startsWith('file:') ||
    version.startsWith('workspace:') ||
    version.startsWith('link:')
  );
}

/** Whether a version specifier is an npm alias (`npm:realName@version`). */
export function isNpmAlias(version: string): boolean {
  return version.startsWith('npm:');
}

/**
 * Extract the alias target package name from an npm alias specifier.
 * Returns null for non-alias specifiers.
 *
 * Finds the FIRST `@` that delimits the package name from the version — NOT
 * `lastIndexOf('@')`, which corrupts the target when the version itself
 * contains `@` (e.g. a tarball URL like `https://user@host/pkg.tgz`).
 *
 * - `npm:@scope/pkg@^1.2.3`                → `@scope/pkg`
 * - `npm:plainpkg@^1.2.3`                  → `plainpkg`
 * - `npm:@scope/pkg`                       → `@scope/pkg` (versionless)
 * - `npm:plainpkg`                         → `plainpkg` (versionless)
 * - `npm:@google/genai@https://u@h/p.tgz` → `@google/genai`
 */
export function extractNpmAliasTarget(version: string): string | null {
  if (!isNpmAlias(version)) return null;
  const body = version.slice(4); // strip 'npm:'
  if (body.length === 0) return null;
  // For scoped packages (`@scope/name`), find the first `@` after the `/`.
  // For plain packages, find the first `@`.
  let atIndex: number;
  if (body.startsWith('@')) {
    const slashIndex = body.indexOf('/');
    if (slashIndex === -1) return body; // versionless scoped package
    atIndex = body.indexOf('@', slashIndex + 1);
    if (atIndex === -1) return body; // versionless scoped package
  } else {
    atIndex = body.indexOf('@');
    if (atIndex === -1) return body; // versionless plain package
  }
  return body.slice(0, atIndex);
}

/**
 * Extract the real semver range from a version specifier.
 *
 * - npm aliases (`npm:realName@^1.2.3`) → `^1.2.3`
 * - protocol specifiers (`file:..`, `workspace:*`, `link:..`) → null
 *   (no semver range to compare)
 * - plain registry ranges (`^1.2.3`, `>=2.0.0`) → returned as-is
 */
export function extractSemverRange(version: string): string | null {
  if (isProtocolSpecifier(version)) {
    return null;
  }
  if (isNpmAlias(version)) {
    const target = extractNpmAliasTarget(version);
    if (target === null) return null;
    const delimiter = 4 + target.length;
    if (version[delimiter] !== '@' || delimiter + 1 >= version.length) {
      return null;
    }
    return version.slice(delimiter + 1);
  }
  return version;
}

/**
 * Check whether `rootRange` is a subset of `workspaceRange` — meaning
 * every version the root could install also satisfies the workspace's
 * requirement. This rejects overly-broad root ranges like `>=2 <4`
 * for a workspace that needs `^3.0.1`.
 *
 * Returns `true` if rootRange ⊆ workspaceRange, `false` otherwise.
 * If either range is invalid, returns `false` (fail-closed).
 */
export function isRootSubsetOfWorkspace(
  rootRange: string,
  workspaceRange: string,
): boolean {
  try {
    return semver.subset(rootRange, workspaceRange);
  } catch {
    return false;
  }
}

/**
 * Check whether two semver ranges intersect. Returns `true` if they do,
 * `false` if they do not, or `false` if either range is invalid
 * (fail-closed — an invalid range cannot be proven compatible).
 */
export function rangesIntersect(rangeA: string, rangeB: string): boolean {
  try {
    return semver.intersects(rangeA, rangeB);
  } catch {
    return false;
  }
}

/** Determine whether the root declaration is strong enough for the kind. */
export function isRootSectionAdequate(
  rootSection:
    | 'dependencies'
    | 'optionalDependencies'
    | 'peerDependencies'
    | undefined,
  kind: DependencyKind,
): boolean {
  if (rootSection === undefined) {
    return false;
  }
  if (kind === 'mandatory') {
    // A mandatory workspace dep must be in root dependencies —
    // optionalDependencies may be skipped by platform-specific installs.
    return rootSection === 'dependencies';
  }
  if (kind === 'peer') {
    // A peer dep may be declared in root dependencies OR peerDependencies.
    // It must NOT be in optionalDependencies (which may be skipped).
    return rootSection === 'dependencies' || rootSection === 'peerDependencies';
  }
  // Optional workspace deps can be in either root section.
  return (
    rootSection === 'dependencies' || rootSection === 'optionalDependencies'
  );
}

/**
 * A single dependency entry yielded by the shared manifest-derived iterator.
 */
export interface WorkspaceDependencyEntry {
  readonly name: string;
  readonly version: string;
  readonly kind: DependencyKind;
}

/**
 * Shared manifest-derived internal dependency iterator (F11).
 *
 * Yields every dependency declared in a workspace manifest — both mandatory
 * (`dependencies`) and optional (`optionalDependencies`) — without any naming
 * prefix filtering. Callers that need to identify internal packages must do so
 * against a manifest-derived set, never by name prefix.
 *
 * This replaces the duplicated per-section loops in checkWorkspaceDependencies
 * with a single cohesive abstraction.
 */
export function* iterateWorkspaceDependencies(
  manifest: ManifestDependencies,
): Generator<WorkspaceDependencyEntry> {
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    yield { name, version, kind: 'mandatory' };
  }
  for (const [name, version] of Object.entries(
    manifest.optionalDependencies ?? {},
  )) {
    yield { name, version, kind: 'optional' };
  }
  for (const [name, version] of Object.entries(
    manifest.peerDependencies ?? {},
  )) {
    yield { name, version, kind: 'peer' };
  }
}

/** A dependency mismatch diagnostic. */
export interface DependencyMismatch {
  readonly workspace: string;
  readonly name: string;
  readonly kind: DependencyKind;
  readonly message: string;
}

/** A lookup result for finding a dependency in the root manifest sections. */
interface RootDeclarationLookup {
  readonly version: string;
  readonly section:
    | 'dependencies'
    | 'optionalDependencies'
    | 'peerDependencies';
}

/**
 * Find a dependency across all root manifest sections (dependencies,
 * optionalDependencies, peerDependencies). Returns the version and section
 * where it was first found, or undefined if missing from all sections.
 */
function lookupRootDeclaration(
  root: ManifestDependencies,
  depName: string,
): RootDeclarationLookup | undefined {
  const rootDepVersion = root.dependencies?.[depName];
  if (rootDepVersion !== undefined) {
    return { version: rootDepVersion, section: 'dependencies' };
  }
  const rootOptVersion = root.optionalDependencies?.[depName];
  if (rootOptVersion !== undefined) {
    return { version: rootOptVersion, section: 'optionalDependencies' };
  }
  const rootPeerVersion = root.peerDependencies?.[depName];
  if (rootPeerVersion !== undefined) {
    return { version: rootPeerVersion, section: 'peerDependencies' };
  }
  return undefined;
}

/**
 * Check npm alias target consistency between workspace and root versions.
 * F7: reject mixed alias/plain semantic targets — if one side uses an
 * npm alias and the other uses a plain version, the semantic target
 * differs (alias renames the package) and must be flagged. Also rejects
 * differing alias targets.
 *
 * Returns a mismatch diagnostic if the alias targets are inconsistent,
 * or null if they are compatible.
 */
function checkAliasTargetConsistency(
  workspace: string,
  depName: string,
  workspaceVersion: string,
  rootVersion: string,
  kind: DependencyKind,
): DependencyMismatch | null {
  const workspaceAlias = extractNpmAliasTarget(workspaceVersion);
  const rootAlias = extractNpmAliasTarget(rootVersion);
  if (workspaceAlias !== null && rootAlias === null) {
    return {
      workspace,
      name: depName,
      kind,
      message:
        `${workspace}: ${depName} uses an npm alias ` +
        `("${workspaceVersion}") but root uses a plain version ` +
        `("${rootVersion}") — mixed alias/plain semantic targets are ` +
        'prohibited.',
    };
  }
  if (workspaceAlias === null && rootAlias !== null) {
    return {
      workspace,
      name: depName,
      kind,
      message:
        `${workspace}: ${depName} uses a plain version ` +
        `("${workspaceVersion}") but root uses an npm alias ` +
        `("${rootVersion}") — mixed alias/plain semantic targets are ` +
        'prohibited.',
    };
  }
  if (
    workspaceAlias !== null &&
    rootAlias !== null &&
    workspaceAlias !== rootAlias
  ) {
    return {
      workspace,
      name: depName,
      kind,
      message:
        `${workspace}: ${depName} npm alias target "${workspaceAlias}" ` +
        `differs from root alias target "${rootAlias}"`,
    };
  }
  return null;
}

/**
 * Resolve a protocol specifier (file:, workspace:, link:) against an
 * internal package set and optional protocol resolver.
 *
 * Returns null if the protocol target is valid (resolves to an internal
 * package), or a mismatch diagnostic if unresolved.
 */
function checkProtocolTarget(
  workspace: string,
  depName: string,
  workspaceVersion: string,
  kind: DependencyKind,
  internal: ReadonlySet<string>,
  protocolResolver: ProtocolTargetResolver | undefined,
): DependencyMismatch | null {
  if (protocolResolver !== undefined) {
    const resolution = protocolResolver(depName, workspaceVersion, workspace);
    if (!resolution.resolved) {
      return {
        workspace,
        name: depName,
        kind,
        message:
          `${workspace}: ${depName} "${workspaceVersion}" is an unresolved ` +
          'protocol specifier (target does not match the workspace ' +
          'name→directory map)',
      };
    }
    return null;
  }
  if (!internal.has(depName)) {
    return {
      workspace,
      name: depName,
      kind,
      message:
        `${workspace}: ${depName} "${workspaceVersion}" is an unresolved ` +
        'external protocol specifier (not in the internal package set)',
    };
  }
  return null;
}

export function checkDependencyCoverage(
  workspace: string,
  depName: string,
  workspaceVersion: string,
  kind: DependencyKind,
  root: ManifestDependencies,
  internalPackages?: ReadonlySet<string>,
  protocolResolver?: ProtocolTargetResolver,
): DependencyMismatch | null {
  const internal = internalPackages ?? new Set<string>();

  // Protocol specifiers (file:, workspace:, link:) are links — they must
  // resolve to a known internal package. An unresolved external link is a
  // mismatch (the linked source is not shipped).
  // F8: when a ProtocolTargetResolver is provided, resolve against the real
  // workspace name→directory map and target manifests. Otherwise fall back
  // to a name-only set check.
  if (isProtocolSpecifier(workspaceVersion)) {
    return checkProtocolTarget(
      workspace,
      depName,
      workspaceVersion,
      kind,
      internal,
      protocolResolver,
    );
  }

  const workspaceRange = extractSemverRange(workspaceVersion);
  if (workspaceRange === null) {
    return {
      workspace,
      name: depName,
      kind,
      message: `${workspace}: ${depName} has an unparseable version "${workspaceVersion}"`,
    };
  }

  const lookup = lookupRootDeclaration(root, depName);
  if (lookup === undefined) {
    return {
      workspace,
      name: depName,
      kind,
      message:
        `${workspace}: ${depName} (${kind}) is not declared in root ` +
        'dependencies, optionalDependencies, or peerDependencies',
    };
  }

  const { version: rootVersion, section: rootSection } = lookup;

  if (!isRootSectionAdequate(rootSection, kind)) {
    return {
      workspace,
      name: depName,
      kind,
      message: `${workspace}: ${depName} (${kind}) is only in root ${rootSection}, which is insufficient`,
    };
  }

  const aliasMismatch = checkAliasTargetConsistency(
    workspace,
    depName,
    workspaceVersion,
    rootVersion,
    kind,
  );
  if (aliasMismatch !== null) {
    return aliasMismatch;
  }

  const rootRange = extractSemverRange(rootVersion);
  if (rootRange === null) {
    return {
      workspace,
      name: depName,
      kind,
      message: `${workspace}: ${depName} root version "${rootVersion}" is not a valid semver range`,
    };
  }

  // The root range must be a subset of (or equal to) the workspace range.
  // An overly-broad root range could install a version the workspace cannot
  // accept. semver.subset(rootRange, workspaceRange) checks this.
  if (!isRootSubsetOfWorkspace(rootRange, workspaceRange)) {
    return {
      workspace,
      name: depName,
      kind,
      message:
        `${workspace}: ${depName} root range "${rootRange}" is not a subset ` +
        `of workspace range "${workspaceRange}"`,
    };
  }

  return null;
}

/**
 * Verify all dependencies of a single workspace manifest against the root.
 * Returns mismatch diagnostics for each problem found.
 *
 * `internalPackages` is a manifest-derived set of internal package names.
 * When provided, protocol specifiers are checked against it.
 */
export function checkWorkspaceDependencies(
  workspace: string,
  workspaceManifest: ManifestDependencies,
  root: ManifestDependencies,
  internalPackages?: ReadonlySet<string>,
  protocolResolver?: ProtocolTargetResolver,
): DependencyMismatch[] {
  const mismatches: DependencyMismatch[] = [];

  for (const { name, version, kind } of iterateWorkspaceDependencies(
    workspaceManifest,
  )) {
    const mismatch = checkDependencyCoverage(
      workspace,
      name,
      version,
      kind,
      root,
      internalPackages,
      protocolResolver,
    );
    if (mismatch !== null) {
      mismatches.push(mismatch);
    }
  }

  return mismatches;
}

function shippedWorkspaceDir(entry: string): string | null {
  const segments = entry.split('/').filter((segment) => segment.length > 0);
  if (segments[0] !== 'packages' || segments.length < 2) return null;
  if (!segments[1].startsWith('@')) return `packages/${segments[1]}`;
  if (segments.length < 3) return null;
  return `packages/${segments[1]}/${segments[2]}`;
}

/**
 * Derive the set of shipped workspace directories from the root package.json
 * `files` allowlist. Each entry like `packages/cli/src/` or
 * `packages/cli/index.ts` contributes `packages/cli`.
 */
export function deriveShippedWorkspaceDirs(root: RootManifest): Set<string> {
  return new Set(
    (root.files ?? [])
      .map(shippedWorkspaceDir)
      .filter((dir): dir is string => dir !== null),
  );
}

/**
 * A duplicate dependency diagnostic: a package declared in more than one
 * dependency section of the SAME manifest (F6).
 */
export interface RootDuplicateDependency {
  readonly name: string;
  readonly sections: readonly string[];
  readonly message: string;
}

/**
 * Detect packages declared in multiple dependency sections
 * (dependencies, optionalDependencies, peerDependencies) of the root
 * manifest (F6). A duplicate across sections creates ambiguity at install
 * time and allows per-section version drift.
 *
 * Returns a diagnostic for each package found in more than one section.
 */
export function detectRootDuplicateDependencies(
  root: ManifestDependencies,
): RootDuplicateDependency[] {
  const sections: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['dependencies', root.dependencies ?? {}],
    ['optionalDependencies', root.optionalDependencies ?? {}],
    ['peerDependencies', root.peerDependencies ?? {}],
  ];
  const sectionNames = new Map<string, string[]>();
  for (const [sectionName, deps] of sections) {
    for (const name of Object.keys(deps)) {
      const list = sectionNames.get(name);
      if (list === undefined) {
        sectionNames.set(name, [sectionName]);
      } else {
        list.push(sectionName);
      }
    }
  }
  const duplicates: RootDuplicateDependency[] = [];
  for (const [name, foundSections] of sectionNames) {
    if (foundSections.length <= 1) continue;
    duplicates.push({
      name,
      sections: foundSections,
      message:
        `Duplicate dependency "${name}" declared in multiple root sections: ` +
        `${foundSections.join(', ')} — declare in only one section.`,
    });
  }
  return duplicates;
}

/**
 * Finding6: The result of resolving a protocol specifier against a real
 * workspace with canonical path verification and target manifest name checking.
 *
 * `resolved: true` means the specifier was verified against:
 * 1. The canonical (realpath-resolved) workspace directory matches the expected
 *    directory from the name→dir map.
 * 2. The target workspace's `package.json` `name` field matches the dependency
 *    name exactly.
 *
 * `resolved: false` means the specifier could not be verified (target
 * directory does not exist, manifest name mismatch, symlink target outside
 * repo root, unknown package name, etc.).
 */
export interface RealProtocolResolution {
  readonly resolved: boolean;
  readonly workspaceDir?: string;
  readonly reason?: string;
}

/**
 * Extract the path component from a protocol specifier.
 *
 * - `file:../core`     → `../core`
 * - `workspace:*`      → `*`
 * - `link:../core`     → `../core`
 * - `file:./packages/core` → `./packages/core`
 */
function extractProtocolPath(specifier: string): string {
  const colonIndex = specifier.indexOf(':');
  if (colonIndex === -1) return specifier;
  return specifier.slice(colonIndex + 1);
}

/**
 * Read the `name` field from a workspace's `package.json`.
 * Returns undefined if the manifest is missing, unreadable, or has no name.
 */
function readWorkspaceName(
  workspaceDir: string,
  repoRoot: string,
): string | undefined {
  const manifestPath = join(repoRoot, workspaceDir, 'package.json');
  if (!existsSync(manifestPath)) return undefined;
  try {
    const content = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(content) as { name?: unknown };
    return typeof parsed.name === 'string' ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a protocol specifier against a real workspace directory, verifying
 * the canonical path and target manifest name.
 *
 * Finding6: the resolver performs:
 * 1. Look up the expected workspace directory from `nameToDir`.
 * 2. For `file:` and `link:` protocols, resolve the path relative to the
 *    *consuming* workspace (which is the workspaceDir from nameToDir), then
 *    canonicalize via `realpathSync` to handle symlinks.
 * 3. Verify the resolved canonical path matches the expected workspace
 *    directory (also canonicalized).
 * 4. Verify the target workspace's `package.json` `name` field matches the
 *    dependency name.
 * 5. For `workspace:` protocol, trust the name→dir mapping and verify the
 *    target manifest name.
 */
function resolveProtocol(
  depName: string,
  specifier: string,
  repoRoot: string,
  nameToDir: ReadonlyMap<string, string>,
  consumerWorkspace?: string,
): RealProtocolResolution {
  const expectedDir = nameToDir.get(depName);
  if (expectedDir === undefined) {
    return {
      resolved: false,
      reason: `Unknown package name "${depName}" — not in workspace name→dir map`,
    };
  }

  // Canonicalize the expected directory for comparison
  const expectedAbs = resolve(repoRoot, expectedDir);
  let expectedReal: string;
  try {
    expectedReal = realpathSync(expectedAbs);
  } catch {
    return {
      resolved: false,
      reason: `Expected workspace directory "${expectedDir}" does not exist`,
    };
  }

  // For file: and link: protocols, resolve the path relative to the
  // *consuming* workspace (not the target), because npm resolves file:
  // specifiers relative to the consuming package.json's directory.
  // When consumerWorkspace is not provided, fail closed rather than
  // guessing with the target's parent directory.
  if (specifier.startsWith('file:') || specifier.startsWith('link:')) {
    const pathPart = extractProtocolPath(specifier);
    if (consumerWorkspace === undefined) {
      return {
        resolved: false,
        reason:
          'Consumer workspace directory is required to resolve ' +
          'file: or link: protocol specifiers',
      };
    }
    const consumerAbs = resolve(repoRoot, consumerWorkspace);
    const resolvedAbs = resolve(consumerAbs, pathPart);
    // Verify the resolved path exists
    if (!existsSync(resolvedAbs)) {
      return {
        resolved: false,
        reason: `Path "${pathPart}" does not exist`,
      };
    }
    // Canonicalize via realpath to handle symlinks
    let resolvedReal: string;
    try {
      resolvedReal = realpathSync(resolvedAbs);
    } catch {
      return {
        resolved: false,
        reason: `Cannot resolve canonical path for "${pathPart}"`,
      };
    }
    // Verify the canonical path matches the expected workspace
    if (resolvedReal !== expectedReal) {
      return {
        resolved: false,
        reason: `Resolved path does not match expected workspace "${expectedDir}"`,
      };
    }
  }

  // For all protocols: verify the target manifest name matches
  const targetName = readWorkspaceName(expectedDir, repoRoot);
  if (targetName === undefined) {
    return {
      resolved: false,
      reason: `Cannot read name from "${expectedDir}/package.json"`,
    };
  }
  if (targetName !== depName) {
    return {
      resolved: false,
      reason: `Target manifest name "${targetName}" does not match dependency name "${depName}"`,
    };
  }

  return {
    resolved: true,
    workspaceDir: expectedDir,
  };
}

/**
 * Finding6: Create a real protocol resolver that verifies file:/link:/workspace:
 * specifiers against the actual filesystem.
 *
 * The resolver canonicalizes paths via `realpathSync` (handling symlinks)
 * and verifies the target workspace's `package.json` name field matches the
 * dependency name exactly.
 *
 * @param repoRoot The repository root directory.
 * @param nameToDir A map from package name to workspace directory (relative
 *   to repoRoot, e.g. `packages/core`).
 * @returns A `ProtocolTargetResolver` function.
 */
export function createRealProtocolResolver(
  repoRoot: string,
  nameToDir: ReadonlyMap<string, string>,
): ProtocolTargetResolver {
  return (
    depName: string,
    specifier: string,
    consumerWorkspace?: string,
  ): ProtocolTargetResolution =>
    resolveProtocol(depName, specifier, repoRoot, nameToDir, consumerWorkspace);
}
