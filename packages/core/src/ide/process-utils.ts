/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

const MAX_TRAVERSAL_DEPTH = 32;

/**
 * Fetches the parent process ID, name, and command for a given process ID.
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
    const platform = os.platform();
    if (platform === 'win32') {
      const powershellSegments = [
        '$p = Get-CimInstance Win32_Process',
        `-Filter 'ProcessId=${pid}'`,
        '-ErrorAction SilentlyContinue;',
        'if ($p) {',
        '@{Name=$p.Name;ParentProcessId=$p.ParentProcessId;CommandLine=$p.CommandLine}',
        '| ConvertTo-Json',
        '}',
      ];
      const powershellCommand = `powershell "${powershellSegments.join(' ')}"`;
      const { stdout } = await execAsync(powershellCommand);
      const output = stdout.trim();
      if (!output) {
        return { parentPid: 0, name: '', command: '' };
      }

      try {
        const parsed = JSON.parse(output) as {
          Name?: string;
          ParentProcessId?: number;
          CommandLine?: string;
        };
        const parentPid =
          typeof parsed.ParentProcessId === 'number'
            ? parsed.ParentProcessId
            : 0;
        return {
          parentPid,
          name: parsed.Name ?? '',
          command: parsed.CommandLine ?? '',
        };
      } catch (parseError) {
        console.debug(
          `Failed to parse PowerShell output for pid ${pid}:`,
          parseError,
        );
        return { parentPid: 0, name: '', command: '' };
      }
    }

    // Non-Windows platforms - use command= instead of comm=
    const command = `ps -o ppid=,command= -p ${pid}`;
    const { stdout } = await execAsync(command);
    const trimmedStdout = stdout.trim();

    const match = trimmedStdout.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) {
      throw new Error(`Failed to parse ps output: ${trimmedStdout}`);
    }

    const parentPid = parseInt(match[1], 10);
    const execPath = match[2].trim();

    const { stdout: fullCmdStdout } = await execAsync(
      `ps -o command= -p ${pid}`,
    );
    const fullCommand = fullCmdStdout.trim();
    const processName = path.basename(execPath);

    return {
      parentPid: Number.isNaN(parentPid) ? 1 : parentPid,
      name: processName,
      command: fullCommand,
    };
  } catch (error) {
    console.debug(`Failed to get process info for pid ${pid}:`, error);
    return { parentPid: 0, name: '', command: '' };
  }
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
    try {
      const { parentPid, name, command } = await getProcessInfo(currentPid);

      // Debug logging
      if (process.env.DEBUG_PROCESS_TREE) {
        console.error(
          `[Process Tree] PID: ${currentPid}, Parent: ${parentPid}, Name: "${name}", Command: "${command}"`,
        );
      }

      // Check if it's a shell (handle both 'zsh' and '/bin/zsh' formats)
      const baseName = path.basename(name);
      const isShell = shells.some(
        (shell) => baseName === shell || name === shell,
      );
      if (isShell) {
        // The direct parent of the shell is often a utility process (e.g. VS
        // Code's `ptyhost` process). To get the true IDE process, we need to
        // traverse one level higher to get the grandparent.
        let idePid = parentPid;
        try {
          const { parentPid: grandParentPid } = await getProcessInfo(parentPid);
          if (grandParentPid > 1) {
            idePid = grandParentPid;
          }
        } catch {
          // Ignore if getting grandparent fails, we'll just use the parent pid.
        }
        const { command } = await getProcessInfo(idePid);
        return { pid: idePid, command };
      }

      if (parentPid <= 1) {
        break; // Reached the root
      }
      currentPid = parentPid;
    } catch {
      // Process in chain died
      break;
    }
  }

  const { command } = await getProcessInfo(currentPid);
  return { pid: currentPid, command };
}

/**
 * Finds the IDE process info on Windows using an optimized single PowerShell call.
 *
 * The strategy is to get all ancestor processes in one call, then traverse in memory.
 * This is much faster than making multiple PowerShell calls.
 *
 * @returns A promise that resolves to the PID and command of the IDE process.
 */
async function getIdeProcessInfoForWindows(): Promise<{
  pid: number;
  command: string;
}> {
  try {
    // Get all processes in a single PowerShell call - much faster than multiple calls
    const powershellCommand = `powershell "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json"`;
    const { stdout } = await execAsync(powershellCommand, { timeout: 5000 });
    const output = stdout.trim();

    if (!output) {
      return { pid: process.pid, command: '' };
    }

    // Parse all processes into a map for fast lookup
    const processes = JSON.parse(output) as Array<{
      ProcessId?: number;
      ParentProcessId?: number;
      Name?: string;
      CommandLine?: string;
    }>;

    const processMap = new Map<
      number,
      { parentPid: number; name: string; command: string }
    >();
    for (const p of processes) {
      if (p.ProcessId !== undefined) {
        processMap.set(p.ProcessId, {
          parentPid: p.ParentProcessId ?? 0,
          name: p.Name ?? '',
          command: p.CommandLine ?? '',
        });
      }
    }

    // Traverse up from current process to find the IDE
    let currentPid = process.pid;
    let previousPid = process.pid;

    for (let i = 0; i < MAX_TRAVERSAL_DEPTH; i++) {
      const current = processMap.get(currentPid);
      if (!current) {
        break;
      }

      const parentPid = current.parentPid;
      if (parentPid > 0) {
        const parent = processMap.get(parentPid);
        const grandParentPid = parent?.parentPid ?? 0;

        if (grandParentPid === 0) {
          // Found the grandchild of root - the IDE is previousPid
          const ide = processMap.get(previousPid);
          return { pid: previousPid, command: ide?.command ?? '' };
        }
      }

      if (parentPid <= 0) {
        break;
      }
      previousPid = currentPid;
      currentPid = parentPid;
    }

    const current = processMap.get(currentPid);
    return { pid: currentPid, command: current?.command ?? '' };
  } catch (error) {
    console.debug('Failed to get Windows process info:', error);
    return { pid: process.pid, command: '' };
  }
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
