/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, max-lines -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import stripAnsi from 'strip-ansi';
import type { PtyImplementation } from '../utils/getPty.js';
import { getPty } from '../utils/getPty.js';
import { spawn as cpSpawn, type ChildProcess } from 'node:child_process';
import { TextDecoder } from 'node:util';
import os from 'node:os';
import type { IPty } from '@lydell/node-pty';
import { getCachedEncodingForBuffer } from '../utils/systemEncoding.js';
import { getShellConfiguration, type ShellType } from '../utils/shell-utils.js';
import { isBinary } from '../utils/textUtils.js';
import pkg from '@xterm/headless';
import {
  serializeTerminalToObject,
  type AnsiLine,
  type AnsiOutput,
} from '../utils/terminalSerializer.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import type { EnvironmentSanitizationConfig } from './environmentSanitization.js';

const { Terminal } = pkg;

const shellDebug = new DebugLogger('llxprt:shell:render');

const SIGKILL_TIMEOUT_MS = 200;
const MAX_CHILD_PROCESS_BUFFER_SIZE = 16 * 1024 * 1024; // 16MB
const ANSI_ESCAPE = '\u001b';
const ANSI_CSI = '\u009b';
const MAX_SNIFF_SIZE = 4096;

// We want to allow shell outputs that are close to the context window in size.
// 600,000 lines is roughly equivalent to a large context window, ensuring
// we capture significant output from long-running commands.
export const SCROLLBACK_LIMIT = 600000;

function stripAnsiIfPresent(value: string): string {
  return value.includes(ANSI_ESCAPE) || value.includes(ANSI_CSI)
    ? stripAnsi(value)
    : value;
}

const BASH_SHOPT_OPTIONS = 'promptvars nullglob extglob nocaseglob dotglob';
const BASH_SHOPT_GUARD = `shopt -u ${BASH_SHOPT_OPTIONS};`;

function ensurePromptvarsDisabled(command: string, shell: ShellType): string {
  if (shell !== 'bash') {
    return command;
  }

  const trimmed = command.trimStart();
  if (trimmed.startsWith(BASH_SHOPT_GUARD)) {
    return command;
  }

  return `${BASH_SHOPT_GUARD} ${command}`;
}

/** A structured result from a shell command execution. */
export interface ShellExecutionResult {
  /** The raw, unprocessed output buffer. */
  rawOutput: Buffer;
  /** The combined, decoded output as a string. */
  output: string;
  /** The process exit code, or null if terminated by a signal. */
  exitCode: number | null;
  /** The signal that terminated the process, if any. */
  signal: number | null;
  /** An error object if the process failed to spawn. */
  error: Error | null;
  /** A boolean indicating if the command was aborted by the user. */
  aborted: boolean;
  /** Whether the command was killed due to an inactivity timeout. */
  inactivityTimedOut?: boolean;
  /** The process ID of the spawned shell. */
  pid: number | undefined;
  /** The method used to execute the shell command. */
  executionMethod: 'lydell-node-pty' | 'node-pty' | 'child_process' | 'none';
}

export interface ShellExecutionHandle {
  pid: number | undefined;
  result: Promise<ShellExecutionResult>;
}

export interface ShellExecutionConfig {
  terminalWidth?: number;
  terminalHeight?: number;
  pager?: string;
  showColor?: boolean;
  defaultFg?: string;
  defaultBg?: string;
  // Used for testing
  disableDynamicLineTrimming?: boolean;
  scrollback?: number;
  inactivityTimeoutMs?: number;
  isSandboxOrCI?: boolean;
  sanitizationConfig?: EnvironmentSanitizationConfig;
}

export type ShellOutputEvent =
  | {
      /** The event contains a chunk of output data. */
      type: 'data';
      /** The decoded string chunk or AnsiOutput for PTY mode. */
      chunk: string | AnsiOutput;
    }
  | {
      /** Signals that the output stream has been identified as binary. */
      type: 'binary_detected';
    }
  | {
      /** Provides progress updates for a binary stream. */
      type: 'binary_progress';
      /** The total number of bytes received so far. */
      bytesReceived: number;
    };

interface ActivePty {
  ptyProcess: IPty;
  headlessTerminal: pkg.Terminal;
  onDataDisposable?: { dispose(): void };
  onExitDisposable?: { dispose(): void };
  onScrollDisposable?: { dispose(): void };
  terminationTimeout?: NodeJS.Timeout;
  renderTimeout?: NodeJS.Timeout;
}

/**
 * Returns true when the error is a benign race where the PTY has already
 * exited before a resize/scroll call reaches it (Unix ESRCH or Windows
 * message-based error).
 */
function isIgnorablePtyExitError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return (
    err.code === 'ESRCH' ||
    (typeof err.message === 'string' &&
      err.message.includes('Cannot resize a pty that has already exited'))
  );
}

const getFullBufferText = (terminal: pkg.Terminal): string => {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) {
      continue;
    }
    let trimRight = true;
    if (i + 1 < buffer.length) {
      const nextLine = buffer.getLine(i + 1);
      if (nextLine?.isWrapped === true) {
        trimRight = false;
      }
    }

    const lineContent = line.translateToString(trimRight);

    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += lineContent;
    } else {
      lines.push(lineContent);
    }
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
};

