/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-run private project dependency storage for the container sandbox
 * (#3450).
 *
 * The sandbox shares the workspace with the host as a read-write bind, so
 * host-installed `node_modules` trees leak into the container with host
 * binaries (and vice versa). Before a container launch, the workspace's
 * dependency destinations are replaced by fresh, empty engine-owned named
 * volumes. The sandboxed agent installs, builds, and tests against that
 * per-run storage, and the selected engine removes it when the session ends.
 *
 * A read-only preflight walks the EXISTING protected host trees in full
 * and fails the launch when it recognizes wrong-platform native binaries
 * or `.bin` symlinks that only resolve inside the sandbox image. Without
 * it, the empty private mounts would silently turn those into confusing
 * breakage after launch. Traversal itself covers the full protected trees
 * (truncating it could miss contamination), while artifact recognition is
 * bounded: each candidate gets one fixed-size header probe plus at most
 * one positioned follow-up read.
 *
 * The source-development path (#3455), a positively identified llxprt-code
 * source checkout under NODE_ENV=development, is excluded: it keeps the
 * legacy single workspace bind, because bootstrapping the source CLI needs
 * the repository's own dependencies. The same shared predicate selects the
 * source entrypoint command, so an arbitrary repository with ambient
 * NODE_ENV=development never bypasses the private volumes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  canonicalizeExistingPath,
  canonicalizeNearestExistingPath,
  type SandboxPathFilesystem,
} from './sandbox-path-canonicalization.js';
import { getContainerPath, isSourceDevelopmentWorkdir } from './sandbox-env.js';
import { planSandboxVenvDestination } from './sandbox-venv.js';
import {
  INIT_RUN_TIMEOUT_MS,
  VOLUME_OPERATION_TIMEOUT_MS,
  addSandboxDependencyRunLabel,
  buildDependencyInitRunArgs,
  buildDependencyVolumeCreateArgs,
  buildVolumeMountFlagArg,
  createSandboxDependencyRunId,
  engineFailureDetail,
  listEngineContainerNames,
  planDependencyVolumeNames,
  runEngineCommand,
} from './sandbox-dependency-volumes.js';
import {
  planWorkspacePackageDiscovery,
  type WorkspacePackageDiscoveryPlan,
  type WorkspacePackagePattern,
} from './sandbox-workspace-discovery.js';
import {
  isInsideWorkspace,
  preflightProtectedTree,
} from './sandbox-binary-preflight.js';

const EMPTY_WORKSPACE_DISCOVERY_PLAN: WorkspacePackageDiscoveryPlan = {
  inclusions: [],
  exclusions: [],
};

function readWorkspacePackageDiscoveryPlan(
  manifestPath: string,
): WorkspacePackageDiscoveryPlan {
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return EMPTY_WORKSPACE_DISCOVERY_PLAN;
  }
  if (typeof manifest !== 'object' || manifest === null) {
    return EMPTY_WORKSPACE_DISCOVERY_PLAN;
  }
  return planWorkspacePackageDiscovery(Reflect.get(manifest, 'workspaces'));
}

