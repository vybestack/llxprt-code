/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';

export const SANDBOX_MANAGED_LABEL = 'com.vybestack.llxprt.sandbox-managed';
export const SANDBOX_MANAGED_LABEL_SPEC = `${SANDBOX_MANAGED_LABEL}=true`;
export const SANDBOX_OWNER_LABEL = 'com.vybestack.llxprt.sandbox-owner';

/** Versioned process-instance identity stored on managed engine resources. */
export interface SandboxOwnerMetadata {
  readonly version: 1;
  readonly hostname: string;
  readonly pid: number;
  readonly startTimeMs: number;
  readonly startTimeSource: 'observed' | 'estimated';
}

const PS_WEEKDAYS: readonly string[] = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
];
const PS_MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const PS_LSTART_PATTERN =
  /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) (\d{4})$/;

function parseProcessStartTime(output: string): number | undefined {
  const match = PS_LSTART_PATTERN.exec(output);
  if (match === null) return undefined;
  const [
    ,
    weekday,
    month,
    dayText,
    hourText,
    minuteText,
    secondText,
    yearText,
  ] = match;
  const monthIndex = PS_MONTHS.indexOf(month);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const year = Number(yearText);
  const startTimeMs = Date.UTC(year, monthIndex, day, hour, minute, second);
  const parsed = new Date(startTimeMs);
  if (parsed.getUTCFullYear() !== year) return undefined;
  if (parsed.getUTCMonth() !== monthIndex) return undefined;
  if (parsed.getUTCDate() !== day) return undefined;
  if (PS_WEEKDAYS[parsed.getUTCDay()] !== weekday) return undefined;
  return startTimeMs;
}

function observeCurrentProcessStartTime(): number | undefined {
  try {
    const output = execFileSync(
      'ps',
      ['-o', 'lstart=', '-p', String(process.pid)],
      {
        encoding: 'utf8',
        timeout: 250,
        env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
      },
    ).trim();
    return parseProcessStartTime(output);
  } catch {
    return undefined;
  }
}

function buildCurrentSandboxOwner(): SandboxOwnerMetadata {
  const observedStartTimeMs = observeCurrentProcessStartTime();
  return observedStartTimeMs === undefined
    ? {
        version: 1,
        hostname: os.hostname(),
        pid: process.pid,
        startTimeMs: Date.now() - process.uptime() * 1000,
        startTimeSource: 'estimated',
      }
    : {
        version: 1,
        hostname: os.hostname(),
        pid: process.pid,
        startTimeMs: observedStartTimeMs,
        startTimeSource: 'observed',
      };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSandboxOwnerMetadata(value: unknown): value is SandboxOwnerMetadata {
  if (!isUnknownRecord(value) || value.version !== 1) return false;
  if (typeof value.hostname !== 'string' || value.hostname.length === 0) {
    return false;
  }
  if (
    typeof value.pid !== 'number' ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0
  ) {
    return false;
  }
  if (
    typeof value.startTimeMs !== 'number' ||
    !Number.isFinite(value.startTimeMs) ||
    value.startTimeMs <= 0
  ) {
    return false;
  }
  return (
    value.startTimeSource === 'observed' ||
    value.startTimeSource === 'estimated'
  );
}

/** Parses a supported owner label, retaining unknown versions fail-closed. */
export function parseSandboxOwner(
  payload: string,
): SandboxOwnerMetadata | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isSandboxOwnerMetadata(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readProcessStartTime(pid: number): number | undefined {
  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 250,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
    }).trim();
    return parseProcessStartTime(output);
  } catch {
    return undefined;
  }
}

function processIsMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ESRCH'
  );
}

/** Returns true only when this host can prove the recorded process instance ended. */
export function sandboxOwnerIsDead(owner: SandboxOwnerMetadata): boolean {
  try {
    if (owner.hostname !== os.hostname()) return false;
  } catch {
    return false;
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return processIsMissing(error);
  }
  if (owner.startTimeSource !== 'observed') return false;
  const currentStartTimeMs = readProcessStartTime(owner.pid);
  return (
    currentStartTimeMs !== undefined &&
    Math.abs(currentStartTimeMs - owner.startTimeMs) > 2_000
  );
}

/** Adds process-instance ownership labels to a main sandbox container. */
export function addSandboxOwnershipLabels(args: string[]): void {
  const owner = JSON.stringify(buildCurrentSandboxOwner());
  args.push(
    '--label',
    SANDBOX_MANAGED_LABEL_SPEC,
    '--label',
    `${SANDBOX_OWNER_LABEL}=${owner}`,
  );
}
