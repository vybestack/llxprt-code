/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Evidence gathering for a per-file timeout in the agents runner.
 *
 * On Windows, a `bun test` child can finish its assertions and still never
 * produce `close`: `close` waits for every process that inherited the child's
 * stdio handles, so one surviving descendant holds the file open until the
 * wall-clock budget expires. The runner kills the tree and retries, which
 * leaves no trace of who held the handle. This module records that: whether the
 * child's own `exit` was observed, which descendants were still alive when the
 * budget expired (PID, parent and command line), and what `taskkill` said.
 *
 * It only reports. The verdict for a timed-out file stays a failure.
 */

import { spawnSync } from 'node:child_process';

export interface ProcessRecord {
  readonly pid: number;
  readonly parentPid: number;
  readonly name: string;
  readonly commandLine: string | null;
}

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
) => CommandResult;

export interface ChildExitObservation {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

const PROCESS_QUERY_SCRIPT =
  'Get-CimInstance Win32_Process | ' +
  'Select-Object ProcessId,ParentProcessId,Name,CommandLine | ' +
  'ConvertTo-Json -Compress';

const COMMAND_TIMEOUT_MS = 15_000;

/** Default command runner; the only place this module touches the OS. */
export const runCommandSync: RunCommand = (command, args) => {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
};

function toRecord(entry: unknown): ProcessRecord {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`Unexpected process table entry: ${String(entry)}`);
  }
  const row = entry as Record<string, unknown>;
  const { ProcessId, ParentProcessId, Name, CommandLine } = row;
  if (typeof ProcessId !== 'number' || typeof ParentProcessId !== 'number') {
    throw new Error(
      `Process table entry lacks numeric ids: ${JSON.stringify(entry)}`,
    );
  }
  return {
    pid: ProcessId,
    parentPid: ParentProcessId,
    name: typeof Name === 'string' ? Name : '',
    commandLine: typeof CommandLine === 'string' ? CommandLine : null,
  };
}

/**
 * Parses `ConvertTo-Json` output of the process query. PowerShell emits a bare
 * object, not a one-element array, when the table has a single row.
 */
export function parseProcessTable(json: string): ProcessRecord[] {
  const parsed: unknown = JSON.parse(json);
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map(toRecord);
}

/**
 * Every process reachable from `rootPid` through parent links, excluding the
 * root itself. Windows does not re-parent orphans, so descendants of an
 * already-exited root are still found through their recorded parent PID.
 */
export function findDescendants(
  rootPid: number,
  table: readonly ProcessRecord[],
): ProcessRecord[] {
  const found: ProcessRecord[] = [];
  const seen = new Set<number>([rootPid]);
  let frontier = [rootPid];
  while (frontier.length > 0) {
    const parents = new Set(frontier);
    const next = table.filter(
      (record) => parents.has(record.parentPid) && !seen.has(record.pid),
    );
    for (const record of next) seen.add(record.pid);
    found.push(...next);
    frontier = next.map((record) => record.pid);
  }
  return found;
}

function describeProcess(record: ProcessRecord): string {
  const command = record.commandLine ?? '(command line unavailable)';
  return `  pid=${record.pid} ppid=${record.parentPid} name=${record.name} cmd=${command}`;
}

function describeExit(exit: ChildExitObservation | null): string {
  if (exit === null) return 'child exit event NOT observed';
  return `child exit event observed (code=${exit.code}, signal=${exit.signal})`;
}

function describeDescendants(
  runCommand: RunCommand,
  rootPid: number,
): string[] {
  const query = runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    PROCESS_QUERY_SCRIPT,
  ]);
  if (query.error !== undefined || query.status !== 0) {
    const reason = query.error?.message ?? query.stderr.trim();
    return [`  process query failed (status ${query.status}): ${reason}`];
  }
  let descendants: ProcessRecord[];
  try {
    descendants = findDescendants(rootPid, parseProcessTable(query.stdout));
  } catch (error) {
    return [`  process table unreadable: ${String(error)}`];
  }
  if (descendants.length === 0) return ['  no descendant processes alive'];
  return descendants.map(describeProcess);
}

export interface TimeoutDiagnosticsInput {
  readonly file: string;
  readonly rootPid: number;
  readonly exit: ChildExitObservation | null;
  readonly runCommand?: RunCommand;
}

/**
 * Text describing the child and its live descendants at the moment the budget
 * expired. Call it before the tree is killed.
 */
export function describeTimedOutChild(input: TimeoutDiagnosticsInput): string {
  const run = input.runCommand ?? runCommandSync;
  return [
    `TIMEOUT DIAGNOSTICS for ${input.file} (root pid ${input.rootPid}): ${describeExit(input.exit)}`,
    'descendants still alive:',
    ...describeDescendants(run, input.rootPid),
  ].join('\n');
}

/**
 * Text describing a `taskkill` run against the timed-out tree, including its
 * stderr, which the shared kill helper discards. Call it after the kill so the
 * output shows whether the tree was already gone or the kill was refused.
 */
export function describeTaskkillProbe(
  rootPid: number,
  runCommand: RunCommand = runCommandSync,
): string {
  const result = runCommand('taskkill', ['/PID', String(rootPid), '/T', '/F']);
  const detail = result.error?.message ?? result.stderr.trim();
  return [
    `post-kill taskkill /PID ${rootPid} /T /F: status ${result.status}`,
    `  stderr: ${detail.length > 0 ? detail : '(empty)'}`,
    `  stdout: ${result.stdout.trim() || '(empty)'}`,
    'descendants still alive after kill:',
    ...describeDescendants(runCommand, rootPid),
  ].join('\n');
}