function comparePackageRoots(left: string, right: string): number {
  const depthDifference =
    left.split(path.sep).length - right.split(path.sep).length;
  if (depthDifference !== 0) return depthDifference;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function expandWorkspacePattern(
  workdir: string,
  planned: WorkspacePackagePattern,
  failOnNoMatch: boolean,
): string[] {
  if (planned.kind === 'literal') {
    return [path.resolve(workdir, planned.pattern)];
  }
  const packageRoots = globSync(`${planned.pattern}/package.json`, {
    cwd: workdir,
    absolute: true,
    nodir: true,
    follow: false,
    dot: false,
    ignore: ['**/node_modules/**', '**/.git/**'],
  })
    .map((manifest) => path.dirname(manifest))
    .sort(comparePackageRoots);
  if (failOnNoMatch && packageRoots.length === 0) {
    throw new FatalSandboxError(
      `Workspace glob '${planned.source}' matched no package roots in ` +
        `'${workdir}'. Correct the pattern, or use a literal workspace path ` +
        `for a package root that does not exist yet.`,
    );
  }
  return packageRoots;
}

interface ResolvedProtectedDestination {
  readonly identity: string;
  readonly destination: string;
}

function resolveContainedDestination(
  workdir: string,
  workspaceRealRoot: string,
  lexicalDestination: string,
  source: string,
  filesystem?: SandboxPathFilesystem,
): ResolvedProtectedDestination {
  // Lexical containment first: this catches `../` declarations before any
  // filesystem probing and keeps the error message path-shaped.
  if (!isInsideWorkspace(workdir, lexicalDestination)) {
    throw new FatalSandboxError(
      `Invalid workspace declaration ${source}: it resolves outside the ` +
        `workspace to ${lexicalDestination}.`,
    );
  }
  // Then real-tree containment: an existing symlink component must not
  // smuggle the destination out of the mounted workspace.
  const identity = canonicalizeNearestExistingPath(
    lexicalDestination,
    'resolve the protected sandbox dependency destination',
    filesystem,
  );
  if (!isInsideWorkspace(workspaceRealRoot, identity)) {
    throw new FatalSandboxError(
      `Invalid workspace declaration ${source}: it resolves outside the ` +
        `workspace to ${identity}.`,
    );
  }
  // Re-anchor the resolved route onto the launch workspace path so the
  // nested bind lands inside the shared workspace bind in the container
  // (the workspace may itself sit under a symlinked host prefix).
  return {
    identity,
    destination: path.join(workdir, path.relative(workspaceRealRoot, identity)),
  };
}

function resolvePatternDestinations(
  workdir: string,
  workspaceRealRoot: string,
  manifestPath: string,
  planned: WorkspacePackagePattern,
  failOnNoMatch: boolean,
  filesystem?: SandboxPathFilesystem,
): ResolvedProtectedDestination[] {
  return expandWorkspacePattern(workdir, planned, failOnNoMatch).map(
    (packageRoot) =>
      resolveContainedDestination(
        workdir,
        workspaceRealRoot,
        path.join(packageRoot, 'node_modules'),
        `'${planned.source}' in ${manifestPath}`,
        filesystem,
      ),
  );
}

/**
 * Returns the root and declared nested `node_modules` destinations that
 * need private per-run mounts for a workspace. Literal declarations
 * preserve #3450 behavior; supported globs discover contained package
 * roots with manifests, and exclusions remove discovered roots after
 * every positive declaration has been validated. Duplicates that reach
 * one directory (directly or through symlinks) are removed by filesystem
 * identity, and a declaration that resolves outside the real workspace
 * tree fails the launch. A missing or unparseable manifest protects the
 * root tree only.
 *
 * The optional `filesystem` seam exists so tests can exercise the
 * discovery-then-resolution race deterministically; production callers
 * use Node's fs.
 */
export function resolveProtectedNodeModulesDestinations(
  workdir: string,
  filesystem?: SandboxPathFilesystem,
): string[] {
  const workspaceRealRoot = canonicalizeExistingPath(
    workdir,
    'resolve the sandbox workspace root',
    filesystem,
  );
  const root = resolveContainedDestination(
    workdir,
    workspaceRealRoot,
    path.join(workdir, 'node_modules'),
    `'node_modules' (the workspace root dependency tree)`,
    filesystem,
  );
  const manifestPath = path.join(workdir, 'package.json');
  const plan = readWorkspacePackageDiscoveryPlan(manifestPath);
  const included = plan.inclusions.flatMap((planned) =>
    resolvePatternDestinations(
      workdir,
      workspaceRealRoot,
      manifestPath,
      planned,
      true,
      filesystem,
    ),
  );
  const excludedIdentities = new Set(
    plan.exclusions.flatMap((planned) =>
      resolvePatternDestinations(
        workdir,
        workspaceRealRoot,
        manifestPath,
        planned,
        false,
        filesystem,
      ).map((resolved) => resolved.identity),
    ),
  );
  const destinations = [root.destination];
  const seenIdentities = new Set([root.identity]);
  for (const resolved of included) {
    if (
      excludedIdentities.has(resolved.identity) ||
      seenIdentities.has(resolved.identity)
    ) {
      continue;
    }
    seenIdentities.add(resolved.identity);
    destinations.push(resolved.destination);
  }
  return destinations;
}

/**
 * Fails deterministically, naming the operation and path, when an existing
 * component of a protected destination is not a directory: the engine would
 * otherwise fail at launch with an engine-side error.
 */
function assertDestinationChainIsDirectories(
  workdir: string,
  destination: string,
): void {
  const segments = path
    .relative(workdir, destination)
    .split(path.sep)
    .filter((segment) => segment !== '');
  let current = workdir;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(current);
    } catch {
      // Nothing exists at this component; the launch creates the rest.
      return;
    }
    if (!stat.isDirectory()) {
      throw new FatalSandboxError(
        `Failed to prepare private sandbox dependency storage: ` +
          `'${current}' exists as a non-directory, but the protected ` +
          `destination '${destination}' must be mounted over a directory.`,
      );
    }
  }
}

/**
 * Removes a protected destination that the engine materialized as an empty
 * mountpoint through the workspace bind when it did not exist before
 * launch. A path that contains anything, or is not a directory, is never
 * touched (#3450 remediation F5).
 */
