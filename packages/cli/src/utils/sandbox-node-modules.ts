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
 * The source-development path (#3455) — a positively identified llxprt-code
 * source checkout under NODE_ENV=development — is excluded: it keeps the
 * legacy single workspace bind, because bootstrapping the source CLI needs
 * the repository's own dependencies. The same shared predicate selects the
 * source entrypoint command, so an arbitrary repository with ambient
 * NODE_ENV=development never bypasses the private volumes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  canonicalizeExistingPath,
  canonicalizeNearestExistingPath,
  type SandboxPathFilesystem,
} from './sandbox-path-canonicalization.js';
import {
  getContainerPath,
  isSourceDevelopmentWorkdir,
} from './sandbox-env.js';
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

/**
 * The image-global executable location validated for this sandbox image:
 * its Dockerfile installs bun under BUN_INSTALL=/usr/local/bun and nothing
 * else lives there. A project `.bin` symlink dangling into this prefix can
 * only resolve inside the sandbox image. Generic system prefixes such as
 * /usr/bin or /usr/local/bin are NOT LLxprt image claims; dangling links
 * to unknown targets are left to the package manager that created them.
 */
const IMAGE_GLOBAL_BIN_PREFIX = '/usr/local/bun/bin/';

const MACH_O_THIN_MAGICS = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
]);
/**
 * On-disk universal/fat magics. Apple stores fat structures big-endian,
 * so the FAT_CIGAM constants are byte-swapped host-memory comparison
 * values, not additional little-endian on-disk formats.
 */
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const FAT_HEADER_BYTES = 8;
const FAT_ARCH_BYTES = 20;
const FAT_ARCH_64_BYTES = 32;
/** Universal binaries never carry more than a handful of slices. */
const MAX_FAT_ARCHITECTURES = 128;
const HEADER_PROBE_BYTES = 512;
/** DOS stubs stay far below this; larger e_lfanew values are not PE. */
const MAX_PE_OFFSET = 1 << 24;

interface RecognizedBinary {
  readonly format: 'ELF' | 'Mach-O' | 'PE';
  readonly platform: 'Linux' | 'macOS' | 'Windows';
}

/**
 * Either a positively recognized binary, a PE whose validated e_lfanew
 * lies beyond the bytes read so far and needs one positioned follow-up
 * read, or a universal header whose declared architecture table extends
 * beyond the bytes read so far and needs its final byte proven readable.
 */
type HeaderClassification =
  | { readonly kind: 'recognized'; readonly binary: RecognizedBinary }
  | { readonly kind: 'pe-continuation'; readonly peOffset: number }
  | { readonly kind: 'fat-continuation'; readonly requiredBytes: number };

function hostPlatformName(): 'Linux' | 'macOS' | 'Windows' {
  switch (os.platform()) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    default:
      return 'Linux';
  }
}

function repairGuidance(relTree: string): string {
  return `Remove the affected project-local node_modules at '${relTree}', reinstall on the host, and retry.`;
}

/**
 * Classifies the minimum bytes needed to recognize ELF, Mach-O (thin and
 * universal/fat), and PE headers. Truncated or unknown content is
 * deliberately not an error: the preflight only rejects what it can
 * positively identify as another platform's binary.
 */
function classifyBinaryHeader(
  bytes: Uint8Array,
): HeaderClassification | undefined {
  if (hasMagicPrefix(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
    return { kind: 'recognized', binary: { format: 'ELF', platform: 'Linux' } };
  }
  if (bytes.length >= 4) {
    const magic = readUint32BE(bytes, 0);
    if (MACH_O_THIN_MAGICS.has(magic)) {
      return recognizedMachO();
    }
    if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
      return classifyFatHeader(bytes, magic);
    }
  }
  return classifyPeHeader(bytes);
}

/**
 * Classifies a universal/fat Mach-O header. A universal binary is only
 * recognized when its COMPLETE declared architecture table is readable:
 * a bare magic-plus-nfat_arch prefix is a truncated file, which the
 * preflight treats as benign. The architecture count stays bounded so
 * random bytes (or a same-magic foreign format) are not mistaken for a
 * universal binary.
 */
function classifyFatHeader(
  bytes: Uint8Array,
  magic: number,
): HeaderClassification | undefined {
  if (bytes.length < FAT_HEADER_BYTES) return undefined;
  const architectureCount = readUint32BE(bytes, 4);
  if (architectureCount < 1 || architectureCount > MAX_FAT_ARCHITECTURES) {
    return undefined;
  }
  const recordBytes =
    magic === FAT_MAGIC_64 ? FAT_ARCH_64_BYTES : FAT_ARCH_BYTES;
  const requiredBytes = FAT_HEADER_BYTES + architectureCount * recordBytes;
  return requiredBytes <= bytes.length
    ? recognizedMachO()
    : { kind: 'fat-continuation', requiredBytes };
}

function recognizedMachO(): HeaderClassification {
  return {
    kind: 'recognized',
    binary: { format: 'Mach-O', platform: 'macOS' },
  };
}

