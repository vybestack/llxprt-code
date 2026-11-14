/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  FatalSandboxError,
  type SandboxConfig,
} from '@vybestack/llxprt-code-core';

const MAX_DEVICE_GRANTS = 64;
const MAX_DEVICE_PATH_BYTES = 4095;
const DEVICE_ROOT = '/dev';
const DRI_DIRECTORY = '/dev/dri';
const PSEUDO_FILESYSTEM_ROOTS = [
  '/dev/fd',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/pts',
  '/dev/shm',
  '/dev/mqueue',
] as const;
const RENDER_NODE = /^\/dev\/dri\/renderD\d+$/;

export interface DeviceEntryStat {
  readonly dev: number;
  isCharacterDevice(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isSocket(): boolean;
  isFIFO(): boolean;
}

export interface SandboxDeviceHost {
  lstat(target: string): DeviceEntryStat;
  realpath(target: string): string;
  readdir(target: string): readonly string[];
  access(target: string, mode: number): void;
  probeOpen(target: string): void;
}

export const hostDeviceFilesystem: SandboxDeviceHost = {
  lstat: (target) => fs.lstatSync(target),
  realpath: (target) => fs.realpathSync(target),
  readdir: (target) => fs.readdirSync(target),
  access: (target, mode) => fs.accessSync(target, mode),
  probeOpen: (target) => {
    const descriptor = fs.openSync(
      target,
      fs.constants.O_RDWR | fs.constants.O_NONBLOCK,
    );
    fs.closeSync(descriptor);
  },
};

export interface ResolvedSandboxDevices {
  /** Canonical, sorted grants as carried in the sandbox configuration. */
  readonly grants: readonly string[];
  /** Every character node the grants expose, sorted. */
  readonly nodes: readonly string[];
  /** The `/dev/dri` directory, when it was granted as a directory. */
  readonly directory?: string;
}

function isWithin(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function hasControlCharacterOrColon(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || value[index] === ':') return true;
  }
  return false;
}

function isPseudoFilesystemPath(candidate: string): boolean {
  return PSEUDO_FILESYSTEM_ROOTS.some((root) => isWithin(root, candidate));
}

function normalizeDevicePath(value: string): string {
  const normalized = path.posix.normalize(value);
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}

function lexicalProblem(value: string): string | undefined {
  const size = Buffer.byteLength(value, 'utf8');
  if (size < 1 || size > MAX_DEVICE_PATH_BYTES) {
    return `must be 1 to ${String(MAX_DEVICE_PATH_BYTES)} bytes`;
  }
  if (hasControlCharacterOrColon(value)) {
    return 'must not contain control characters or a colon';
  }
  if (!value.startsWith('/')) {
    return 'must be an absolute path below /dev';
  }
  if (value.split('/').includes('..')) {
    return "must not contain a '..' segment";
  }
  const normalized = normalizeDevicePath(value);
  if (normalized === DEVICE_ROOT) {
    return 'must name a device below /dev, not /dev itself';
  }
  if (!normalized.startsWith(`${DEVICE_ROOT}/`)) {
    return 'must be a path below /dev';
  }
  if (isPseudoFilesystemPath(normalized)) {
    return 'is inside a /dev pseudo-filesystem and cannot be granted';
  }
  return undefined;
}

