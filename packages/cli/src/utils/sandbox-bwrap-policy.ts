/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import type { SandboxMountConfig } from '@vybestack/llxprt-code-core';
import {
  buildBwrapDeviceArgs,
  preflightSandboxDevices,
  resolveSandboxDevices,
  type ResolvedSandboxDevices,
} from './sandbox-devices.js';

export interface BwrapMountPolicyInput {
  readonly workspaceRoot: string;
  readonly includeRoots?: readonly string[];
  readonly mounts?: readonly SandboxMountConfig[];
  readonly network?: 'on' | 'off' | 'proxied';
  readonly homeDir?: string;
  readonly runtimeRoots?: readonly string[];
  readonly sshAgentSocket?: string;
  readonly maskedRoots?: readonly string[];
  readonly devices?: readonly string[];
}

function canonicalDirectory(candidate: string, description: string): string {
  let canonical: string;
  try {
    canonical = fs.realpathSync(candidate);
  } catch (error) {
    throw new FatalSandboxError(
      `Cannot resolve ${description} '${candidate}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!fs.statSync(canonical).isDirectory()) {
    throw new FatalSandboxError(
      `${description} '${candidate}' must be a directory.`,
    );
  }
  return canonical;
}

function canonicalMountSource(source: string): string {
  try {
    return fs.realpathSync(source);
  } catch (error) {
    throw new FatalSandboxError(
      `Cannot resolve sandbox mount source '${source}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeMountDestination(destination: string): string {
  if (
    !path.posix.isAbsolute(destination) ||
    destination.includes('\0') ||
    destination.split('/').includes('..') ||
    path.posix.normalize(destination) !== destination
  ) {
    throw new FatalSandboxError(
      `Invalid bwrap mount destination '${destination}': use a normalized absolute POSIX path without '..'.`,
    );
  }
  return destination;
}

/**
 * True when `candidate` is `parent` or lies below it. Only a leading `..`
 * path segment means "outside"; a directory named `..cache` is inside.
 */
export function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function isNestedBelow(parent: string, candidate: string): boolean {
  return candidate !== parent && isWithin(parent, candidate);
}

export function addBwrapDestinationParents(
  args: string[],
  destination: string,
): void {
  const parts = destination.split('/').filter(Boolean);
  let current = '';
  for (const part of parts.slice(0, -1)) {
    current = path.posix.join(current || '/', part);
    args.push('--dir', current);
  }
}

/**
 * Host paths that bwrap replaces with a private tmpfs before any workspace
 * bind is applied. A workspace root that equals or contains one of them, or
 * the home directory, would be bound over its mask and expose the real
 * directory to the payload.
 */
const BWRAP_MASKED_PATHS = [
  '/home',
  '/root',
  '/run',
  '/tmp',
  '/var/tmp',
] as const;

/**
 * The literal mask path plus its canonical target. bwrap applies `--tmpfs`
 * to the target of a symbolic link in the host root, so a workspace that
 * resolves to that target is bound over the mask. A mask path that does not
 * exist on the host has no target, and only the literal path is compared.
 */
function maskPathAliases(masked: string): readonly string[] {
  try {
    const canonical = fs.realpathSync(masked);
    return canonical === masked ? [masked] : [masked, canonical];
  } catch {
    return [masked];
  }
}

export function assertSafeWorkspace(
  workspace: string,
  homeDir: string,
  maskedPaths: readonly string[] = BWRAP_MASKED_PATHS,
): void {
  if (
    workspace === '/' ||
    isWithin(workspace, homeDir) ||
    maskedPaths
      .flatMap(maskPathAliases)
      .some((masked) => isWithin(workspace, masked))
  ) {
    throw new FatalSandboxError(
      `The bwrap workspace '${workspace}' overlaps a protected root; choose a project directory below the home directory.`,
    );
  }
}

function appendMask(args: string[], mask: string): void {
  args.push('--tmpfs', mask);
}

function appendMount(
  args: string[],
  source: string,
  destination: string,
  mode: 'ro' | 'rw',
): void {
  addBwrapDestinationParents(args, destination);
  args.push(mode === 'rw' ? '--bind' : '--ro-bind', source, destination);
}

function validatedProfileMounts(
  mounts: readonly SandboxMountConfig[],
  homeDir: string,
): ReadonlyArray<{
  readonly source: string;
  readonly destination: string;
  readonly mode: 'ro' | 'rw';
}> {
  const protectedDestinations = [
    '/home',
    '/root',
    '/run',
    '/proc',
    '/dev',
    '/sys/fs/cgroup',
  ];
  const seen = new Set<string>();
  return mounts.map((mount) => {
    const source = canonicalMountSource(mount.from);
    if (source === '/') {
      throw new FatalSandboxError(
        'A bwrap profile cannot mount the host root.',
      );
    }
    const destination = normalizeMountDestination(mount.to ?? mount.from);
    if (isWithin('/dev', destination)) {
      throw new FatalSandboxError(
        `Sandbox mount destination '${destination}' is inside /dev; grant devices through the profile devices field.`,
      );
    }
    const overlapsProtectedPath = protectedDestinations.some(
      (protectedPath) => {
        const sourceOverlaps =
          isWithin(source, protectedPath) ||
          (!['/home', '/root'].includes(protectedPath) &&
            isWithin(protectedPath, source));
        return isWithin(destination, protectedPath) || sourceOverlaps;
      },
    );
    if (
      overlapsProtectedPath ||
      isWithin(destination, homeDir) ||
      isWithin(source, homeDir)
    ) {
      throw new FatalSandboxError(
        `Sandbox mount destination '${destination}' overlaps a protected bwrap control path.`,
      );
    }
    if (seen.has(destination)) {
      throw new FatalSandboxError(
        `Duplicate bwrap mount destination '${destination}'.`,
      );
    }
    seen.add(destination);
    const mode = mount.mode ?? 'ro';
    return { source, destination, mode };
  });
}

function buildBwrapBaseArgs(
  input: BwrapMountPolicyInput,
  workspace: string,
  homeDir: string,
  roots: readonly string[],
): string[] {
  const args = [
    '--unshare-user',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup-try',
    '--disable-userns',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--ro-bind',
    '/',
    '/',
  ];
  for (const mask of BWRAP_MASKED_PATHS) {
    appendMask(args, mask);
  }
  for (const maskedRoot of input.maskedRoots ?? []) {
    const canonicalMaskedRoot = canonicalDirectory(
      maskedRoot,
      'protected host storage root',
    );
    if (
      roots.some(
        (root) =>
          isWithin(canonicalMaskedRoot, root) ||
          isWithin(root, canonicalMaskedRoot),
      )
    ) {
      throw new FatalSandboxError(
        `Workspace '${workspace}' overlaps protected host storage '${canonicalMaskedRoot}'.`,
      );
    }
    appendMask(args, canonicalMaskedRoot);
  }
  if (!isWithin('/home', homeDir) && !isWithin('/root', homeDir)) {
    appendMask(args, homeDir);
  }
  if (fs.existsSync('/run/systemd/resolve')) {
    args.push(
      '--dir',
      '/run/systemd',
      '--ro-bind',
      '/run/systemd/resolve',
      '/run/systemd/resolve',
    );
  }
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/sys/fs/cgroup');
  return args;
}

function resolveBwrapDeviceGrants(
  devices: readonly string[] | undefined,
  roots: readonly string[],
): ResolvedSandboxDevices {
  const resolved = resolveSandboxDevices(devices ?? []);
  for (const root of roots) {
    const covered = resolved.grants.find((grant) => isWithin(root, grant));
    if (covered !== undefined) {
      throw new FatalSandboxError(
        `Workspace root '${root}' would cover the granted device '${covered}'.`,
      );
    }
  }
  preflightSandboxDevices(resolved);
  return resolved;
}

/**
 * Storage roots that need a mask of their own. A root is left out only when
 * its canonical path lies inside the canonical home directory, which is
 * masked as a whole. A symbolic link inside the home that points elsewhere
 * resolves to the outside target, which the read-only host bind would
 * otherwise expose at its real path.
 */
export function storageRootsRequiringMask(
  storageRoots: readonly string[],
  homeDir: string,
): string[] {
  const canonicalHome = canonicalDirectory(homeDir, 'home directory');
  return storageRoots
    .map((root) => canonicalDirectory(root, 'protected host storage root'))
    .filter((root) => !isWithin(canonicalHome, root));
}

export function buildBwrapMountArgs(
  input: BwrapMountPolicyInput,
): readonly string[] {
  if (input.network === 'proxied') {
    throw new FatalSandboxError(
      'bwrap does not support network: "proxied" because direct connections cannot be blocked; use network: "off" or "on".',
    );
  }

  const workspace = canonicalDirectory(input.workspaceRoot, 'workspace');
  const homeDir = fs.realpathSync(input.homeDir ?? process.env.HOME ?? '/root');
  assertSafeWorkspace(workspace, homeDir);
  const includeRoots = (input.includeRoots ?? []).map((root) =>
    canonicalDirectory(root, 'included workspace'),
  );
  const roots = [workspace, ...includeRoots];
  for (const root of roots) {
    assertSafeWorkspace(root, homeDir);
  }
  for (let index = 0; index < roots.length; index += 1) {
    for (let other = index + 1; other < roots.length; other += 1) {
      if (
        isWithin(roots[index], roots[other]) ||
        isWithin(roots[other], roots[index])
      ) {
        throw new FatalSandboxError(
          `Bwrap workspace roots overlap: '${roots[index]}' and '${roots[other]}'.`,
        );
      }
    }
  }

  const profileMounts = validatedProfileMounts(input.mounts ?? [], homeDir);
  const deviceGrants = resolveBwrapDeviceGrants(input.devices, roots);
  const runtimeRoots = (input.runtimeRoots ?? []).map((root) =>
    canonicalDirectory(root, 'runtime root'),
  );
  const args = buildBwrapBaseArgs(input, workspace, homeDir, roots);

  addBwrapDestinationParents(args, homeDir);
  args.push('--dir', homeDir);
  for (const root of runtimeRoots) {
    appendMount(args, root, root, 'ro');
  }
  for (const root of roots) {
    appendMount(args, root, root, 'rw');
  }
  // A runtime root inside a workspace would otherwise be hidden by the
  // writable workspace bind above, so it is bound read-only again.
  for (const root of runtimeRoots) {
    if (roots.some((workspaceRoot) => isNestedBelow(workspaceRoot, root))) {
      appendMount(args, root, root, 'ro');
    }
  }
  for (const mount of profileMounts) {
    appendMount(args, mount.source, mount.destination, mount.mode);
  }
  if (input.sshAgentSocket) {
    const socketPath = fs.realpathSync(input.sshAgentSocket);
    if (!fs.statSync(socketPath).isSocket()) {
      throw new FatalSandboxError(
        `SSH_AUTH_SOCK '${input.sshAgentSocket}' is not a Unix socket.`,
      );
    }
    args.push('--dir', '/run/llxprt');
    args.push('--ro-bind', socketPath, '/run/llxprt/ssh-agent.sock');
  }
  args.push(...buildBwrapDeviceArgs(deviceGrants));

  if (input.network === 'off') {
    args.push('--unshare-net');
  }
  return args;
}
