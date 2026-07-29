/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hostname as nodeHostname } from 'node:os';
import { promisify } from 'node:util';

export const LOCK_VERSION = 1;
const PROCESS_START_TOLERANCE_MS = 2_000;
const PROCESS_PROBE_TIMEOUT_MS = 250;
const execFileAsync = promisify(execFile);

export interface LockOwnerMetadata {
  readonly version: number;
  readonly ownerToken: string;
  readonly pid: number;
  readonly hostname: string;
  readonly startTimeMs: number;
}

export type OwnerLiveness =
  | { readonly status: 'dead' }
  | { readonly status: 'live' }
  | { readonly status: 'unverifiable' };

export function buildOwnerMetadata(startTimeMs: number): LockOwnerMetadata {
  return {
    version: LOCK_VERSION,
    ownerToken: randomUUID(),
    pid: process.pid,
    hostname: nodeHostname(),
    startTimeMs,
  };
}

let cachedCurrentProcessStartTime: Promise<number> | undefined;

export async function buildCurrentProcessOwnerMetadata(
  timeoutMs: number = PROCESS_PROBE_TIMEOUT_MS,
): Promise<LockOwnerMetadata> {
  if (cachedCurrentProcessStartTime === undefined) {
    const lookup = readProcessStartTimeMs(process.pid, timeoutMs).then(
      (value) => value ?? getProcessStartTimeMs(),
    );
    cachedCurrentProcessStartTime = lookup;
    lookup.then(undefined, () => {
      if (cachedCurrentProcessStartTime === lookup) {
        cachedCurrentProcessStartTime = undefined;
      }
    });
  }
  return buildOwnerMetadata(await cachedCurrentProcessStartTime);
}

export function serializeOwnerMetadata(owner: LockOwnerMetadata): string {
  return JSON.stringify(owner);
}

export function parseOwnerMetadata(raw: string): LockOwnerMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }
  if (!hasValidOwnerIdentity(parsed) || !hasValidProcessIdentity(parsed)) {
    return null;
  }
  return {
    version: parsed.version,
    ownerToken: parsed.ownerToken,
    pid: parsed.pid,
    hostname: parsed.hostname,
    startTimeMs: parsed.startTimeMs,
  };
}

function hasValidOwnerIdentity(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  version: number;
  ownerToken: string;
  hostname: string;
} {
  const versionIsCurrent = value.version === LOCK_VERSION;
  const tokenIsValid =
    typeof value.ownerToken === 'string' && value.ownerToken !== '';
  const hostnameIsValid =
    typeof value.hostname === 'string' && value.hostname !== '';
  return versionIsCurrent && tokenIsValid && hostnameIsValid;
}

function hasValidProcessIdentity(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { pid: number; startTimeMs: number } {
  const pidIsValid =
    typeof value.pid === 'number' &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0;
  const startTimeIsValid =
    typeof value.startTimeMs === 'number' && Number.isFinite(value.startTimeMs);
  return pidIsValid && startTimeIsValid;
}

export async function probeOwnerLiveness(
  owner: LockOwnerMetadata | null,
  options: {
    currentHostname?: string;
    currentPid?: number;
    currentStartTimeMs?: number;
    kill?: (pid: number, signal: 0) => void;
    getProcessStartTimeMs?: (pid: number) => Promise<number | null>;
    probeTimeoutMs?: number;
  } = {},
): Promise<OwnerLiveness> {
  if (owner === null) {
    return { status: 'unverifiable' };
  }

  if (owner.hostname !== (options.currentHostname ?? nodeHostname())) {
    return { status: 'unverifiable' };
  }

  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  try {
    kill(owner.pid, 0);
  } catch (error) {
    const code = errnoCodeOf(error);
    if (code === 'ESRCH') {
      return { status: 'dead' };
    }
    return { status: 'unverifiable' };
  }

  const currentPid = options.currentPid ?? process.pid;
  const processStartLookup =
    options.getProcessStartTimeMs ?? readProcessStartTimeMs;
  const observedStartTime =
    owner.pid === currentPid && options.currentStartTimeMs !== undefined
      ? options.currentStartTimeMs
      : await boundedProcessStartProbe(
          processStartLookup(owner.pid),
          options.probeTimeoutMs ?? PROCESS_PROBE_TIMEOUT_MS,
        );

  if (observedStartTime === null) {
    return { status: 'unverifiable' };
  }

  return Math.abs(owner.startTimeMs - observedStartTime) >
    PROCESS_START_TOLERANCE_MS
    ? { status: 'dead' }
    : { status: 'live' };
}

let cachedProcessStartTimeMs: number | undefined;

export function getProcessStartTimeMs(): number {
  cachedProcessStartTimeMs ??= Date.now() - process.uptime() * 1000;
  return cachedProcessStartTimeMs;
}

function boundedProcessStartProbe(
  probe: Promise<number | null>,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), Math.max(0, timeoutMs));
    probe
      .then(resolve, () => resolve(null))
      .finally(() => clearTimeout(timeout));
  });
}

export async function readProcessStartTimeMs(
  pid: number,
  timeoutMs: number = PROCESS_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  if (!['darwin', 'linux', 'freebsd'].includes(process.platform)) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      { timeout: Math.max(1, timeoutMs), killSignal: 'SIGKILL' },
    );
    const value = Date.parse(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function _resetProcessStartTimeForTests(): void {
  cachedProcessStartTimeMs = undefined;
  cachedCurrentProcessStartTime = undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errnoCodeOf(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}
