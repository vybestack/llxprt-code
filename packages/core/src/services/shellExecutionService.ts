/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import { spawn as cpSpawn } from 'node:child_process';
import type { PtyImplementation } from '../utils/getPty.js';
import { getPty } from '../utils/getPty.js';
import { getShellConfiguration } from '../utils/shell-utils.js';
import type {
  ShellExecutionResult,
  ShellExecutionHandle,
  ShellExecutionConfig,
  ShellOutputEvent,
} from './shellExecutionTypes.js';
import { ensurePromptvarsDisabled } from './shellOutputUtils.js';
import { SIGKILL_TIMEOUT_MS } from './shellProcessKill.js';
import {
  isIgnorablePtyExitError,
  cleanupPtyEntryResources,
  type ActivePty,
} from './shellPtyHelpers.js';
import { createCpResultPromise } from './shellCpExecution.js';
import {
  createPtyResultPromise,
  SCROLLBACK_LIMIT,
} from './shellPtyLifecycle.js';

export type {
  ShellExecutionResult,
  ShellExecutionHandle,
  ShellExecutionConfig,
  ShellOutputEvent,
};
export { SCROLLBACK_LIMIT };

export class ShellExecutionService {
  private static activePtys = new Map<number, ActivePty>();
  private static lastActivePtyIdRef: { value: number | null } = { value: null };

  /**
   * Executes a shell command using `node-pty`, capturing all output and
   * lifecycle events.  Falls back to `child_process` when PTY is unavailable.
   */
  static async execute(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shouldUseNodePty: boolean,
    shellExecutionConfig: ShellExecutionConfig = {},
  ): Promise<ShellExecutionHandle> {
    if (shouldUseNodePty) {
      const ptyInfo = await getPty();
      if (ptyInfo) {
        try {
          return this.executeWithPty(
            commandToExecute,
            cwd,
            onOutputEvent,
            abortSignal,
            shellExecutionConfig,
            ptyInfo,
          );
        } catch {
          // PTY initialization failed; fallback to child_process.
        }
      }
    }

    return this.childProcessFallback(
      commandToExecute,
      cwd,
      onOutputEvent,
      abortSignal,
      shellExecutionConfig,
    );
  }

