/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';

const SANDBOX_MANAGED_LABEL = 'com.vybestack.llxprt.sandbox-managed=true';
const SANDBOX_OWNER_LABEL = 'com.vybestack.llxprt.sandbox-owner';

interface CurrentSandboxOwner {
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

function buildCurrentSandboxOwner(): CurrentSandboxOwner {
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

/** Adds process-instance ownership labels to a main sandbox container. */
export function addSandboxOwnershipLabels(args: string[]): void {
  const owner = JSON.stringify(buildCurrentSandboxOwner());
  args.push(
    '--label',
    SANDBOX_MANAGED_LABEL,
    '--label',
    `${SANDBOX_OWNER_LABEL}=${owner}`,
  );
}