const deviceGrantEntrySchema = z
  .string({ invalid_type_error: 'must be a string' })
  .superRefine((value, context) => {
    const problem = lexicalProblem(value);
    if (problem !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  });

const deviceGrantsSchema = z
  .array(deviceGrantEntrySchema, {
    invalid_type_error: 'must be an array of device path strings',
  })
  .max(
    MAX_DEVICE_GRANTS,
    `must list at most ${String(MAX_DEVICE_GRANTS)} devices`,
  );

export function parseSandboxDeviceGrants(raw: unknown): readonly string[] {
  if (raw === undefined) return [];
  const result = deviceGrantsSchema.safeParse(raw);
  if (result.success) return result.data.map(normalizeDevicePath);
  const issue = result.error.issues[0];
  const index = issue.path[0];
  if (typeof index === 'number') {
    const entries: readonly unknown[] = Array.isArray(raw) ? raw : [];
    const offending = String(entries[index]);
    throw new FatalSandboxError(
      `devices[${String(index)}] '${offending}' ${issue.message}.`,
    );
  }
  throw new FatalSandboxError(`devices ${issue.message}.`);
}

function errorCode(error: unknown): string {
  return error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN';
}

function describeDeviceKind(stat: DeviceEntryStat): string {
  if (stat.isBlockDevice()) return 'a block device';
  if (stat.isDirectory()) return 'a directory';
  if (stat.isSocket()) return 'a socket';
  if (stat.isFIFO()) return 'a FIFO';
  return 'a regular file or other non-device entry';
}

function canonicalDevicePath(
  host: SandboxDeviceHost,
  requested: string,
  label: string,
): string {
  let canonical: string;
  try {
    canonical = host.realpath(requested);
  } catch (error) {
    const code = errorCode(error);
    const cause =
      code === 'ENOENT' || code === 'ENOTDIR'
        ? 'does not exist on this host'
        : `cannot be resolved (${code})`;
    throw new FatalSandboxError(`${label} ${cause}.`);
  }
  if (!canonical.startsWith(`${DEVICE_ROOT}/`)) {
    throw new FatalSandboxError(
      `${label} resolves to '${canonical}', outside /dev.`,
    );
  }
  if (isPseudoFilesystemPath(canonical)) {
    throw new FatalSandboxError(
      `${label} resolves into a /dev pseudo-filesystem ('${canonical}').`,
    );
  }
  return canonical;
}

function collectDriNodes(host: SandboxDeviceHost, label: string): string[] {
  const fail = (cause: string): FatalSandboxError =>
    new FatalSandboxError(`${label} ${cause}`);
  const directoryDevice = host.lstat(DRI_DIRECTORY).dev;
  const nodes: string[] = [];
  const linkDirectories: string[] = [];
  for (const name of [...host.readdir(DRI_DIRECTORY)].sort()) {
    const entry = path.posix.join(DRI_DIRECTORY, name);
    const stat = host.lstat(entry);
    if (stat.dev !== directoryDevice) {
      throw fail(`contains a nested mount at '${entry}'.`);
    }
    if (stat.isCharacterDevice()) nodes.push(entry);
    else if (name === 'by-path' && stat.isDirectory()) {
      linkDirectories.push(entry);
    } else throw fail(`contains an unexpected entry '${entry}'.`);
  }
  for (const directory of linkDirectories) {
    for (const name of host.readdir(directory)) {
      const link = path.posix.join(directory, name);
      const stat = host.lstat(link);
      if (stat.dev !== directoryDevice) {
        throw fail(`contains a nested mount at '${link}'.`);
      }
      if (!stat.isSymbolicLink()) {
        throw fail(`contains an unexpected entry '${link}'.`);
      }
      let target: string | undefined;
      try {
        target = host.realpath(link);
      } catch {
        target = undefined;
      }
      if (target === undefined || !nodes.includes(target)) {
        throw fail(`contains a dangling or escaping link '${link}'.`);
      }
    }
  }
  if (nodes.length === 0) throw fail('contains no device nodes.');
  if (nodes.length > MAX_DEVICE_GRANTS) {
    throw fail(`contains more than ${String(MAX_DEVICE_GRANTS)} device nodes.`);
  }
  return nodes;
}

export function resolveSandboxDevices(
  grants: readonly string[],
  host: SandboxDeviceHost = hostDeviceFilesystem,
): ResolvedSandboxDevices {
  const nodes = new Set<string>();
  const directGrants = new Set<string>();
  let directory: string | undefined;
  grants.forEach((grant, index) => {
    const label = `devices[${String(index)}] '${grant}'`;
    const problem = lexicalProblem(grant);
    if (problem !== undefined) {
      throw new FatalSandboxError(`${label} ${problem}.`);
    }
    const requested = normalizeDevicePath(grant);
    const canonical = canonicalDevicePath(host, requested, label);
    const stat = host.lstat(canonical);
    if (stat.isCharacterDevice()) {
      nodes.add(canonical);
      directGrants.add(canonical);
    } else if (
      stat.isDirectory() &&
      requested === DRI_DIRECTORY &&
      canonical === DRI_DIRECTORY
    ) {
      directory = DRI_DIRECTORY;
      for (const node of collectDriNodes(host, label)) nodes.add(node);
    } else if (stat.isDirectory()) {
      throw new FatalSandboxError(
        `${label} is a directory; only the /dev/dri directory can be granted as a directory.`,
      );
    } else {
      throw new FatalSandboxError(
        `${label} is ${describeDeviceKind(stat)}, not a character device.`,
      );
    }
  });
  const kept = [...directGrants].filter(
    (node) => directory === undefined || !isWithin(directory, node),
  );
  return {
    grants: [...kept, ...(directory === undefined ? [] : [directory])].sort(),
    nodes: [...nodes].sort(),
    ...(directory === undefined ? {} : { directory }),
  };
}

function denied(node: string, action: string, error: unknown): never {
  throw new FatalSandboxError(
    `Sandbox device '${node}' ${action} (${errorCode(error)}). ` +
      'Grant the launching user access on the host, for example through a render or video group or an ACL; the sandbox does not change device permissions.',
  );
}

export function preflightSandboxDevices(
  resolved: ResolvedSandboxDevices,
  host: SandboxDeviceHost = hostDeviceFilesystem,
): void {
  const { directory } = resolved;
  if (directory !== undefined) {
    try {
      host.access(directory, fs.constants.R_OK | fs.constants.X_OK);
    } catch (error) {
      denied(
        directory,
        'is not readable and searchable by the launching user',
        error,
      );
    }
  }
  for (const node of resolved.nodes) {
    const insideDirectory =
      directory !== undefined && isWithin(directory, node);
    if (!insideDirectory) {
      try {
        host.access(node, fs.constants.R_OK | fs.constants.W_OK);
      } catch (error) {
        denied(
          node,
          'is not readable and writable by the launching user',
          error,
        );
      }
    }
    if (RENDER_NODE.test(node)) {
      try {
        host.probeOpen(node);
      } catch (error) {
        denied(
          node,
          'cannot be opened read/write by the launching user',
          error,
        );
      }
    }
  }
}

export function assertSandboxDevicesSupported(
  command: SandboxConfig['command'] | '',
  devices: readonly string[] | undefined,
  platform: NodeJS.Platform = process.platform,
): void {
  if (devices === undefined || devices.length === 0 || command === '') return;
  if (command === 'sandbox-exec') {
    throw new FatalSandboxError(
      'sandbox-exec does not support Linux devices grants; use a Linux bwrap, Docker or Podman host. Metal access uses the Seatbelt policy.',
    );
  }
  if (platform !== 'linux') {
    throw new FatalSandboxError(
      `Sandbox devices grants require a Linux host; the ${command} engine on ${platform} cannot map host /dev paths into its VM.`,
    );
  }
}

export function buildBwrapDeviceArgs(
  resolved: ResolvedSandboxDevices,
): readonly string[] {
  const args: string[] = [];
  const created = new Set<string>();
  for (const grant of resolved.grants) {
    const parents: string[] = [];
    for (
      let parent = path.posix.dirname(grant);
      parent !== DEVICE_ROOT && parent !== '/';
      parent = path.posix.dirname(parent)
    ) {
      parents.unshift(parent);
    }
    for (const parent of parents) {
      if (!created.has(parent)) {
        created.add(parent);
        args.push('--dir', parent);
      }
    }
    args.push('--dev-bind', grant, grant);
  }
  return args;
}

export function buildContainerDeviceArgs(
  resolved: ResolvedSandboxDevices,
): readonly string[] {
  return resolved.nodes.flatMap((node) => ['--device', `${node}:${node}:rw`]);
}