/**
 * Safely tears down a PTY process, preferring destroy() (which closes the
 * underlying FD/socket) when available at runtime, with a kill() fallback.
 */
function safePtyDestroy(ptyProcess: IPty): void {
  try {
    const pty = ptyProcess as IPty & { destroy?: () => void };
    if (typeof pty.destroy === 'function') {
      pty.destroy();
    } else {
      ptyProcess.kill();
    }
  } catch {
    // PTY may already be exited; cleanup is best-effort.
  }
}

function cleanupPtyEntryResources(entry: ActivePty): void {
  try {
    entry.onDataDisposable?.dispose();
  } catch {
    // Dispose may fail if PTY already exited.
  }
  try {
    entry.onExitDisposable?.dispose();
  } catch {
    // Dispose may fail if PTY already exited.
  }
  try {
    entry.onScrollDisposable?.dispose();
  } catch {
    // Dispose may fail if PTY already exited.
  }
  if (entry.terminationTimeout) {
    clearTimeout(entry.terminationTimeout);
    entry.terminationTimeout = undefined;
  }
  if (entry.renderTimeout) {
    clearTimeout(entry.renderTimeout);
    entry.renderTimeout = undefined;
  }
  safePtyDestroy(entry.ptyProcess);
  try {
    if (typeof entry.headlessTerminal.dispose === 'function') {
      entry.headlessTerminal.dispose();
    }
  } catch {
    // Terminal may already be disposed.
  }
}

/** Kill a process tree with SIGTERM → SIGKILL escalation (Unix) or taskkill (Windows). */
async function killProcessWithEscalation(
  pid: number,
  isWindows: boolean,
  killChildFallback: () => void,
  exitedRef: { value: boolean },
): Promise<void> {
  if (isWindows) {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
    cpSpawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
  } else {
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    try {
      process.kill(-pid, 'SIGTERM');
      await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Defensive check for race condition: process may exit during await
      if (!exitedRef.value) {
        process.kill(-pid, 'SIGKILL');
      }
    } catch {
      // Process may have exited during race.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Defensive check for race condition: process may exit during await
      if (!exitedRef.value) killChildFallback();
    }
  }
}

/** Shared inactivity timer factory used by both CP and PTY paths. */
function makeInactivityTimer(
  timeoutMs: number | undefined,
  exitedRef: { value: boolean },
): {
  reset: () => void;
  controller: AbortController;
} {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | null = null;

  const reset = () => {
    if (timeoutMs === undefined || timeoutMs <= 0 || exitedRef.value) {
      return;
    }
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      if (!exitedRef.value) {
        controller.abort('inactivity_timeout');
      }
    }, timeoutMs);
  };

  return { reset, controller };
}

/** State bag shared across child_process helper closures. */
interface CpExecState {
  child: ChildProcess;
  isWindows: boolean;
  abortSignal: AbortSignal;
  onOutputEvent: (event: ShellOutputEvent) => void;
  inactivityAbortController: AbortController;
  resetInactivityTimer: () => void;
  exitedRef: { value: boolean };
  stdoutDecoder: TextDecoder | null;
  stderrDecoder: TextDecoder | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  outputChunks: Buffer[];
  error: Error | null;
  isStreamingRawContent: boolean;
  sniffedBytes: number;
  sniffBuffer: Buffer;
  totalBytesReceived: number;
  hasResolved: boolean;
  cleanedUp: boolean;
}

/** Create decoders for stdout/stderr from the first data chunk's encoding. */
function ensureDecoders(state: CpExecState, data: Buffer): void {
  if (state.stdoutDecoder && state.stderrDecoder) {
    return;
  }
  const encoding = getCachedEncodingForBuffer(data);
  try {
    state.stdoutDecoder = new TextDecoder(encoding);
    state.stderrDecoder = new TextDecoder(encoding);
  } catch {
    state.stdoutDecoder = new TextDecoder('utf-8');
    state.stderrDecoder = new TextDecoder('utf-8');
  }
}

/** Append a decoded chunk to stdout or stderr with truncation tracking. */
function appendDecodedChunk(
  currentBuffer: string,
  strippedChunk: string,
  maxSize: number,
): { newBuffer: string; truncated: boolean } {
  const chunkLength = strippedChunk.length;
  const currentLength = currentBuffer.length;
  const newTotalLength = currentLength + chunkLength;

  if (newTotalLength <= maxSize) {
    return { newBuffer: currentBuffer + strippedChunk, truncated: false };
  }

  if (chunkLength >= maxSize) {
    return {
      newBuffer: strippedChunk.substring(chunkLength - maxSize),
      truncated: true,
    };
  }

  const charsToTrim = newTotalLength - maxSize;
  const truncatedBuffer = currentBuffer.substring(charsToTrim);
  return { newBuffer: truncatedBuffer + strippedChunk, truncated: true };
}

