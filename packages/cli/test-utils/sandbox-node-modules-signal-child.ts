/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Static child fixture for the #3450 signal-termination lifecycle test
 * (sandbox-node-modules-lifecycle.test.ts).
 *
 * The file is checked in and executed as-is by the test through
 * `bun <this path> <signal>`; the test never constructs or writes source
 * code. All per-run inputs are data: the signal arrives as argv and the
 * workspace / readiness-marker paths arrive through the environment
 * variables named below, each validated strictly before use.
 *
 * Behavior under proof (identical to what the lifecycle test asserts):
 *   - the production addPrivateDependencyMounts runs against the fake
 *     engine the parent installed on PATH and in FAKE_ENGINE_STATE
 *   - the engine must hold exactly two dependency volumes afterwards
 *   - the readiness marker is flushed before the self-signal, so the
 *     parent can distinguish "never got ready" from "died by the signal"
 *   - the child signals itself and must terminate from that signal; the
 *     trailing timer only runs when a cleanup handler wrongly swallowed
 *     the signal instead of restoring the default termination
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addPrivateDependencyMounts } from '../src/utils/sandbox-node-modules.js';

/** Absolute path of this module; the test spawns it directly. */
export const SANDBOX_SIGNAL_CHILD_PATH = fileURLToPath(import.meta.url);

export const SANDBOX_SIGNAL_CHILD_WORKDIR_ENV = 'SANDBOX_SIGNAL_CHILD_WORKDIR';
export const SANDBOX_SIGNAL_CHILD_READY_MARKER_ENV =
  'SANDBOX_SIGNAL_CHILD_READY_MARKER';

const ALLOWED_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
type AllowedSignal = (typeof ALLOWED_SIGNALS)[number];

/** Trusted fixture paths are short, absolute, and printable or rejected. */
const MAX_PATH_INPUT_LENGTH = 4096;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function failFast(message: string): never {
  process.stderr.write(`sandbox signal child: ${message}\n`);
  process.exit(2);
}

function isAllowedSignal(value: string): value is AllowedSignal {
  return (ALLOWED_SIGNALS as readonly string[]).includes(value);
}

function readPathInput(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    failFast(`${name} is not set`);
  }
  if (value.length > MAX_PATH_INPUT_LENGTH) {
    failFast(`${name} exceeds ${MAX_PATH_INPUT_LENGTH} characters`);
  }
  if (!path.isAbsolute(value)) {
    failFast(`${name} must be an absolute path`);
  }
  if (hasControlCharacter(value)) {
    failFast(`${name} contains control characters`);
  }
  return value;
}

function assertExistingDirectory(label: string, directory: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(directory);
  } catch {
    failFast(`${label} '${directory}' does not exist`);
  }
  if (!stat.isDirectory()) {
    failFast(`${label} '${directory}' is not a directory`);
  }
}

function main(): void {
  const requested: string | undefined = process.argv[2];
  if (
    process.argv.length !== 3 ||
    requested === undefined ||
    !isAllowedSignal(requested)
  ) {
    failFast(
      `expected exactly one argument, SIGINT or SIGTERM, got ${JSON.stringify(process.argv.slice(2))}`,
    );
  }
  const signal: AllowedSignal = requested;
  const workdir = readPathInput(
    SANDBOX_SIGNAL_CHILD_WORKDIR_ENV,
    process.env[SANDBOX_SIGNAL_CHILD_WORKDIR_ENV],
  );
  const readyMarker = readPathInput(
    SANDBOX_SIGNAL_CHILD_READY_MARKER_ENV,
    process.env[SANDBOX_SIGNAL_CHILD_READY_MARKER_ENV],
  );
  assertExistingDirectory('workdir', workdir);
  assertExistingDirectory('ready marker directory', path.dirname(readyMarker));

  const args: string[] = [];
  addPrivateDependencyMounts(
    { command: 'docker', image: 'test' },
    args,
    workdir,
  );
  const listed = spawnSync(
    'docker',
    ['volume', 'ls', '--format', '{{.Name}}'],
    { encoding: 'utf8', env: process.env },
  );
  const volumes = listed.stdout.trim().split('\n').filter(Boolean);
  if (listed.status !== 0 || volumes.length !== 2) {
    failFast(`expected two dependency volumes, found ${volumes.length}`);
  }
  fs.writeFileSync(readyMarker, 'PRIVATE-STORAGE-READY:1\n', { flush: true });
  process.kill(process.pid, signal);
  // Only reachable when the cleanup handler wrongly swallows the signal
  // instead of restoring the default termination.
  setTimeout(() => {
    process.stdout.write('CONTINUED-AFTER-SIGNAL\n');
    process.exit(4);
  }, 1500);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  fs.realpathSync(invokedPath) === fs.realpathSync(SANDBOX_SIGNAL_CHILD_PATH)
) {
  main();
}