  private static childProcessFallback(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shellExecutionConfig: ShellExecutionConfig = {},
  ): ShellExecutionHandle {
    try {
      const isWindows = os.platform() === 'win32';
      const { executable, argsPrefix, shell } = getShellConfiguration();
      const guardedCommand = ensurePromptvarsDisabled(commandToExecute, shell);
      const spawnArgs = [...argsPrefix, guardedCommand];

      const envVars = this.sanitizeEnvironment(
        {
          ...process.env,
          LLXPRT_CODE: '1',
          TERM: 'xterm-256color',
          PAGER: 'cat',
        },
        shellExecutionConfig.isSandboxOrCI === true,
      );
      delete envVars.BASH_ENV;

      const child = cpSpawn(executable, spawnArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: isWindows ? false : undefined,
        shell: false,
        detached: !isWindows,
        env: envVars,
      });

      const result = createCpResultPromise(
        child,
        isWindows,
        onOutputEvent,
        abortSignal,
        shellExecutionConfig.inactivityTimeoutMs,
      );

      return { pid: child.pid, result };
    } catch (e) {
      return errorHandle(e as Error);
    }
  }

  private static executeWithPty(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shellExecutionConfig: ShellExecutionConfig,
    ptyInfo: NonNullable<PtyImplementation>,
  ): ShellExecutionHandle {
    const isWindows = os.platform() === 'win32';
    const cols = shellExecutionConfig.terminalWidth ?? 80;
    const rows = shellExecutionConfig.terminalHeight ?? 30;
    const { executable, argsPrefix, shell } = getShellConfiguration();
    const guardedCommand = ensurePromptvarsDisabled(commandToExecute, shell);
    const args = [...argsPrefix, guardedCommand];

    const envVars = this.sanitizeEnvironment(
      {
        ...process.env,
        LLXPRT_CODE: '1',
        TERM: 'xterm-256color',
        PAGER: shellExecutionConfig.pager ?? 'cat',
      },
      shellExecutionConfig.isSandboxOrCI === true,
    );
    delete envVars.BASH_ENV;

    const ptyProcess = ptyInfo.module.spawn(executable, args, {
      cwd,
      name: 'xterm-256color',
      cols,
      rows,
      env: envVars,
      handleFlowControl: true,
    });

    const ptyResult = createPtyResultPromise(
      ptyProcess,
      isWindows,
      cols,
      rows,
      onOutputEvent,
      abortSignal,
      shellExecutionConfig,
      ptyInfo,
      this.activePtys,
      this.lastActivePtyIdRef,
    );

    return {
      pid: ptyProcess.pid,
      result: ptyResult,
    };
  }

  /** Writes a string to the pseudo-terminal (PTY) of a running process. */
  static writeToPty(pid: number, input: string): void {
    const activePty = this.activePtys.get(pid);
    if (activePty !== undefined) {
      activePty.ptyProcess.write(input);
      return;
    }

    const fallbackPtyId = this.lastActivePtyIdRef.value;
    if (
      fallbackPtyId !== null &&
      fallbackPtyId !== 0 &&
      fallbackPtyId !== pid
    ) {
      const fallbackPty = this.activePtys.get(fallbackPtyId);
      if (fallbackPty !== undefined) {
        fallbackPty.ptyProcess.write(input);
      }
    }
  }

  static isPtyActive(pid: number): boolean {
    try {
      // process.kill with signal 0 checks for process existence without
      // sending a signal.
      return process.kill(pid, 0);
    } catch {
      return false;
    }
  }

  static isActivePty(pid: number): boolean {
    return this.activePtys.has(pid);
  }

  /** Resizes the pseudo-terminal (PTY) of a running process. */
  static resizePty(pid: number, cols: number, rows: number): void {
    if (!this.isPtyActive(pid)) {
      return;
    }

    const activePty = this.activePtys.get(pid);
    if (activePty) {
      try {
        activePty.ptyProcess.resize(cols, rows);
        activePty.headlessTerminal.resize(cols, rows);
      } catch (e) {
        if (!isIgnorablePtyExitError(e)) {
          throw e;
        }
      }
    }
  }

  static getLastActivePtyId(): number | null {
    return this.lastActivePtyIdRef.value;
  }

  /** Terminates the pseudo-terminal (PTY) process. */
  static terminatePty(pid: number): void {
    const activePty = this.activePtys.get(pid);
    if (!activePty) {
      return;
    }

    if (activePty.supportsProcessGroupKill) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Process may already be terminated.
      }
    }

    try {
      activePty.ptyProcess.kill('SIGTERM');
    } catch {
      // PTY may already be terminated.
    }

    activePty.terminationTimeout = setTimeout(() => {
      if (!this.activePtys.has(pid)) {
        return;
      }
      if (activePty.supportsProcessGroupKill) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Process may already be terminated.
        }
      }
      try {
        activePty.ptyProcess.kill('SIGKILL');
      } catch {
        // PTY may already be terminated.
      }
    }, SIGKILL_TIMEOUT_MS);
  }

  /** Scrolls the pseudo-terminal (PTY) of a running process. */
  static scrollPty(pid: number, lines: number): void {
    const activePty = this.activePtys.get(pid);
    const fallbackPtyId = this.lastActivePtyIdRef.value;
    const targetPty = resolveScrollTarget(
      pid,
      activePty,
      fallbackPtyId,
      this.activePtys,
    );

    if (targetPty === undefined) {
      return;
    }

    try {
      targetPty.headlessTerminal.scrollLines(lines);
      if (targetPty.headlessTerminal.buffer.active.viewportY < 0) {
        targetPty.headlessTerminal.scrollToTop();
      }
    } catch (e) {
      if (!isIgnorablePtyExitError(e)) {
        throw e;
      }
    }
  }

  /**
   * Destroys all active PTY processes by sending kill signals and cleaning up
   * resources. Safe to call when no PTYs are active.
   */
  static destroyAllPtys(): void {
    for (const [pid, entry] of this.activePtys) {
      cleanupPtyEntryResources(entry);
      this.activePtys.delete(pid);
    }
    this.lastActivePtyIdRef.value = null;
  }

  /**
   * Sanitizes environment variables to prevent credential leaks in
   * sandbox/CI environments. Uses an allowlist approach: only known-safe
   * variables are forwarded.
   */
  static sanitizeEnvironment(
    env: NodeJS.ProcessEnv,
    isSandboxOrCI: boolean,
    allowlist?: string[],
  ): NodeJS.ProcessEnv {
    if (!isSandboxOrCI) {
      return { ...env };
    }

    const safeVars = buildSafeVarSet(allowlist);
    const result: NodeJS.ProcessEnv = {};

    for (const [key, value] of Object.entries(env)) {
      if (safeVars.has(key) || /^LLXPRT_/.test(key)) {
        result[key] = value;
      }
    }

    return result;
  }
}

/** Build an error handle for spawn failures. */
function errorHandle(error: Error): ShellExecutionHandle {
  return {
    pid: undefined,
    result: Promise.resolve({
      error,
      rawOutput: Buffer.from(''),
      output: '',
      exitCode: 1,
      signal: null,
      aborted: false,
      pid: undefined,
      executionMethod: 'none',
    }),
  };
}

/** Resolve the target PTY for scroll operations. */
function resolveScrollTarget(
  pid: number,
  activePty: ActivePty | undefined,
  fallbackPtyId: number | null,
  activePtys: Map<number, ActivePty>,
): ActivePty | undefined {
  if (activePty !== undefined) {
    return activePty;
  }
  if (fallbackPtyId !== null && fallbackPtyId !== 0 && fallbackPtyId !== pid) {
    return activePtys.get(fallbackPtyId);
  }
  return undefined;
}

/** Build the set of safe environment variable names. */
function buildSafeVarSet(allowlist?: string[]): Set<string> {
  const safeVars = new Set([
    'PATH',
    'Path',
    'SYSTEMROOT',
    'SystemRoot',
    'COMSPEC',
    'ComSpec',
    'PATHEXT',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'SYSTEMDRIVE',
    'SystemDrive',
    'HOME',
    'LANG',
    'SHELL',
    'TMPDIR',
    'USER',
    'LOGNAME',
    'TERM',
    'PAGER',
    'ADDITIONAL_CONTEXT',
    'AVAILABLE_LABELS',
    'BRANCH_NAME',
    'DESCRIPTION',
    'EVENT_NAME',
    'GITHUB_ENV',
    'IS_PULL_REQUEST',
    'ISSUES_TO_TRIAGE',
    'ISSUE_BODY',
    'ISSUE_NUMBER',
    'ISSUE_TITLE',
    'PULL_REQUEST_NUMBER',
    'REPOSITORY',
    'TITLE',
    'TRIGGERING_ACTOR',
  ]);

  if (allowlist) {
    for (const name of allowlist) {
      safeVars.add(name);
    }
  }

  return safeVars;
}