/** Process incoming data from child_process stdout/stderr. */
function handleCpOutput(state: CpExecState, data: Buffer, stream: 'stdout' | 'stderr'): void {
  state.resetInactivityTimer();
  ensureDecoders(state, data);

  state.totalBytesReceived += data.length;
  state.outputChunks.push(data);

  if (state.isStreamingRawContent && state.sniffedBytes < MAX_SNIFF_SIZE) {
    const remaining = MAX_SNIFF_SIZE - state.sniffedBytes;
    if (remaining > 0) {
      const slice = data.subarray(0, remaining);
      state.sniffBuffer =
        state.sniffBuffer.length === 0
          ? Buffer.from(slice)
          : Buffer.concat([state.sniffBuffer, slice]);
      state.sniffedBytes = state.sniffBuffer.length;

      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (isBinary(state.sniffBuffer)) {
        state.isStreamingRawContent = false;
        state.onOutputEvent({ type: 'binary_detected' });
      }
    }
  }

  const decoder = stream === 'stdout' ? state.stdoutDecoder : state.stderrDecoder;
  const decodedChunk = decoder!.decode(data, { stream: true });
  const strippedChunk = stripAnsiIfPresent(decodedChunk);

  if (stream === 'stdout') {
    const { newBuffer, truncated } = appendDecodedChunk(
      state.stdout,
      strippedChunk,
      MAX_CHILD_PROCESS_BUFFER_SIZE,
    );
    state.stdout = newBuffer;
    if (truncated) {
      state.stdoutTruncated = true;
    }
  } else {
    const { newBuffer, truncated } = appendDecodedChunk(
      state.stderr,
      strippedChunk,
      MAX_CHILD_PROCESS_BUFFER_SIZE,
    );
    state.stderr = newBuffer;
    if (truncated) {
      state.stderrTruncated = true;
    }
  }

  if (state.isStreamingRawContent) {
    state.onOutputEvent({ type: 'data', chunk: strippedChunk });
  } else {
    state.onOutputEvent({
      type: 'binary_progress',
      bytesReceived: state.totalBytesReceived,
    });
  }
}

/** Clean up child_process listeners and flush remaining decoder bytes. */
function cleanupCpResources(
  state: CpExecState,
  abortHandler: () => void,
): { stdout: string; stderr: string; finalBuffer: Buffer } {
  state.exitedRef.value = true;
  state.abortSignal.removeEventListener('abort', abortHandler);

  if (!state.cleanedUp) {
    state.cleanedUp = true;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    state.child.stdout?.removeAllListeners('data');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    state.child.stderr?.removeAllListeners('data');
    state.child.removeAllListeners('error');
    state.child.removeAllListeners('exit');
    state.child.removeAllListeners('close');
  }

  if (state.stdoutDecoder) {
    const remaining = state.stdoutDecoder.decode();
    if (remaining) {
      state.stdout += stripAnsiIfPresent(remaining);
    }
  }
  if (state.stderrDecoder) {
    const remaining = state.stderrDecoder.decode();
    if (remaining) {
      state.stderr += stripAnsiIfPresent(remaining);
    }
  }

  const finalBuffer = Buffer.concat(state.outputChunks);
  return { stdout: state.stdout, stderr: state.stderr, finalBuffer };
}

/** Build the ShellExecutionResult for a child_process exit. */
function buildCpExitResult(
  state: CpExecState,
  code: number | null,
  signal: NodeJS.Signals | null,
  finalBuffer: Buffer,
): ShellExecutionResult {
  const separator = state.stdout.endsWith('\n') ? '' : '\n';
  let combinedOutput = state.stdout;
  if (state.stderr) {
    combinedOutput += (state.stdout !== '' ? separator : '') + state.stderr;
  }

  if (state.stdoutTruncated || state.stderrTruncated) {
    const truncationMessage = `\n[LLXPRT_CODE_WARNING: Output truncated. The buffer is limited to ${
      MAX_CHILD_PROCESS_BUFFER_SIZE / (1024 * 1024)
    }MB.]`;
    combinedOutput += truncationMessage;
  }

  return {
    rawOutput: finalBuffer,
    output: combinedOutput.trim(),
    exitCode: code,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    signal: signal ? (os.constants.signals[signal] ?? null) : null,
    error: state.error,
    aborted: state.abortSignal.aborted,
    inactivityTimedOut: state.inactivityAbortController.signal.aborted,
    pid: state.child.pid,
    executionMethod: 'child_process',
  };
}

/** Register exit/close event handlers on the child process. */
function registerCpExitHandlers(
  state: CpExecState,
  handleExit: (code: number | null, signal: NodeJS.Signals | null) => void,
): void {
  const childOnce = state.child.once as
    | ((
        event: 'exit' | 'close',
        listener: (
          code: number | null,
          signal: NodeJS.Signals | null,
        ) => void,
      ) => typeof state.child)
    | undefined;
  if (childOnce !== undefined) {
    childOnce.call(state.child, 'exit', (code, signal) => {
      handleExit(code, signal);
    });
    childOnce.call(state.child, 'close', (code, signal) => {
      handleExit(code, signal);
    });
  } else {
    state.child.on('exit', (code, signal) => {
      handleExit(code, signal);
    });
    state.child.on('close', (code, signal) => {
      handleExit(code, signal);
    });
  }
}

