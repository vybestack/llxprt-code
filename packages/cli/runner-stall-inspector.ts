/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runner-side half of the CLI stall diagnostics.
 *
 * When a test file's attempt times out after Bun reported that its tests
 * finished, the process is alive for a reason nothing has named yet. Before the
 * runner kills it, this asks the process to report its own handles (see
 * test-utils/stall-report.ts) and lists the processes still running beneath
 * it, so the next occurrence identifies its owner instead of leaving a bare
 * timeout.
 */

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STALL_DIR_ENV,
  STALL_REPORT_FILE,
  STALL_REQUEST_FILE,
  STALL_STAGES_FILE,
} from './runner-stall-protocol.js';

const REPORT_WAIT_MS = 5_000;
const REPORT_POLL_MS = 100;
const PROCESS_QUERY_TIMEOUT_MS = 15_000;

/** Per-attempt files through which the runner and its child talk. */
export interface StallProbe {
  /** Environment entries the child needs to answer a request. */
  readonly env: Readonly<Record<string, string>>;
  readonly requestPath: string;
  readonly reportPath: string;
  readonly stagesPath: string;
  dispose(): void;
}

export function createStallProbe(): StallProbe {
  const directory = mkdtempSync(join(tmpdir(), 'llxprt-cli-stall-'));
  return {
    env: { [STALL_DIR_ENV]: directory },
    requestPath: join(directory, STALL_REQUEST_FILE),
    reportPath: join(directory, STALL_REPORT_FILE),
    stagesPath: join(directory, STALL_STAGES_FILE),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
  readonly commandLine: string;
}

/** Rows of `ps -A -o pid=,ppid=,comm=,command=`. */
export function parsePsTable(table: string): ProcessRow[] {
  return table.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            name: match[3],
            commandLine: match[4],
          },
        ]
      : [];
  });
}

/** Rows of tab-separated `pid ppid name commandLine`, as the CIM query emits. */
export function parseTabSeparatedTable(table: string): ProcessRow[] {
  return table.split(/\r?\n/).flatMap((line) => {
    const [pid, ppid, name, ...commandLine] = line.split('\t');
    const parsedPid = Number(pid);
    const parsedPpid = Number(ppid);
    return Number.isInteger(parsedPid) &&
      pid.trim() !== '' &&
      Number.isInteger(parsedPpid) &&
      ppid.trim() !== ''
      ? [
          {
            pid: parsedPid,
            ppid: parsedPpid,
            name: name ?? '',
            commandLine: commandLine.join('\t').trim(),
          },
        ]
      : [];
  });
}

/** Every process below `rootPid`, in breadth-first order. */
export function selectDescendants(
  rows: readonly ProcessRow[],
  rootPid: number,
): ProcessRow[] {
  const found: ProcessRow[] = [];
  const seen = new Set<number>([rootPid]);
  let frontier = [rootPid];
  while (frontier.length > 0) {
    const parents = new Set(frontier);
    const children = rows.filter(
      (row) => parents.has(row.ppid) && !seen.has(row.pid),
    );
    for (const child of children) seen.add(child.pid);
    found.push(...children);
    frontier = children.map((child) => child.pid);
  }
  return found;
}

const WINDOWS_PROCESS_QUERY =
  'Get-CimInstance Win32_Process | ForEach-Object { ' +
  '"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.CommandLine)" }';

function runQuery(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: PROCESS_QUERY_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

async function queryProcessTable(): Promise<ProcessRow[]> {
  if (process.platform === 'win32') {
    const table = await runQuery('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_PROCESS_QUERY,
    ]);
    return parseTabSeparatedTable(table);
  }
  const table = await runQuery('ps', ['-A', '-o', 'pid=,ppid=,comm=,command=']);
  return parsePsTable(table);
}

async function describeDescendants(rootPid: number): Promise<string> {
  try {
    const descendants = selectDescendants(await queryProcessTable(), rootPid);
    if (descendants.length === 0) return 'none';
    return descendants
      .map((row) =>
        `  pid=${row.pid} ppid=${row.ppid} ${row.name} ${row.commandLine}`.trimEnd(),
      )
      .join('\n');
  } catch (error) {
    return `process query failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

async function waitForReport(probe: StallProbe): Promise<string> {
  const deadline = Date.now() + REPORT_WAIT_MS;
  while (Date.now() < deadline) {
    if (existsSync(probe.reportPath)) {
      return readFileSync(probe.reportPath, 'utf8');
    }
    await new Promise((resolve) => setTimeout(resolve, REPORT_POLL_MS));
  }
  return (
    `no report within ${REPORT_WAIT_MS}ms: the process did not service its ` +
    'event loop (blocked synchronously, or the preload never loaded)'
  );
}

/**
 * Asks the stalled process what it still holds and lists its descendants.
 * The child's answer and the process query run together so the wait is the
 * longer of the two, not their sum.
 */
export async function collectStallDiagnostics(
  probe: StallProbe,
  childPid: number,
  file: string,
): Promise<string> {
  writeFileSync(probe.requestPath, '');
  const [report, descendants] = await Promise.all([
    waitForReport(probe),
    describeDescendants(childPid),
  ]);
  const stages = existsSync(probe.stagesPath)
    ? readFileSync(probe.stagesPath, 'utf8').trimEnd()
    : 'none recorded (the preload never started)';
  return [
    `STALL DIAGNOSTICS ${file} (child pid ${childPid})`,
    'child lifecycle stages:',
    stages,
    'child report:',
    report,
    'descendant processes:',
    descendants,
  ].join('\n');
}
