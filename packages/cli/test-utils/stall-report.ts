/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Child-side half of the CLI runner's stall diagnostics.
 *
 * A test file occasionally finishes every assertion and then keeps its Bun
 * process alive until the runner's per-file guard kills it. Once that happens
 * the owner of the surviving resource can only be named from inside the
 * stalled process, and Windows has no signal the runner could use to ask for
 * it. The runner therefore creates a request file and this module, which polls
 * for that file on an unref'd timer, answers by writing a report of what the
 * process still holds.
 *
 * The timer is unref'd so it never keeps a healthy process alive, and it uses
 * the timer function captured at import time so a test that installs fake
 * timers cannot starve it.
 */

import {
  appendFileSync,
  existsSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  STALL_DIR_ENV,
  STALL_REPORT_FILE,
  STALL_REQUEST_FILE,
  STALL_STAGES_FILE,
} from '../runner-stall-protocol.js';

const POLL_INTERVAL_MS = 500;
const SIGNAL_EVENTS = [
  'exit',
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGBREAK',
] as const;

interface IntrospectableProcess {
  _getActiveHandles?: () => unknown[];
  getActiveResourcesInfo?: () => string[];
}

type HandleDetails = Record<string, unknown>;

const HANDLE_FIELDS = [
  'fd',
  'pid',
  'isTTY',
  'isRaw',
  'readableFlowing',
  'destroyed',
  'listening',
  'remoteAddress',
  '_idleTimeout',
] as const;

/**
 * One line per active handle: its class plus whichever primitive fields it
 * exposes. Fields are copied individually so a handle is never serialised
 * whole (a socket or child process would pull in half the heap).
 */
export function describeHandle(handle: unknown): string {
  if (handle === null || typeof handle !== 'object') {
    return String(handle);
  }
  const record = handle as HandleDetails;
  const name = (handle as object).constructor?.name ?? 'Object';
  const details = HANDLE_FIELDS.flatMap((field) => {
    const value = record[field];
    const primitive =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean';
    return primitive ? [`${field}=${String(value)}`] : [];
  });
  return details.length > 0 ? `${name} ${details.join(' ')}` : name;
}

function describeListeners(): string[] {
  const names = new Set<string | symbol>([
    ...SIGNAL_EVENTS,
    ...process.eventNames(),
  ]);
  return Array.from(names).flatMap((name) => {
    const count = process.listenerCount(name);
    return count > 0 ? [`${String(name)}=${count}`] : [];
  });
}

/**
 * Reads the real process.stdin. Called only while building a report: merely
 * touching the getter can create the stream, which is exactly the kind of
 * resource being hunted, so a healthy run must never evaluate it.
 */
function describeStdin(): string {
  const stdin = process.stdin as NodeJS.ReadStream & {
    isRaw?: boolean;
    readableFlowing?: boolean | null;
  };
  return [
    `isTTY=${String(stdin.isTTY)}`,
    `isRaw=${String(stdin.isRaw)}`,
    `readableFlowing=${String(stdin.readableFlowing)}`,
    `destroyed=${String(stdin.destroyed)}`,
    `dataListeners=${stdin.listenerCount('data')}`,
    `readableListeners=${stdin.listenerCount('readable')}`,
  ].join(' ');
}

/** Snapshot of what this process still holds, formatted for a CI log. */
export function buildStallReport(): string {
  const introspect = process as unknown as IntrospectableProcess;
  const handles = introspect._getActiveHandles?.() ?? [];
  const resources = introspect.getActiveResourcesInfo?.() ?? [];
  return [
    `pid=${process.pid} platform=${process.platform} uptime=${process.uptime().toFixed(1)}s`,
    `active handles (${handles.length}): ${
      handles.length > 0 ? handles.map(describeHandle).join('; ') : 'none'
    }`,
    `active resources (${resources.length}): ${
      resources.length > 0 ? resources.join(', ') : 'none'
    }`,
    `process listeners: ${describeListeners().join(' ') || 'none'}`,
    `process.stdin: ${describeStdin()}`,
  ].join('\n');
}

/**
 * Writes the report beside its destination and renames it into place, so the
 * runner never reads a half-written file.
 */
export function writeStallReport(reportPath: string): void {
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, buildStallReport());
    renameSync(temporaryPath, reportPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

// Captured now: fake-timer installs replace the globals later.
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

let stallDirectory: string | undefined;

/** Records that the process reached a lifecycle point. No-op outside the runner. */
export function markStallStage(stage: string): void {
  if (stallDirectory === undefined) return;
  appendFileSync(
    join(stallDirectory, STALL_STAGES_FILE),
    `${process.uptime().toFixed(2)}s ${stage}\n`,
  );
}

/**
 * Starts answering the runner's report request and recording lifecycle
 * stages. Does nothing when the process was not started by the runner. The
 * variable is removed from the environment afterwards so processes the tests
 * spawn do not inherit it.
 */
export function installStallReporter(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const directory = env[STALL_DIR_ENV];
  delete env[STALL_DIR_ENV];
  if (!directory) return;
  stallDirectory = directory;
  markStallStage('preload-installed');
  // First in line, so it is recorded even if a later exit listener blocks.
  process.prependListener('exit', () => markStallStage('process-exit-event'));

  const requestPath = join(directory, STALL_REQUEST_FILE);
  const reportPath = join(directory, STALL_REPORT_FILE);
  const timer = realSetInterval(() => {
    if (!existsSync(requestPath)) return;
    realClearInterval(timer);
    writeStallReport(reportPath);
  }, POLL_INTERVAL_MS);
  timer.unref();
}