/** PE needs the MZ magic, a sane readable e_lfanew, and a `PE\0\0`. */
function classifyPeHeader(bytes: Uint8Array): HeaderClassification | undefined {
  if (!hasMagicPrefix(bytes, [0x4d, 0x5a]) || bytes.length < 0x40) {
    return undefined;
  }
  const peOffset = readUint32LE(bytes, 0x3c);
  if (peOffset < 0x40 || peOffset > MAX_PE_OFFSET) {
    return undefined;
  }
  if (peOffset + 4 <= bytes.length) {
    return hasMagicPrefix(bytes.subarray(peOffset), [0x50, 0x45, 0x00, 0x00])
      ? { kind: 'recognized', binary: { format: 'PE', platform: 'Windows' } }
      : undefined;
  }
  // The validated offset lies beyond the probe buffer; the caller must read
  // the signature at the offset itself.
  return { kind: 'pe-continuation', peOffset };
}

function hasMagicPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] * 0x01_00_00_00 +
      bytes[offset + 1] * 0x1_00_00 +
      bytes[offset + 2] * 0x1_00 +
      bytes[offset + 3]) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] +
      bytes[offset + 1] * 0x1_00 +
      bytes[offset + 2] * 0x1_00_00 +
      bytes[offset + 3] * 0x01_00_00_00) >>>
    0
  );
}

function readHeaderBytes(filePath: string): Uint8Array | undefined {
  return readBytesAt(filePath, 0, HEADER_PROBE_BYTES);
}

function readBytesAt(
  filePath: string,
  offset: number,
  length: number,
): Uint8Array | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
    if (bytesRead === 0) return undefined;
    return buffer.subarray(0, bytesRead);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function assertHeaderMatchesHost(
  filePath: string,
  relPath: string,
  relTree: string,
): void {
  const header = readHeaderBytes(filePath);
  if (header === undefined) return;
  const classification = classifyBinaryHeader(header);
  if (classification === undefined) return;
  const recognized = completeClassification(filePath, classification);
  if (recognized === undefined) return;
  const host = hostPlatformName();
  if (recognized.platform !== host) {
    throw new FatalSandboxError(
      `Sandbox dependency preflight failed: '${relPath}' is a ` +
        `${recognized.format} binary for ${recognized.platform}, which does ` +
        `not match this host (${host}). ${repairGuidance(relTree)}`,
    );
  }
}

function completeClassification(
  filePath: string,
  classification: HeaderClassification,
): RecognizedBinary | undefined {
  if (classification.kind === 'recognized') return classification.binary;
  if (classification.kind === 'fat-continuation') {
    // Reading the table's final byte proves the complete declared
    // architecture table exists in the file; a short read means the file
    // is truncated and stays benign.
    const tail = readBytesAt(filePath, classification.requiredBytes - 1, 1);
    return tail === undefined
      ? undefined
      : { format: 'Mach-O', platform: 'macOS' };
  }
  const signature = readBytesAt(filePath, classification.peOffset, 4);
  if (signature === undefined) return undefined;
  return hasMagicPrefix(signature, [0x50, 0x45, 0x00, 0x00])
    ? { format: 'PE', platform: 'Windows' }
    : undefined;
}

/** True when the resolved target stays inside the real workspace tree. */
function isContainedTarget(
  workspaceRealRoot: string,
  resolvedTarget: string,
): boolean {
  const nearest = canonicalizeNearestExistingPath(
    resolvedTarget,
    'resolve the sandbox dependency symlink target',
  );
  return isInsideWorkspace(workspaceRealRoot, nearest);
}

function assertBinSymlinkResolvesOnHost(
  linkPath: string,
  relPath: string,
  relTree: string,
  workspaceRealRoot: string,
): void {
  let target: string;
  try {
    target = fs.readlinkSync(linkPath);
  } catch {
    return;
  }
  if (path.isAbsolute(target)) {
    // Only a dangling link into the validated image-global bun location is
    // a recognizable LLxprt-image-only target; every other absolute target
    // is an unknown host-side claim this preflight does not judge.
    const isImageGlobalTarget = target.startsWith(IMAGE_GLOBAL_BIN_PREFIX);
    if (isImageGlobalTarget && !fs.existsSync(target)) {
      throw new FatalSandboxError(
        `Sandbox dependency preflight failed: '${relPath}' is a symlink to ` +
          `'${target}', which only exists inside the LLxprt sandbox image, ` +
          `not on this host (${hostPlatformName()}). ${repairGuidance(relTree)}`,
      );
    }
    return;
  }
  // Relative targets are only inspected while they stay inside the real
  // workspace tree; escaping targets belong to the host, not this launch.
  const resolved = path.resolve(path.dirname(linkPath), target);
  if (!isContainedTarget(workspaceRealRoot, resolved)) return;
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return;
  }
  if (stat.isFile()) {
    assertHeaderMatchesHost(resolved, relPath, relTree);
  }
}

function assertNodeSymlinkMatchesHost(
  linkPath: string,
  relPath: string,
  relTree: string,
  workspaceRealRoot: string,
): void {
  let target: string;
  try {
    target = fs.readlinkSync(linkPath);
  } catch {
    return;
  }
  const resolved = path.isAbsolute(target)
    ? target
    : path.resolve(path.dirname(linkPath), target);
  if (!isContainedTarget(workspaceRealRoot, resolved)) return;
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return;
  }
  if (stat.isFile()) {
    assertHeaderMatchesHost(resolved, relPath, relTree);
  }
}