function removeEngineCreatedMountpoint(destination: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(destination);
  } catch {
    return;
  }
  if (!stat.isDirectory()) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(destination);
  } catch {
    return;
  }
  if (entries.length > 0) return;
  try {
    fs.rmdirSync(destination);
  } catch (error) {
    warnCleanupFailed(
      'remove the empty engine-created sandbox dependency mountpoint',
      destination,
      error,
    );
  }
}

function warnCleanupFailed(
  operation: string,
  target: string,
  error: unknown,
): void {
  const message =
    `Warning: failed to ${operation} at '${target}': ` +
    `${errorMessage(error)}\n`;
  debugLogger.error(message);
  process.stderr.write(message);
}

export interface DependencyVolumeLifecycle {
  (): void;
  recordMainContainerName(name: string): void;
  release(): void;
}

export type DependencyMountPlan =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly workspaceRoots: readonly string[];
      readonly destinations: readonly string[];
      readonly originallyAbsentDestinations: readonly string[];
    };

type WorkspaceRoots = string | readonly string[];

function normalizeWorkspaceRoots(
  workspaceRoots: WorkspaceRoots,
): readonly string[] {
  return typeof workspaceRoots === 'string' ? [workspaceRoots] : workspaceRoots;
}

interface MutableDependencyVolumeLifecycle extends DependencyVolumeLifecycle {
  recordCreatedVolume(name: string): void;
}

function containerEngine(config: SandboxConfig): 'docker' | 'podman' {
  if (config.command === 'docker' || config.command === 'podman') {
    return config.command;
  }
  throw new FatalSandboxError(
    `Private sandbox dependency volumes require Docker or Podman, not '${config.command}'.`,
  );
}

function warnEngineCleanupFailed(
  operation: string,
  target: string,
  detail: string,
): void {
  const message = `Warning: failed to ${operation} '${target}': ${detail}
`;
  debugLogger.error(message);
  process.stderr.write(message);
}

function removeDependencyContainer(
  engine: 'docker' | 'podman',
  name: string,
): void {
  const result = runEngineCommand(
    engine,
    ['rm', '-f', name],
    VOLUME_OPERATION_TIMEOUT_MS,
  );
  if (result.status !== 0) {
    warnEngineCleanupFailed(
      'remove the private sandbox dependency container',
      name,
      engineFailureDetail(result),
    );
  }
}

function removeAttachedDependencyContainers(
  engine: 'docker' | 'podman',
  names: readonly string[],
): void {
  const listed = listEngineContainerNames(engine);
  if (!listed.ok) {
    warnEngineCleanupFailed(
      'list private sandbox dependency containers before removing',
      names.join(', '),
      listed.detail,
    );
    for (const name of names) removeDependencyContainer(engine, name);
    return;
  }
  for (const name of names) {
    if (listed.names.includes(name)) removeDependencyContainer(engine, name);
  }
}

function removeDependencyVolumes(
  engine: 'docker' | 'podman',
  names: readonly string[],
): void {
  for (const name of names) {
    const result = runEngineCommand(
      engine,
      ['volume', 'rm', '-f', name],
      VOLUME_OPERATION_TIMEOUT_MS,
    );
    if (result.status !== 0) {
      warnEngineCleanupFailed(
        'remove the private sandbox dependency volume',
        name,
        engineFailureDetail(result),
      );
    }
  }
}

function runEngineCleanupStep(
  operation: string,
  engine: 'docker' | 'podman',
  cleanup: () => void,
): void {
  try {
    cleanup();
  } catch (error) {
    warnEngineCleanupFailed(operation, engine, errorMessage(error));
  }
}

function registerVolumeLifecycle(
  engine: 'docker' | 'podman',
  initContainerName: string,
  originallyAbsentDestinations: readonly string[],
): MutableDependencyVolumeLifecycle {
  let released = false;
  let createdVolumes: readonly string[] = [];
  let mainContainerName: string | undefined;
  const onSigint = (): void => handleTerminationSignal('SIGINT');
  const onSigterm = (): void => handleTerminationSignal('SIGTERM');
  const release = (): void => {
    if (released) return;
    released = true;
    process.off('exit', release);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    const containers = [mainContainerName, initContainerName].filter(
      (name): name is string => name !== undefined,
    );
    runEngineCleanupStep('remove dependency containers for', engine, () =>
      removeAttachedDependencyContainers(engine, containers),
    );
    runEngineCleanupStep('remove dependency volumes for', engine, () =>
      removeDependencyVolumes(engine, createdVolumes),
    );
    for (const destination of originallyAbsentDestinations) {
      removeEngineCreatedMountpoint(destination);
    }
  };
  const handleTerminationSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    release();
    if (process.listenerCount(signal) === 0) {
      process.kill(process.pid, signal);
    }
  };
  const lifecycle = Object.assign(release, {
    recordCreatedVolume: (name: string): void => {
      if (!released) createdVolumes = [...createdVolumes, name];
    },
    recordMainContainerName: (name: string): void => {
      if (!released) mainContainerName = name;
    },
    release,
  });
  process.on('exit', release);
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  return lifecycle;
}