/** State bag shared across PTY helper closures. */
interface PtyExecState {
  ptyProcess: IPty;
  headlessTerminal: pkg.Terminal;
  activePtyEntry: ActivePty;
  isWindows: boolean;
  abortSignal: AbortSignal;
  onOutputEvent: (event: ShellOutputEvent) => void;
  shellExecutionConfig: ShellExecutionConfig;
  ptyInfo: PtyImplementation | null;
  inactivityAbortController: AbortController;
  resetInactivityTimer: () => void;
  exitedRef: { value: boolean };
  decoder: TextDecoder | null;
  output: string | AnsiOutput | null;
  outputChunks: Buffer[];
  error: Error | null;
  isStreamingRawContent: boolean;
  sniffedBytes: number;
  isWriting: boolean;
  hasStartedOutput: boolean;
  hasResolved: boolean;
  abortFinalizeTimeout: NodeJS.Timeout | null;
  processingChain: Promise<void>;
}

/** Serialize the headless terminal to an AnsiOutput, optionally stripping color. */
function serializeTerminalForRender(
  terminal: pkg.Terminal,
  showColor?: boolean,
): AnsiOutput {
  if (showColor === true) {
    return serializeTerminalToObject(terminal);
  }
  const serialized = serializeTerminalToObject(terminal);
  return (Array.isArray(serialized) ? serialized : [])
    .filter((line): line is AnsiLine => Array.isArray(line))
    .map((line) =>
      line.map((token) => {
        token.fg = '';
        token.bg = '';
        return token;
      }),
    );
}

/** Find the last non-empty line index in an AnsiOutput, capped by cursorY. */
function findLastNonEmptyLineIndex(
  newOutput: AnsiOutput,
  cursorY: number,
): number {
  let lastNonEmptyLine = -1;
  for (let i = newOutput.length - 1; i >= 0; i--) {
    const line = newOutput[i];
    if (
      Array.isArray(line) &&
      line
        .map((segment) => segment.text)
        .join('')
        .trim().length > 0
    ) {
      lastNonEmptyLine = i;
      break;
    }
  }

  if (cursorY > lastNonEmptyLine) {
    lastNonEmptyLine = cursorY;
  }

  return lastNonEmptyLine;
}

/** Emit the output event if the terminal content has changed. */
function maybeEmitRenderedOutput(
  state: PtyExecState,
  finalOutput: AnsiOutput,
  buffer: { cursorY: number; cursorX: number },
): void {
  const finalJson = JSON.stringify(finalOutput);
  const outputJson = JSON.stringify(state.output);
  if (outputJson !== finalJson) {
    const cursorLine = finalOutput[buffer.cursorY] as
      | AnsiLine
      | undefined;
    const cursorLineText =
      cursorLine !== undefined
        ? cursorLine
            .map((t) => t.text)
            .join('')
            .trimEnd()
        : '(no line)';
    shellDebug.log(
      'renderFn: CHANGED cursorY=%d cursorX=%d lines=%d cursorLine=%s',
      buffer.cursorY,
      buffer.cursorX,
      finalOutput.length,
      JSON.stringify(cursorLineText),
    );
    state.output = finalOutput;
    state.onOutputEvent({
      type: 'data',
      chunk: finalOutput,
    });
  } else {
    shellDebug.log(
      'renderFn: no change (cursorY=%d cursorX=%d)',
      buffer.cursorY,
      buffer.cursorX,
    );
  }
}

/** Clean up and resolve the active PTY entry from the global map. */
function cleanupActivePtyEntry(
  state: PtyExecState,
  activePtys: Map<number, ActivePty>,
  getLastId: () => number | null,
  setLastId: (id: number | null) => void,
): void {
  const entry = activePtys.get(state.ptyProcess.pid);
  if (entry) {
    cleanupPtyEntryResources(entry);
    activePtys.delete(state.ptyProcess.pid);
  }
  if (getLastId() === state.ptyProcess.pid) {
    setLastId(null);
  }
}

/** Build a ShellExecutionResult for the PTY path. */
function buildPtyResult(
  state: PtyExecState,
  exitCode: number,
  signal: number | null,
  aborted: boolean,
): ShellExecutionResult {
  return {
    rawOutput: Buffer.concat(state.outputChunks),
    output: getFullBufferText(state.headlessTerminal),
    exitCode,
    signal,
    error: state.error,
    aborted,
    inactivityTimedOut: state.inactivityAbortController.signal.aborted,
    pid: state.ptyProcess.pid,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    executionMethod: state.ptyInfo?.name ?? 'node-pty',
  };
}