function preflightProtectedTree(
  tree: string,
  workdir: string,
  workspaceRealRoot: string,
): void {
  const relTree = path.relative(workdir, tree);
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Unreadable or absent trees are not contamination; the empty private
      // mount replaces them anyway.
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(workdir, fullPath);
      if (entry.isDirectory()) {
        // node-gyp-build `prebuilds/` directories deliberately ship binaries
        // for many platforms in one install; only the loader for the current
        // platform is ever used, so foreign entries there are inert data, not
        // contamination. Other directories are walked in place (directory
        // symlinks are never followed out of the tree).
        if (entry.name !== 'prebuilds') {
          walk(fullPath);
        }
      } else if (entry.isSymbolicLink()) {
        if (path.basename(dir) === '.bin') {
          assertBinSymlinkResolvesOnHost(
            fullPath,
            relPath,
            relTree,
            workspaceRealRoot,
          );
        } else if (entry.name.endsWith('.node')) {
          assertNodeSymlinkMatchesHost(
            fullPath,
            relPath,
            relTree,
            workspaceRealRoot,
          );
        }
      } else if (
        entry.isFile() &&
        (path.basename(dir) === '.bin' || entry.name.endsWith('.node'))
      ) {
        // Regular executables sitting directly in `.bin` are inspected like
        // native addons: they are what the container would try to run.
        assertHeaderMatchesHost(fullPath, relPath, relTree);
      }
    }
  };
  walk(tree);
}

function isInsideWorkspace(workdir: string, candidate: string): boolean {
  const relative = path.relative(workdir, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/**
 * Reads the root manifest's ordinary workspace list and returns its literal
 * package-root declarations. Glob, exclusion, and non-string entries are
 * package-manager syntax, not literal roots; expanding them would invent
 * destinations the plan forbids. Non-list workspace metadata (for example
 * the `workspaces.packages` object form) is outside this issue's accepted
 * behavior and is not interpreted.
 */
function readLiteralWorkspaceDeclarations(manifestPath: string): string[] {
  let declarations: unknown;
  try {
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof manifest !== 'object' || manifest === null) return [];
    declarations = Reflect.get(manifest, 'workspaces');
  } catch {
    return [];
  }
  if (!Array.isArray(declarations)) return [];
  return declarations.filter(
    (declaration): declaration is string =>
      typeof declaration === 'string' &&
      declaration !== '' &&
      !declaration.startsWith('!') &&
      !/[*?[]/.test(declaration),
  );
}

/**
 * Returns the `node_modules` destinations that must be replaced by private
 * per-run mounts for a workspace: the root tree first, then one tree per
 * literal workspace declaration in the root manifest. Duplicates that
 * reach one directory (directly or through symlinks) are removed by
 * filesystem identity, and a declaration that resolves outside the real
 * workspace tree fails the launch. A missing or unparseable manifest
 * protects the root tree only.
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
  const destinations: string[] = [];
  const seenIdentities = new Set<string>();

  const acceptDestination = (
    lexicalDestination: string,
    source: string,
  ): void => {
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
    if (seenIdentities.has(identity)) return;
    seenIdentities.add(identity);
    // Re-anchor the resolved route onto the launch workspace path so the
    // nested bind lands inside the shared workspace bind in the container
    // (the workspace may itself sit under a symlinked host prefix).
    destinations.push(
      path.join(workdir, path.relative(workspaceRealRoot, identity)),
    );
  };

  acceptDestination(
    path.join(workdir, 'node_modules'),
    `'node_modules' (the workspace root dependency tree)`,
  );

  const manifestPath = path.join(workdir, 'package.json');
  for (const declaration of readLiteralWorkspaceDeclarations(manifestPath)) {
    acceptDestination(
      path.join(path.resolve(workdir, declaration), 'node_modules'),
      `'${declaration}' in ${manifestPath}`,
    );
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
      readonly workdir: string;
      readonly destinations: readonly string[];
      readonly originallyAbsentDestinations: readonly string[];
    };

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
  workdir: string,
): DependencyMountPlan {
  if (isSourceDevelopmentWorkdir(workdir)) return { enabled: false };

  const workspaceRealRoot = canonicalizeExistingPath(
    workdir,
    'resolve the sandbox workspace root',
  );
  const destinations = resolveProtectedNodeModulesDestinations(workdir);
  for (const destination of destinations) {
    assertDestinationChainIsDirectories(workdir, destination);
    preflightProtectedTree(destination, workdir, workspaceRealRoot);
  }
  return {
    enabled: true,
    workdir,
    destinations,
    originallyAbsentDestinations: destinations.filter(
      (destination) => !fs.existsSync(destination),
    ),
  };
}

export function addPrivateDependencyMounts(
  config: SandboxConfig,
  args: string[],
  workdir: string,
  planned: DependencyMountPlan = planPrivateDependencyMounts(workdir),
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