function noDependencyVolumeLifecycle(): DependencyVolumeLifecycle {
  const release = (): void => {};
  return Object.assign(release, {
    recordMainContainerName: (_name: string): void => {},
    release,
  });
}

export function planPrivateDependencyMounts(
  workspaceRoots: WorkspaceRoots,
): DependencyMountPlan {
  const roots = normalizeWorkspaceRoots(workspaceRoots);
  if (isSourceDevelopmentWorkdir(roots[0])) return { enabled: false };

  const destinations: string[] = [];
  const seenDestinations = new Set<string>();
  for (const workdir of roots) {
    const workspaceRealRoot = canonicalizeExistingPath(
      workdir,
      'resolve the sandbox workspace root',
    );
    for (const destination of resolveProtectedNodeModulesDestinations(
      workdir,
    )) {
      if (seenDestinations.has(destination)) continue;
      seenDestinations.add(destination);
      assertDestinationChainIsDirectories(workdir, destination);
      preflightProtectedTree(destination, workdir, workspaceRealRoot);
      destinations.push(destination);
    }
  }
  // #3462: an in-workspace venv is one more protected destination, appended
  // after the node_modules trees. It is not preflighted: the host venv tree
  // is never mounted, so its contents cannot reach the container. A venv
  // path equal to an already-planned destination leaves that volume in place
  // (two volumes at one destination is an engine error, not isolation).
  // The venv may sit beneath the primary root or any accepted include root.
  for (const workdir of roots) {
    const venv = planSandboxVenvDestination(workdir);
    if (venv !== undefined && !destinations.includes(venv.destination)) {
      assertDestinationChainIsDirectories(workdir, venv.destination);
      destinations.push(venv.destination);
    }
  }
  return {
    enabled: true,
    workspaceRoots: roots,
    destinations,
    originallyAbsentDestinations: destinations.filter(
      (destination) => !fs.existsSync(destination),
    ),
  };
}

export function addPrivateDependencyMounts(
  config: SandboxConfig,
  args: string[],
  workspaceRoots: WorkspaceRoots,
  planned: DependencyMountPlan = planPrivateDependencyMounts(workspaceRoots),
): DependencyVolumeLifecycle {
  if (!planned.enabled) {
    debugLogger.log(
      'Source-development launch (NODE_ENV=development in an llxprt-code ' +
        'source checkout): keeping the shared workspace bind for the ' +
        'source-entrypoint sandbox path; private dependency isolation is ' +
        'installed-mode only.',
    );
    return noDependencyVolumeLifecycle();
  }

  const engine = containerEngine(config);
  const runId = createSandboxDependencyRunId();
  const volumeNames = planDependencyVolumeNames(planned.destinations.length);
  const initContainerName = `${volumeNames[0]}-init`;
  const lifecycle = registerVolumeLifecycle(
    engine,
    initContainerName,
    planned.originallyAbsentDestinations,
  );

  for (const name of volumeNames) {
    const result = runEngineCommand(
      engine,
      buildDependencyVolumeCreateArgs(name, runId),
      VOLUME_OPERATION_TIMEOUT_MS,
    );
    if (result.status !== 0) {
      lifecycle.release();
      throw new FatalSandboxError(
        `Failed to create the private sandbox dependency volume '${name}' with ${engine}: ${engineFailureDetail(result)}`,
      );
    }
    lifecycle.recordCreatedVolume(name);
  }

  const initResult = runEngineCommand(
    engine,
    buildDependencyInitRunArgs({
      engine,
      image: config.image,
      initContainerName,
      volumes: volumeNames,
      runId,
    }),
    INIT_RUN_TIMEOUT_MS,
  );
  if (initResult.status !== 0) {
    lifecycle.release();
    throw new FatalSandboxError(
      `Failed to initialize the private sandbox dependency volumes with ${engine}: ${engineFailureDetail(initResult)}`,
    );
  }

  addSandboxDependencyRunLabel(args, runId);
  planned.destinations.forEach((destination, index) => {
    args.push(
      '--mount',
      buildVolumeMountFlagArg(
        volumeNames[index],
        getContainerPath(destination),
      ),
    );
  });
  debugLogger.log(
    `Prepared ${volumeNames.length} engine-owned private sandbox dependency volume(s).`,
  );
  return lifecycle;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
