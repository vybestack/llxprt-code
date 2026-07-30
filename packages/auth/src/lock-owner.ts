/**
 * @license
 * Copyright 2026 Vybestack LLC
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

export type StartTimeSource = 'canonical' | 'approximate' | 'unavailable';

export interface LockOwnerMetadata {
  readonly version: number;
  readonly ownerToken: string;
  readonly pid: number;
  readonly hostname: string;
  readonly startTimeMs: number;
  readonly startTimeSource: StartTimeSource;
}

export type OwnerLiveness =
  | { readonly status: 'dead' }
  | { readonly status: 'live' }
  | { readonly status: 'unverifiable' };

export function buildOwnerMetadata(
  startTimeMs: number,
  startTimeSource: StartTimeSource = 'approximate',
): LockOwnerMetadata {
  return {
    version: LOCK_VERSION,
    ownerToken: randomUUID(),
    pid: process.pid,
    hostname: nodeHostname(),
    startTimeMs,
    startTimeSource,
  };
}

type ProcessStartTimeReader = (
  pid: number,
  timeoutMs?: number,
) => Promise<number | null>;

type CanonicalProcessStartTime = {
  readonly startTimeMs: number;
  readonly startTimeSource: 'canonical';
};

let cachedCurrentProcessStartTime: CanonicalProcessStartTime | undefined;
let currentProcessStartTimeLookup:
  | {
      readonly reader: ProcessStartTimeReader;
      readonly promise: Promise<number | null>;
    }
  | undefined;

export async function buildCurrentProcessOwnerMetadata(
  timeoutMs: number = PROCESS_PROBE_TIMEOUT_MS,
  readStartTime: ProcessStartTimeReader = readProcessStartTimeMs,
): Promise<LockOwnerMetadata> {
  const cached = cachedCurrentProcessStartTime;
  if (cached !== undefined) {
    return buildOwnerMetadata(cached.startTimeMs, cached.startTimeSource);
  }

  const activeLookup = currentProcessStartTimeLookup;
  const lookup =
    activeLookup?.reader === readStartTime
      ? activeLookup.promise
      : readStartTime(process.pid, timeoutMs);
  const lookupEntry = { reader: readStartTime, promise: lookup };
  currentProcessStartTimeLookup = lookupEntry;
  let value: number | null;
  try {
    value = await lookup;
  } finally {
    if (currentProcessStartTimeLookup === lookupEntry) {
      currentProcessStartTimeLookup = undefined;
    }
  }

  if (value === null) {
    return buildOwnerMetadata(getProcessStartTimeMs(), 'approximate');
  }

  const canonical: CanonicalProcessStartTime = {
    startTimeMs: value,
    startTimeSource: 'canonical',
  };
  cachedCurrentProcessStartTime = canonical;
  return buildOwnerMetadata(canonical.startTimeMs, canonical.startTimeSource);
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
  const startTimeSource = isValidStartTimeSource(parsed.startTimeSource)
    ? parsed.startTimeSource
    : 'approximate';
  return {
    version: parsed.version,
    ownerToken: parsed.ownerToken,
    pid: parsed.pid,
    hostname: parsed.hostname,
    startTimeMs: parsed.startTimeMs,
    startTimeSource,
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

function isValidStartTimeSource(value: unknown): value is StartTimeSource {
  return (
    value === 'canonical' || value === 'approximate' || value === 'unavailable'
  );
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

  if (owner.startTimeSource !== 'canonical') {
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
      {
        timeout: Math.max(1, timeoutMs),
        killSignal: 'SIGKILL',
        env: { ...process.env, LC_ALL: 'C' },
      },
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
  currentProcessStartTimeLookup = undefined;
}

export interface LegacyLockRecord {
  readonly pid: number;
  readonly ownerToken: string;
}

export function parseLegacyLockRecord(raw: string): LegacyLockRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }
  if (
    typeof parsed.pid !== 'number' ||
    !Number.isSafeInteger(parsed.pid) ||
    parsed.pid <= 0
  ) {
    return null;
  }
  if (typeof parsed.token !== 'string' || parsed.token === '') {
    return null;
  }
  return { pid: parsed.pid, ownerToken: parsed.token };
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