export class ShellExecutionService {
  private static activePtys = new Map<number, ActivePty>();
  private static lastActivePtyId: number | null = null;
  /**
   * Executes a shell command using `node-pty`, capturing all output and lifecycle events.
   *
   * @param commandToExecute The exact command string to run.
   * @param cwd The working directory to execute the command in.
   * @param onOutputEvent A callback for streaming structured events about the execution, including data chunks and status updates.
   * @param abortSignal An AbortSignal to terminate the process and its children.
   * @param shouldUseNodePty Whether to use PTY mode.
   * @param shellExecutionConfig Configuration for shell execution.
   * @returns An object containing the process ID (pid) and a promise that
   *          resolves with the complete execution result.
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

      const envVars: NodeJS.ProcessEnv = this.sanitizeEnvironment(
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

      const result = this.createCpResultPromise(
        child, isWindows, onOutputEvent, abortSignal, shellExecutionConfig,
      );

      return { pid: child.pid, result };
    } catch (e) {
      const error = e as Error;
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
  }

  private static createCpResultPromise(
    child: ChildProcess,
    isWindows: boolean,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shellExecutionConfig: ShellExecutionConfig,
  ): Promise<ShellExecutionResult> {
    const exitedRef = { value: false };
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const inactivityTimeoutMs = shellExecutionConfig?.inactivityTimeoutMs;
    const { reset: resetInactivityTimer, controller: inactivityAbortController } =
      makeInactivityTimer(inactivityTimeoutMs, exitedRef);

    const state: CpExecState = {
      child,
      isWindows,
      abortSignal,
      onOutputEvent,
      inactivityAbortController,
      resetInactivityTimer,
      exitedRef,
      stdoutDecoder: null,
      stderrDecoder: null,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      outputChunks: [],
      error: null,
      isStreamingRawContent: true,
      sniffedBytes: 0,
      sniffBuffer: Buffer.alloc(0),
      totalBytesReceived: 0,
      hasResolved: false,
      cleanedUp: false,
    };

    return new Promise<ShellExecutionResult>((resolve) => {
      this.setupCpInactivityHandler(state, inactivityTimeoutMs, resetInactivityTimer);
      const abortHandler = this.setupCpAbortHandler(state);

      const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (state.hasResolved) {
          return;
        }
        state.hasResolved = true;
        const { finalBuffer } = cleanupCpResources(state, abortHandler);
        resolve(buildCpExitResult(state, code, signal, finalBuffer));
      };

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      child.stdout?.on('data', (data) => handleCpOutput(state, data, 'stdout'));
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      child.stderr?.on('data', (data) => handleCpOutput(state, data, 'stderr'));
      child.on('error', (err) => {
        state.error = err;
        handleExit(1, null);
      });

      abortSignal.addEventListener('abort', abortHandler, { once: true });
      registerCpExitHandlers(state, handleExit);
    });
  }

  private static setupCpInactivityHandler(
    state: CpExecState,
    inactivityTimeoutMs: number | undefined,
    resetInactivityTimer: () => void,
  ): void {
    if (inactivityTimeoutMs === undefined || inactivityTimeoutMs <= 0) {
      return;
    }
    state.inactivityAbortController.signal.addEventListener(
      'abort',
      () => {
        void (async () => {
          // Preserve old truthiness semantics: skip pid 0 and undefined (invalid process IDs)
          // Old code: if (child.pid && !exited)
          if (state.child.pid !== undefined && state.child.pid !== 0 && !state.exitedRef.value) {
            const pid = state.child.pid;
            await killProcessWithEscalation(pid, state.isWindows, () => state.child.kill('SIGKILL'), state.exitedRef);
          }
        })();
      },
      { once: true },
    );
    resetInactivityTimer();
  }

  private static setupCpAbortHandler(state: CpExecState): () => void {
    const abortHandler = () => {
      void (async () => {
        // Preserve old truthiness semantics: skip pid 0 and undefined (invalid process IDs)
        // Old code: if (child.pid && !exited)
        if (state.child.pid !== undefined && state.child.pid !== 0 && !state.exitedRef.value) {
          await killProcessWithEscalation(
            state.child.pid,
            state.isWindows,
            () => state.child.kill('SIGKILL'),
            state.exitedRef,
          );
        }
      })();
    };
    return abortHandler;
  }

  private static executeWithPty(
    commandToExecute: string,
    cwd: string,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shellExecutionConfig: ShellExecutionConfig,
    ptyInfo: PtyImplementation | null,
  ): ShellExecutionHandle {
    if (!ptyInfo) {
      throw new Error('PTY implementation not found');
    }
    try {
      const isWindows = os.platform() === 'win32';
      const cols = shellExecutionConfig.terminalWidth ?? 80;
      const rows = shellExecutionConfig.terminalHeight ?? 30;
      const { executable, argsPrefix, shell } = getShellConfiguration();
      const guardedCommand = ensurePromptvarsDisabled(commandToExecute, shell);
      const args = [...argsPrefix, guardedCommand];

      const envVars: NodeJS.ProcessEnv = this.sanitizeEnvironment(
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

      const result = this.createPtyResultPromise(
        ptyProcess, isWindows, cols, rows, onOutputEvent, abortSignal,
        shellExecutionConfig, ptyInfo,
      );

      return { pid: ptyProcess.pid, result };
    } catch (e) {
      const error = e as Error;
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
  }

  private static createPtyResultPromise(
    ptyProcess: IPty,
    isWindows: boolean,
    cols: number,
    rows: number,
    onOutputEvent: (event: ShellOutputEvent) => void,
    abortSignal: AbortSignal,
    shellExecutionConfig: ShellExecutionConfig,
    ptyInfo: PtyImplementation | null,
  ): Promise<ShellExecutionResult> {
    const headlessTerminal = new Terminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback: shellExecutionConfig.scrollback ?? SCROLLBACK_LIMIT,
    });
    headlessTerminal.scrollToTop();

    const exitedRef = { value: false };
    const inactivityTimeoutMs = shellExecutionConfig.inactivityTimeoutMs;
    const { reset: resetInactivityTimer, controller: inactivityAbortController } =
      makeInactivityTimer(inactivityTimeoutMs, exitedRef);

    const activePtyEntry: ActivePty = {
      ptyProcess,
      headlessTerminal,
    };
    ShellExecutionService.activePtys.set(ptyProcess.pid, activePtyEntry);
    ShellExecutionService.lastActivePtyId = ptyProcess.pid;

    const state: PtyExecState = {
      ptyProcess,
      headlessTerminal,
      activePtyEntry,
      isWindows,
      abortSignal,
      onOutputEvent,
      shellExecutionConfig,
      ptyInfo,
      inactivityAbortController,
      resetInactivityTimer,
      exitedRef,
      decoder: null,
      output: null,
      outputChunks: [],
      error: null,
      isStreamingRawContent: true,
      sniffedBytes: 0,
      isWriting: false,
      hasStartedOutput: false,
      hasResolved: false,
      abortFinalizeTimeout: null,
      processingChain: Promise.resolve(),
    };

    return new Promise<ShellExecutionResult>((resolve) => {
      this.setupPtyEventHandlers(state, resolve);
    });
  }

  private static setupPtyEventHandlers(
    state: PtyExecState,
    resolve: (value: ShellExecutionResult) => void,
  ): void {
    const resolveResult = this.makePtyResolveResult(state, resolve);
    const renderFn = () => { this.ptyRenderFn(state); };
    const render = this.makePtyRender(state, renderFn);

    state.activePtyEntry.onScrollDisposable = state.headlessTerminal.onScroll(() => {
      if (!state.isWriting) {
        render();
      }
    });

    this.setupPtyInactivityHandler(state);
    const abortHandler = this.setupPtyAbortHandler(state, resolveResult);

    this.registerPtyDataHandler(state, render);
    this.registerPtyExitHandler(state, resolveResult, abortHandler);

    state.abortSignal.addEventListener('abort', abortHandler, { once: true });
  }

  private static makePtyResolveResult(
    state: PtyExecState,
    resolve: (value: ShellExecutionResult) => void,
  ): (resultValue: ShellExecutionResult) => void {
    return (resultValue: ShellExecutionResult) => {
      if (state.hasResolved) {
        return;
      }
      state.hasResolved = true;
      if (state.abortFinalizeTimeout) {
        clearTimeout(state.abortFinalizeTimeout);
        state.abortFinalizeTimeout = null;
      }
      cleanupActivePtyEntry(
        state,
        ShellExecutionService.activePtys,
        () => ShellExecutionService.lastActivePtyId,
        (id) => { ShellExecutionService.lastActivePtyId = id; },
      );
      resolve(resultValue);
    };
  }

  private static makePtyRender(
    state: PtyExecState,
    renderFn: () => void,
  ): (finalRender?: boolean) => void {
    return (finalRender = false) => {
      if (finalRender) {
        if (state.activePtyEntry.renderTimeout) {
          clearTimeout(state.activePtyEntry.renderTimeout);
          state.activePtyEntry.renderTimeout = undefined;
        }
        renderFn();
        return;
      }

      // Coalesce rapid writes (e.g. initial shell prompt burst) but
      // keep latency low for interactive typing by using a short timer.
      if (state.activePtyEntry.renderTimeout) {
        return;
      }

      state.activePtyEntry.renderTimeout = setTimeout(() => {
        state.activePtyEntry.renderTimeout = undefined;
        renderFn();
      }, 16);
    };
  }

  private static registerPtyDataHandler(
    state: PtyExecState,
    render: () => void,
  ): void {
    const handleOutput = (data: Buffer) => {
      state.resetInactivityTimer();

      state.processingChain = state.processingChain.then(
        () =>
          new Promise<void>((res) => {
            if (!state.decoder) {
              const encoding = getCachedEncodingForBuffer(data);
              try {
                state.decoder = new TextDecoder(encoding);
              } catch {
                state.decoder = new TextDecoder('utf-8');
              }
            }

            state.outputChunks.push(data);

            if (state.isStreamingRawContent && state.sniffedBytes < MAX_SNIFF_SIZE) {
              const sniffBuffer = Buffer.concat(state.outputChunks.slice(0, 20));
              state.sniffedBytes = sniffBuffer.length;

              if (isBinary(sniffBuffer)) {
                state.isStreamingRawContent = false;
                state.onOutputEvent({ type: 'binary_detected' });
              }
            }

            if (state.isStreamingRawContent) {
              const decodedChunk = state.decoder.decode(data, { stream: true });
              if (decodedChunk.length === 0) {
                res();
                return;
              }
              state.isWriting = true;
              state.headlessTerminal.write(decodedChunk, () => {
                render();
                state.isWriting = false;
                res();
              });
            } else {
              const totalBytes = state.outputChunks.reduce(
                (sum, chunk) => sum + chunk.length,
                0,
              );
              state.onOutputEvent({
                type: 'binary_progress',
                bytesReceived: totalBytes,
              });
              res();
            }
          }),
      );
      // Prevent unhandled rejection warnings; errors are caught later
      // by the Promise.race in onExit.
      state.processingChain.catch(() => {});
    };

    state.activePtyEntry.onDataDisposable = state.ptyProcess.onData((data: string) => {
      const bufferData = Buffer.from(data, 'utf-8');
      handleOutput(bufferData);
    });
  }

  private static registerPtyExitHandler(
    state: PtyExecState,
    resolveResult: (resultValue: ShellExecutionResult) => void,
    abortHandler: () => void,
  ): void {
    const finalizeResult = (exitCode: number, signal?: number | null) => {
      this.ptyRenderFn(state);
      resolveResult(buildPtyResult(state, exitCode, signal ?? null, state.abortSignal.aborted));
    };

    state.activePtyEntry.onExitDisposable = state.ptyProcess.onExit(
      ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        state.exitedRef.value = true;
        state.abortSignal.removeEventListener('abort', abortHandler);

        if (state.abortSignal.aborted) {
          finalizeResult(exitCode, signal ?? null);
          return;
        }

        const processingComplete = state.processingChain.then(() => 'processed');
        let raceAbortListener: (() => void) | null = null;

        const cleanupRaceListener = () => {
          if (raceAbortListener) {
            state.abortSignal.removeEventListener('abort', raceAbortListener);
            raceAbortListener = null;
          }
        };

        const abortFired = new Promise<'aborted'>((res) => {
          if (state.abortSignal.aborted) {
            res('aborted');
            return;
          }
          raceAbortListener = () => res('aborted');
          state.abortSignal.addEventListener('abort', raceAbortListener, {
            once: true,
          });
        });

        Promise.race([processingComplete, abortFired])
          .then(() => {
            cleanupRaceListener();
            finalizeResult(exitCode, signal ?? null);
          })
          .catch(() => {
            cleanupRaceListener();
            finalizeResult(exitCode, signal ?? null);
          });
      },
    );
  }

  // eslint-disable-next-line class-methods-use-this -- Preserved as static per existing pattern.
  private static ptyRenderFn(state: PtyExecState): void {
    state.activePtyEntry.renderTimeout = undefined;

    if (!state.isStreamingRawContent) {
      shellDebug.log('renderFn: skipped (not streaming raw content)');
      return;
    }

    if (
      state.shellExecutionConfig.disableDynamicLineTrimming !== true &&
      !state.hasStartedOutput
    ) {
      const bufferText = getFullBufferText(state.headlessTerminal);
      if (bufferText.trim().length === 0) {
        shellDebug.log('renderFn: skipped (no output yet)');
        return;
      }
      state.hasStartedOutput = true;
    }

    const buffer = state.headlessTerminal.buffer.active;
    const newOutput = serializeTerminalForRender(
      state.headlessTerminal,
      state.shellExecutionConfig.showColor,
    );

    const lastNonEmptyLine = findLastNonEmptyLineIndex(newOutput, buffer.cursorY);
    const trimmedOutput = newOutput.slice(0, lastNonEmptyLine + 1);

    const finalOutput =
      state.shellExecutionConfig.disableDynamicLineTrimming === true
        ? newOutput
        : trimmedOutput;

    maybeEmitRenderedOutput(state, finalOutput, buffer);
  }

  // eslint-disable-next-line sonarjs/no-identical-functions -- Keep local closure state for child-process and PTY inactivity timers; extracting would change cleanup semantics.
  private static setupPtyInactivityHandler(state: PtyExecState): void {
    const inactivityTimeoutMs = state.shellExecutionConfig.inactivityTimeoutMs;
    if (inactivityTimeoutMs === undefined || inactivityTimeoutMs <= 0) {
      return;
    }
    state.inactivityAbortController.signal.addEventListener(
      'abort',
      () => {
        void this.ptyInactivityAbortAction(state);
      },
      { once: true },
    );
    state.resetInactivityTimer();
  }

  private static async ptyInactivityAbortAction(state: PtyExecState): Promise<void> {
    // Preserve old truthiness semantics: skip pid 0 (invalid process ID)
    // Old code: if (ptyProcess.pid && !exited)
    if (state.ptyProcess.pid === 0 || state.exitedRef.value) {
      return;
    }
    const pid = state.ptyProcess.pid;
    if (state.isWindows) {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
      cpSpawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
      return;
    }
    try {
      process.kill(-pid, 'SIGTERM');
      await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      if (!state.exitedRef.value) {
        process.kill(-pid, 'SIGKILL');
      }
    } catch {
      // Process may have exited during race.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      if (!state.exitedRef.value) state.ptyProcess.kill('SIGKILL');
    }
  }

  private static setupPtyAbortHandler(
    state: PtyExecState,
    resolveResult: (resultValue: ShellExecutionResult) => void,
  ): () => void {
    const abortHandler = () => {
      void (async () => {
        // Preserve old truthiness semantics: skip pid 0 (invalid process ID)
        // Old code: if (ptyProcess.pid && !exited)
        if (
          state.ptyProcess.pid !== 0 &&
          !state.exitedRef.value
        ) {
          const pid = state.ptyProcess.pid;
          if (state.isWindows) {
            // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
            cpSpawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
            cleanupActivePtyEntry(
              state,
              ShellExecutionService.activePtys,
              () => ShellExecutionService.lastActivePtyId,
              (id) => { ShellExecutionService.lastActivePtyId = id; },
            );
            resolveResult(buildPtyResult(state, 1, null, true));
            return;
          }

          try {
            process.kill(-pid, 'SIGTERM');
          } catch {
            // Process may already be terminated.
          }
          try {
            state.ptyProcess.kill('SIGTERM');
          } catch {
            // PTY may already be terminated.
          }

          await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          if (state.exitedRef.value) {
            return;
          }

          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // Process may already be terminated.
          }
          try {
            state.ptyProcess.kill('SIGKILL');
          } catch {
            // PTY may already be terminated.
          }

          state.abortFinalizeTimeout = setTimeout(() => {
            resolveResult(buildPtyResult(state, 1, null, true));
          }, SIGKILL_TIMEOUT_MS);
        }
      })();
    };
    return abortHandler;
  }

  /**
   * Writes a string to the pseudo-terminal (PTY) of a running process.
   *
   * @param pid The process ID of the target PTY.
   * @param input The string to write to the terminal.
   */
  static writeToPty(pid: number, input: string): void {
    const activePty = this.activePtys.get(pid);
    if (activePty !== undefined) {
      activePty.ptyProcess.write(input);
      return;
    }

    const fallbackPtyId = this.lastActivePtyId;
    // Preserve old truthiness semantics: skip pid 0 (invalid process ID)
    // Old code: if (fallbackPtyId && ...)
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
      // process.kill with signal 0 is a way to check for the existence of a process.
      // It doesn't actually send a signal.
      return process.kill(pid, 0);
    } catch {
      // Process does not exist.
      return false;
    }
  }

  static isActivePty(pid: number): boolean {
    return this.activePtys.has(pid);
  }

  /**
   * Resizes the pseudo-terminal (PTY) of a running process.
   *
   * @param pid The process ID of the target PTY.
   * @param cols The new number of columns.
   * @param rows The new number of rows.
   */
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
    return this.lastActivePtyId;
  }

  /**
   * Terminates the pseudo-terminal (PTY) process.
   *
   * @param pid The process ID of the target PTY.
   */
  static terminatePty(pid: number): void {
    const activePty = this.activePtys.get(pid);
    if (!activePty) {
      return;
    }

    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Process may already be terminated.
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
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Process may already be terminated.
      }
      try {
        activePty.ptyProcess.kill('SIGKILL');
      } catch {
        // PTY may already be terminated.
      }
    }, SIGKILL_TIMEOUT_MS);
  }

  /**
   * Scrolls the pseudo-terminal (PTY) of a running process.
   *
   * @param pid The process ID of the target PTY.
   * @param lines The number of lines to scroll.
   */
  static scrollPty(pid: number, lines: number): void {
    const activePty = this.activePtys.get(pid);
    const fallbackPtyId = this.lastActivePtyId;
    let targetPty: { id: number; pty: ActivePty | undefined } | undefined;

    if (activePty !== undefined) {
      targetPty = { id: pid, pty: activePty };
    } else if (fallbackPtyId !== null && fallbackPtyId !== 0) {
      // Preserve old truthiness semantics: skip pid 0 (invalid process ID)
      targetPty = {
        id: fallbackPtyId,
        pty: this.activePtys.get(fallbackPtyId),
      };
    }

    if (targetPty?.pty === undefined) {
      return;
    }

    try {
      targetPty.pty.headlessTerminal.scrollLines(lines);
      if (targetPty.pty.headlessTerminal.buffer.active.viewportY < 0) {
        targetPty.pty.headlessTerminal.scrollToTop();
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
    this.lastActivePtyId = null;
  }

  /**
   * Sanitizes environment variables to prevent credential leaks in sandbox/CI environments.
   * Uses an allowlist approach: only known-safe variables are forwarded.
   *
   * @param env The environment variables to sanitize
   * @param isSandboxOrCI Whether running in sandbox or CI mode (true = sanitize, false = pass through all)
   * @param allowlist Optional array of additional variable names to allow
   * @returns Sanitized environment variables
   */
  static sanitizeEnvironment(
    env: NodeJS.ProcessEnv,
    isSandboxOrCI: boolean,
    allowlist?: string[],
  ): NodeJS.ProcessEnv {
    // In local dev mode (not sandbox/CI), pass through all env vars unchanged
    if (!isSandboxOrCI) {
      return { ...env };
    }

    const SAFE_VARS = new Set([
      // Cross-platform
      'PATH',
      // Windows
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
      // Unix
      'HOME',
      'LANG',
      'SHELL',
      'TMPDIR',
      'USER',
      'LOGNAME',
      // Terminal
      'TERM',
      'PAGER',
      // GitHub Actions-related variables
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
        SAFE_VARS.add(name);
      }
    }

    const result: NodeJS.ProcessEnv = {};

    for (const [key, value] of Object.entries(env)) {
      // Allow all LLxprt-related environment variables and secrets (LLXPRT_*)
      if (SAFE_VARS.has(key) || /^LLXPRT_/.test(key)) {
        result[key] = value;
      }
    }

    return result;
  }
}
