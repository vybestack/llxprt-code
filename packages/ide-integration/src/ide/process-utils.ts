/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { debugLogger } from '@vybestack/llxprt-code-telemetry/utils/debugLogger.js';
import { IDE_EXECUTABLE_NAMES } from './constants.js';

const execAsync = promisify(exec);

const MAX_TRAVERSAL_DEPTH = 32;

/** Lowercased IDE executable basenames for case-insensitive matching. */
const IDE_EXECUTABLE_BASENAMES: ReadonlySet<string> = new Set(
  IDE_EXECUTABLE_NAMES.map((name) => name.toLowerCase()),
);

/**
 * Splits a Windows process command line into argv-style tokens, respecting
 * double-quoted segments. A leading quoted path like
 * `"C:\Program Files\VS Code\Code.exe" --reuse-window` is split so that the
 * first token is `C:\Program Files\VS Code\Code.exe` (without the quotes),
 * not the broken `"C:\Program` that a naive whitespace split would yield.
 */
function tokenizeCommand(command: string): readonly string[] {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of trimmed) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (/\s/.test(char) && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Returns true when a process's name or command identifies it as a supported
 * IDE. Matching is case-insensitive and basename-based so that fully-qualified
 * Windows paths (e.g. `C:\...\Code.exe`) still match `code.exe`.
 *
 * VS Code (and forks) spawn child/utility processes that share the IDE
 * executable name but carry a `--type=` flag (e.g. `--type=utility`,
 * `--type=extensionHost`). Only the main window process — which never has
 * `--type=` as a distinct argv token — owns the companion server / port file,
 * so child processes are excluded to avoid selecting a PID whose port file
 * does not exist (the issue #2656 regression).
 */
function isIdeProcess(processInfo: ProcessInfo): boolean {
  // Use path.win32.basename because this function only ever inspects Windows
  // process data (it is called exclusively from getIdeProcessInfoForWindows).
  // On a POSIX host (e.g. Linux CI), path.basename does not treat `` as a
  // separator, so a Windows path like `C:\Program Files\Code.exe` would not
  // reduce to `Code.exe` and matching would silently fail.
  const nameBase = path.win32.basename(processInfo.name).toLowerCase();
  const matchesByName =
    Boolean(nameBase) && IDE_EXECUTABLE_BASENAMES.has(nameBase);
  const tokens = tokenizeCommand(processInfo.command);
  const commandFirstToken = tokens[0] ?? '';
  const commandBase = path.win32.basename(commandFirstToken).toLowerCase();
  const matchesByCommand =
    Boolean(commandBase) && IDE_EXECUTABLE_BASENAMES.has(commandBase);
  if (!matchesByName && !matchesByCommand) {
    return false;
  }
  // Exclude VS Code fork child/utility processes; the main window has no
  // --type= token. Matching as a distinct argv token avoids wrongly rejecting
  // a main process whose path or an unrelated arg contains `--type=` as a
  // substring (e.g. `Code.exe C:\work\project--type=demo`).
  return !tokens.some((token) => token.startsWith('--type='));
}

interface ProcessInfo {
  pid: number;
  parentPid: number;
  name: string;
  command: string;
}

interface RawProcessInfo {
  ProcessId?: number;
  ParentProcessId?: number;
  Name?: string;
  CommandLine?: string;
}

/**
 * Fetches the entire process table on Windows.
 */
async function getProcessTableWindows(): Promise<Map<number, ProcessInfo>> {
  const processMap = new Map<number, ProcessInfo>();
  try {
    // Fetch ProcessId, ParentProcessId, Name, and CommandLine for all processes.
    const powershellCommand =
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress';
    // Increase maxBuffer to handle large process lists (default is 1MB)
    const { stdout } = await execAsync(`powershell "${powershellCommand}"`, {
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout.trim()) {
      return processMap;
    }

    let processes: RawProcessInfo | RawProcessInfo[];
    try {
      processes = JSON.parse(stdout);
    } catch {
      // JSON parse failed; return empty map.
      return processMap;
    }

    if (!Array.isArray(processes)) {
      processes = [processes];
    }

    for (const p of processes) {
      if (typeof p.ProcessId === 'number') {
        processMap.set(p.ProcessId, {
          pid: p.ProcessId,
          parentPid:
            p.ParentProcessId !== undefined &&
            p.ParentProcessId !== 0 &&
            !Number.isNaN(p.ParentProcessId)
              ? p.ParentProcessId
              : 0,
          name: p.Name ?? '',
          command: p.CommandLine ?? '',
        });
      }
    }
  } catch {
    // PowerShell failed; return empty map.
  }
  return processMap;
}

/**
 * Fetches the parent process ID, name, and command for a given process ID on Unix.
 *
 * @param pid The process ID to inspect.
 * @returns A promise that resolves to the parent's PID, name, and command.
 */
async function getProcessInfo(pid: number): Promise<{
  parentPid: number;
  name: string;
  command: string;
}> {
  try {
    const command = `ps -o ppid=,command= -p ${pid}`;
    const { stdout } = await execAsync(command);
    const trimmedStdout = stdout.trim();
    if (!trimmedStdout) {
      return { parentPid: 0, name: '', command: '' };
    }
    const parts = trimmedStdout.split(/\s+/);
    const ppidString = parts[0];
    const parentPid = parseInt(ppidString, 10);
    const fullCommand = trimmedStdout.substring(ppidString.length).trim();
    const processName = path.basename(fullCommand.split(' ')[0]);

    return {
      parentPid: isNaN(parentPid) ? 1 : parentPid,
      name: processName,
      command: fullCommand,
    };
  } catch {
    // Process info unavailable; return defaults.
    return { parentPid: 0, name: '', command: '' };
  }
}

/**
 * Resolves the grandparent PID of a shell process, falling back to the parent
 * when the grandparent cannot be determined or is the init process.
 */
async function resolveIdePidFromShellParent(
  parentPid: number,
): Promise<number> {
  try {
    const { parentPid: grandParentPid } = await getProcessInfo(parentPid);
    if (grandParentPid > 1) {
      return grandParentPid;
    }
  } catch {
    // Ignore if getting grandparent fails, we'll just use the parent pid.
  }
  return parentPid;
}

/**
 * Finds the IDE process info on Unix-like systems.
 *
 * The strategy is to find the shell process that spawned the CLI, and then
 * find that shell's parent process (the IDE). To get the true IDE process,
 * we traverse one level higher to get the grandparent.
 *
 * @returns A promise that resolves to the PID and command of the IDE process.
 */
async function getIdeProcessInfoForUnix(): Promise<{
  pid: number;
  command: string;
}> {
  const shells = ['zsh', 'bash', 'sh', 'tcsh', 'csh', 'ksh', 'fish', 'dash'];
  let currentPid = process.pid;

  for (let i = 0; i < MAX_TRAVERSAL_DEPTH; i++) {
    const traversalResult = await traverseOnce(currentPid, shells);
    if (traversalResult.kind === 'shell') {
      const idePid = await resolveIdePidFromShellParent(
        traversalResult.parentPid,
      );
      const { command } = await getProcessInfo(idePid);
      return { pid: idePid, command };
    }
    if (traversalResult.nextPid === currentPid) {
      break;
    }
    currentPid = traversalResult.nextPid;
  }

  const { command } = await getProcessInfo(currentPid);
  return { pid: currentPid, command };
}

type TraversalStep =
  | { kind: 'shell'; parentPid: number }
  | { kind: 'continue'; nextPid: number };

async function traverseOnce(
  currentPid: number,
  shells: string[],
): Promise<TraversalStep> {
  try {
    const { parentPid, name, command } = await getProcessInfo(currentPid);

    if (process.env.DEBUG_PROCESS_TREE) {
      debugLogger.error(
        `[Process Tree] PID: ${currentPid}, Parent: ${parentPid}, Name: "${name}", Command: "${command}"`,
      );
    }

    const baseName = path.basename(name);
    const isShell = shells.some(
      (shell) => baseName === shell || name === shell,
    );
    if (isShell) {
      return { kind: 'shell', parentPid };
    }

    if (parentPid <= 1) {
      return { kind: 'continue', nextPid: currentPid };
    }
    return { kind: 'continue', nextPid: parentPid };
  } catch {
    return { kind: 'continue', nextPid: currentPid };
  }
}

/**
 * Finds the IDE process info on Windows using a snapshot approach.
 */
async function getIdeProcessInfoForWindows(): Promise<{
  pid: number;
  command: string;
}> {
  // Fetch the entire process table in one go.
  const processMap = await getProcessTableWindows();
  const myPid = process.pid;
  const myProc = processMap.get(myPid);

  if (!myProc) {
    // Fallback: try to get info for current process directly if snapshot fails
    const { command } = await getProcessInfo(myPid);
    return { pid: myPid, command };
  }

  // Perform tree traversal in memory.
  // ancestors[0] is the CLI itself (not an IDE candidate). Walk from the
  // nearest non-CLI ancestor toward the root, returning the first process
  // whose name or command identifies a supported IDE. If none match, fall
  // back to the top-level reachable ancestor to preserve best-effort behavior.
  const ancestors: ProcessInfo[] = [];
  let curr: ProcessInfo | undefined = myProc;

  for (let i = 0; i < MAX_TRAVERSAL_DEPTH && curr; i++) {
    ancestors.push(curr);
    if (curr.parentPid === 0 || !processMap.has(curr.parentPid)) {
      break; // Reached root
    }
    curr = processMap.get(curr.parentPid);
  }

  // ancestors[0] is the CLI; start matching from its first parent.
  for (let i = 1; i < ancestors.length; i++) {
    const ancestor = ancestors[i];
    if (isIdeProcess(ancestor)) {
      return { pid: ancestor.pid, command: ancestor.command };
    }
  }

  if (ancestors.length > 0) {
    const target = ancestors[ancestors.length - 1];
    return { pid: target.pid, command: target.command };
  }

  return { pid: myPid, command: myProc.command };
}

/**
 * Traverses up the process tree to find the process ID and command of the IDE.
 *
 * This function uses different strategies depending on the operating system
 * to identify the main application process (e.g., the main VS Code window
 * process).
 *
 * If the IDE process cannot be reliably identified, it will return the
 * top-level ancestor process ID and command as a fallback.
 *
 * @returns A promise that resolves to the PID and command of the IDE process.
 */
export async function getIdeProcessInfo(): Promise<{
  pid: number;
  command: string;
}> {
  const platform = os.platform();

  if (platform === 'win32') {
    return getIdeProcessInfoForWindows();
  }

  return getIdeProcessInfoForUnix();
}
