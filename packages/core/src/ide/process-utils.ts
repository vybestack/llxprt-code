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
 * Finds the IDE process info on Windows.
 *
 * The strategy is to find the great-grandchild of the root process.
 *
 * @returns A promise that resolves to the PID and command of the IDE process.
 */
async function getIdeProcessInfoForWindows(): Promise<{
  pid: number;
  command: string;
}> {
  let currentPid = process.pid;
  let previousPid = process.pid;

  for (let i = 0; i < MAX_TRAVERSAL_DEPTH; i++) {
    try {
      const { parentPid } = await getProcessInfo(currentPid);

      if (parentPid > 0) {
        try {
          const { parentPid: grandParentPid } = await getProcessInfo(parentPid);
          if (grandParentPid === 0) {
            // We've found the grandchild of the root (`currentPid`). The IDE
            // process is its child, which we've stored in `previousPid`.
            const { command } = await getProcessInfo(previousPid);
            return { pid: previousPid, command };
          }
        } catch {
          // getting grandparent failed, proceed
        }
      }

      if (parentPid <= 0) {
        break; // Reached the root
      }
      previousPid = currentPid;
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
  // Skip slow process tree traversal in CI environments on Windows
  // IDE detection is not needed in CI and the PowerShell calls are slow
  // Use process.platform directly to avoid mocked os.platform() in tests
  if (process.env.CI && process.platform === 'win32') {
    return { pid: process.pid, command: '' };
  }

  const platform = os.platform();

  if (platform === 'win32') {
    return getIdeProcessInfoForWindows();
  }

  return getIdeProcessInfoForUnix();
}
