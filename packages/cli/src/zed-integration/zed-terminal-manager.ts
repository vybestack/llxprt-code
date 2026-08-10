/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type { DebugLogger } from '@vybestack/llxprt-code-core';
import {
  getShellConfiguration,
  isWithinRoot,
} from '@vybestack/llxprt-code-core';
import type { AgentToolCall } from '@vybestack/llxprt-code-agents';
import type {
  ShellExecutionResult,
  ShellOutputEvent,
} from '@vybestack/llxprt-code-tools';
import type {
  ByteBudget,
  TruncationMetadata,
} from '@vybestack/llxprt-code-tools/acquisition.js';
import {
  computeBoundedDelta,
  boundSnapshotBytes,
  TERMINAL_DISCONTINUITY_NOTICE,
} from './terminalOutputDelta.js';

const OUTPUT_POLL_INTERVAL_MS = 100;
const KILL_GRACE_PERIOD_MS = 5000;

type SendUpdateFn = (update: acp.SessionUpdate) => Promise<void>;

interface PendingShellCall {
  readonly id: string;
  readonly command: string;
  readonly cwd: string;
}

interface ActiveTerminal {
  readonly handle: acp.TerminalHandle;
  readonly command: string;
  readonly cwd: string;
  toolCallId: string | undefined;
}

interface TerminalWaitState {
  exit: acp.WaitForTerminalExitResponse | undefined;
  exitError: unknown;
  previousOutput: string;
  killed: boolean;
  killDeadline: number;
  evictionNoticeEmitted: boolean;
  maxObservedBytes: number;
}

function terminalWaitDone(state: TerminalWaitState): boolean {
  return (
    state.exit !== undefined ||
    state.exitError !== undefined ||
    (state.killed && Date.now() >= state.killDeadline)
  );
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TerminalManager {
  private readonly pendingCalls: PendingShellCall[] = [];
  private readonly activeTerminals = new Set<ActiveTerminal>();

  constructor(
    private readonly sessionId: string,
    private readonly connection: acp.AgentSideConnection,
    private readonly targetDir: string,
    private readonly sendUpdate: SendUpdateFn,
    private readonly logger: DebugLogger,
    /** Validated byte budget resolved at the ACP integration boundary. */
    private readonly outputBudget: ByteBudget,
  ) {}

  static isShellToolCall(
    call: AgentToolCall,
    kind: string | undefined,
  ): boolean {
    return kind === 'execute' && typeof call.args['command'] === 'string';
  }

  async observeToolCall(call: AgentToolCall): Promise<void> {
    const command = readCommand(call);
    if (command === null) {
      return;
    }
    const pending: PendingShellCall = {
      id: call.id,
      command,
      cwd: resolveCallCwd(call, this.targetDir),
    };
    const active = [...this.activeTerminals].find(
      (terminal) =>
        terminal.toolCallId === undefined &&
        terminal.cwd === pending.cwd &&
        commandsMatch(terminal.command, pending.command),
    );
    if (active === undefined) {
      this.pendingCalls.push(pending);
      return;
    }
    active.toolCallId = pending.id;
    try {
      await this.sendTerminalUpdate(active);
    } catch (error) {
      active.toolCallId = undefined;
      throw error;
    }
  }

  completeToolCall(toolCallId: string): void {
    const pendingIndex = this.pendingCalls.findIndex(
      (pending) => pending.id === toolCallId,
    );
    if (pendingIndex >= 0) {
      this.pendingCalls.splice(pendingIndex, 1);
    }
    for (const terminal of this.activeTerminals) {
      if (terminal.toolCallId === toolCallId) {
        terminal.toolCallId = undefined;
      }
    }
  }

  async executeShellCommand(
    command: string,
    cwd: string,
    onOutput: (event: ShellOutputEvent) => void,
    signal: AbortSignal,
  ): Promise<ShellExecutionResult> {
    if (signal.aborted) {
      return abortedResult();
    }
    if (command.trim().length === 0) {
      throw new Error('Shell command must not be empty');
    }
    const shell = getShellConfiguration();
    const handle = await this.connection.createTerminal({
      command: shell.executable,
      args: [...shell.argsPrefix, command],
      cwd,
      sessionId: this.sessionId,
      outputByteLimit: this.outputBudget.bytes,
    });
    const active: ActiveTerminal = {
      handle,
      command,
      cwd,
      toolCallId: undefined,
    };
    let registered = false;
    try {
      active.toolCallId = this.claimPendingCall(command, cwd);
      this.activeTerminals.add(active);
      registered = true;
      if (active.toolCallId !== undefined) {
        await this.sendTerminalUpdate(active);
      }
      return await this.waitForTerminal(active, onOutput, signal);
    } catch (error) {
      if (this.activeTerminals.delete(active) || !registered) {
        await this.killAndRelease(active);
      }
      throw error;
    } finally {
      if (this.activeTerminals.delete(active)) {
        await this.release(active);
      }
    }
  }

  async settleAll(): Promise<void> {
    this.pendingCalls.splice(0);
    const terminals = [...this.activeTerminals];
    this.activeTerminals.clear();
    await Promise.allSettled(terminals.map((t) => this.killAndRelease(t)));
  }

  private claimPendingCall(command: string, cwd: string): string | undefined {
    const index = this.pendingCalls.findIndex(
      (pending) =>
        pending.cwd === cwd && commandsMatch(command, pending.command),
    );
    if (index < 0) {
      return undefined;
    }
    return this.pendingCalls.splice(index, 1)[0]?.id;
  }

  private async sendTerminalUpdate(active: ActiveTerminal): Promise<void> {
    if (active.toolCallId === undefined) {
      return;
    }
    await this.sendUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: active.toolCallId,
      status: 'in_progress',
      content: [{ type: 'terminal', terminalId: active.handle.id }],
    });
  }

  private async waitForTerminal(
    active: ActiveTerminal,
    onOutput: (event: ShellOutputEvent) => void,
    signal: AbortSignal,
  ): Promise<ShellExecutionResult> {
    const state: TerminalWaitState = {
      exit: undefined,
      exitError: undefined,
      previousOutput: '',
      killed: false,
      killDeadline: 0,
      evictionNoticeEmitted: false,
      maxObservedBytes: 0,
    };
    const exitPromise = this.observeTerminalExit(active, state);
    while (!terminalWaitDone(state)) {
      await this.applyAbort(active, state, signal);
      if (!terminalWaitDone(state)) {
        await this.pollTerminal(active, state, onOutput, exitPromise);
      }
    }
    const finalEviction = await this.finishTerminalOutput(
      active,
      state,
      onOutput,
    );
    return this.buildTerminalResult(state, finalEviction, signal);
  }

  private async observeTerminalExit(
    active: ActiveTerminal,
    state: TerminalWaitState,
  ): Promise<void> {
    try {
      state.exit = await active.handle.waitForExit();
    } catch (error) {
      state.exitError = error;
    }
  }

  private async applyAbort(
    active: ActiveTerminal,
    state: TerminalWaitState,
    signal: AbortSignal,
  ): Promise<void> {
    if (!signal.aborted || state.killed) {
      return;
    }
    state.killed = true;
    state.killDeadline = Date.now() + KILL_GRACE_PERIOD_MS;
    await this.kill(active);
  }

  private async pollTerminal(
    active: ActiveTerminal,
    state: TerminalWaitState,
    onOutput: (event: ShellOutputEvent) => void,
    exitPromise: Promise<void>,
  ): Promise<void> {
    const pollDelay = delay(OUTPUT_POLL_INTERVAL_MS);
    try {
      // Exit only short-circuits this polling delay. finishTerminalOutput() still
      // performs the authoritative final output poll after the wait resolves.
      await Promise.race([exitPromise, pollDelay.promise]);
    } finally {
      pollDelay.cancel();
    }
    let current: acp.TerminalOutputResponse;
    try {
      current = await active.handle.currentOutput();
    } catch (error) {
      this.logger.debug(
        () => `Terminal output poll failed: ${errorMessage(error)}`,
      );
      throw error;
    }
    this.applyTerminalSnapshot(state, current, onOutput);
  }

  private applyTerminalSnapshot(
    state: TerminalWaitState,
    current: acp.TerminalOutputResponse,
    onOutput: (event: ShellOutputEvent) => void,
  ): void {
    const observedNow = Buffer.byteLength(current.output, 'utf8');
    if (observedNow > this.outputBudget.bytes) {
      throw new Error(
        `Terminal peer exceeded output byte budget (${this.outputBudget.bytes} bytes)`,
      );
    }
    state.maxObservedBytes = Math.max(state.maxObservedBytes, observedNow);
    const { delta, discontinuity } = computeBoundedDelta(
      state.previousOutput,
      current.output,
      current.truncated,
    );
    let streamedDelta = delta;
    if (discontinuity) {
      const deltaContainsNotice = streamedDelta.startsWith(
        TERMINAL_DISCONTINUITY_NOTICE,
      );
      if (!state.evictionNoticeEmitted) {
        if (!deltaContainsNotice) {
          onOutput({ type: 'data', chunk: TERMINAL_DISCONTINUITY_NOTICE });
        }
        state.evictionNoticeEmitted = true;
      } else if (deltaContainsNotice) {
        streamedDelta = streamedDelta.slice(
          TERMINAL_DISCONTINUITY_NOTICE.length,
        );
      }
    }
    if (streamedDelta !== '') {
      onOutput({ type: 'data', chunk: streamedDelta });
    }
    state.previousOutput = boundSnapshotBytes(
      current.output,
      this.outputBudget.bytes,
    );
  }

  private async finishTerminalOutput(
    active: ActiveTerminal,
    state: TerminalWaitState,
    onOutput: (event: ShellOutputEvent) => void,
  ): Promise<boolean> {
    let finalEviction = state.evictionNoticeEmitted;
    if (state.exitError === undefined) {
      const finalPollEviction = await this.pollFinalOutput(
        active,
        state,
        onOutput,
      );
      finalEviction ||= finalPollEviction;
    }
    if (state.exitError !== undefined) {
      throw state.exitError;
    }
    return finalEviction;
  }

  private buildTerminalResult(
    state: TerminalWaitState,
    finalEviction: boolean,
    signal: AbortSignal,
  ): ShellExecutionResult {
    const retainedBytes = Buffer.byteLength(state.previousOutput, 'utf8');
    const omittedBytes = Math.max(0, state.maxObservedBytes - retainedBytes);
    const output =
      finalEviction &&
      !state.previousOutput.startsWith(TERMINAL_DISCONTINUITY_NOTICE)
        ? TERMINAL_DISCONTINUITY_NOTICE + state.previousOutput
        : state.previousOutput;
    const outputTruncation: TruncationMetadata | undefined =
      omittedBytes > 0
        ? {
            observedBytes: state.maxObservedBytes,
            retainedBytes,
            omittedBytes,
            truncated: true,
            budgetBytes: this.outputBudget.bytes,
          }
        : undefined;
    return {
      output,
      exitCode: state.exit?.exitCode ?? null,
      signal: state.exit?.signal ?? null,
      error: null,
      aborted: signal.aborted,
      pid: undefined,
      outputTruncation,
    };
  }

  private async pollFinalOutput(
    active: ActiveTerminal,
    state: TerminalWaitState,
    onOutput: (event: ShellOutputEvent) => void,
  ): Promise<boolean> {
    let final: acp.TerminalOutputResponse | undefined;
    try {
      final = await withTimeout(
        active.handle.currentOutput(),
        OUTPUT_POLL_INTERVAL_MS * 5,
      );
    } catch (error) {
      this.logger.debug(
        () => `Terminal post-exit output poll failed: ${errorMessage(error)}`,
      );
      return false;
    }
    if (final === undefined) {
      return false;
    }
    const hadEviction = state.evictionNoticeEmitted;
    this.applyTerminalSnapshot(state, final, onOutput);
    return !hadEviction && state.evictionNoticeEmitted;
  }

  private async killAndRelease(active: ActiveTerminal): Promise<void> {
    await this.kill(active);
    await this.release(active);
  }

  private async kill(active: ActiveTerminal): Promise<void> {
    try {
      await active.handle.kill();
    } catch (error) {
      this.logger.debug(() => `Terminal kill failed: ${errorMessage(error)}`);
    }
  }

  private async release(active: ActiveTerminal): Promise<void> {
    try {
      await active.handle.release();
    } catch (error) {
      this.logger.debug(
        () => `Terminal release failed: ${errorMessage(error)}`,
      );
    }
  }
}

function readCommand(call: AgentToolCall): string | null {
  const command = call.args['command'];
  return typeof command === 'string' && command.trim() !== '' ? command : null;
}

function resolveCallCwd(call: AgentToolCall, targetDir: string): string {
  const dirPath = call.args['dir_path'];
  const directory = call.args['directory'];
  let value = '';
  if (typeof dirPath === 'string') {
    value = dirPath;
  } else if (typeof directory === 'string') {
    value = directory;
  }
  if (value === '') {
    return targetDir;
  }
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(targetDir, value);
  if (!isWithinRoot(resolved, targetDir)) {
    throw new Error(
      `Shell tool cwd resolves outside the session root: ${value}`,
    );
  }
  return resolved;
}

const TRAP_LINE_PREFIX = 'trap ';
const TRAP_LINE_SUFFIX = ' EXIT';
const TRAP_ACTION_PREFIX = '__code=$?; pgrep -g 0 >';
const TRAP_ACTION_SUFFIX = ' 2>&1; exit $__code';

function commandsMatch(preparedCommand: string, rawCommand: string): boolean {
  // ShellExecutionService wraps commands in an EXIT trap whose body is the
  // trimmed raw command verbatim. Correlate by exact equality: either the
  // prepared command is already the unwrapped raw command, or it is a
  // canonically generated wrapper whose extracted body equals rawCommand.trim().
  const trimmed = rawCommand.trim();
  if (preparedCommand === trimmed) {
    return true;
  }
  return extractGeneratedWrapperBody(preparedCommand) === trimmed;
}

/**
 * Recognizes a canonical singleQuoteForShell token at the start of `input` and
 * returns its decoded value plus the unconsumed remainder. Decoding mirrors the
 * escaped-quote sequence the wrapper emits, then requires re-encoding equality
 * (via the shared singleQuoteForShell) so only a canonically generated token is
 * accepted.
 */
function matchCanonicalSingleQuoted(
  input: string,
): { decoded: string; rest: string } | null {
  if (!input.startsWith("'")) {
    return null;
  }
  let i = 1;
  let decoded = '';
  let closed = false;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "'") {
      if (input.slice(i, i + 4) === "'\\''") {
        decoded += "'";
        i += 4;
      } else {
        closed = true;
        break;
      }
    } else {
      decoded += ch;
      i += 1;
    }
  }
  if (!closed) {
    return null;
  }
  const token = input.slice(0, i + 1);
  const reencoded = `'${decoded.split("'").join("'\\''")}'`;
  return reencoded === token ? { decoded, rest: input.slice(i + 1) } : null;
}

/**
 * Confirms a decoded trap action is exactly the generated form:
 * TRAP_ACTION_PREFIX + one canonical singleQuoteForShell path token +
 * TRAP_ACTION_SUFFIX.
 */
function isCanonicalTrapAction(action: string): boolean {
  if (
    !action.startsWith(TRAP_ACTION_PREFIX) ||
    !action.endsWith(TRAP_ACTION_SUFFIX)
  ) {
    return false;
  }
  const pathToken = action.slice(
    TRAP_ACTION_PREFIX.length,
    action.length - TRAP_ACTION_SUFFIX.length,
  );
  const matched = matchCanonicalSingleQuoted(pathToken);
  // The path slot must be EXACTLY one canonical token: no trailing content may
  // remain after it, so a same-prefix/suffix trap with extra action content is
  // treated as non-canonical and left unmatched.
  return matched !== null && matched.rest === '';
}

/**
 * Extracts the body of a canonically generated wrapper, or null if the prepared
 * command is not the generated wrapper form. The wrapper is
 * `trap '<quotedAction>' EXIT` followed by a newline and the trimmed body. The
 * action token may contain a literal newline (e.g. a temp path with a line
 * break), so it is decoded from the entire suffix after `trap ` rather than
 * truncated at the first newline; the remainder must then begin exactly with
 * TRAP_LINE_SUFFIX plus a newline.
 */
function extractGeneratedWrapperBody(preparedCommand: string): string | null {
  if (!preparedCommand.startsWith(TRAP_LINE_PREFIX)) {
    return null;
  }
  const afterPrefix = preparedCommand.slice(TRAP_LINE_PREFIX.length);
  const actionToken = matchCanonicalSingleQuoted(afterPrefix);
  if (actionToken === null) {
    return null;
  }
  const bodyDelimiter = TRAP_LINE_SUFFIX + String.fromCharCode(10);
  if (!actionToken.rest.startsWith(bodyDelimiter)) {
    return null;
  }
  if (!isCanonicalTrapAction(actionToken.decoded)) {
    return null;
  }
  return actionToken.rest.slice(bodyDelimiter.length);
}

function abortedResult(): ShellExecutionResult {
  return {
    output: '',
    exitCode: null,
    signal: null,
    error: null,
    aborted: true,
    pid: undefined,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T | undefined> {
  const timeout = delay(milliseconds);
  try {
    return await Promise.race([promise, timeout.promise.then(() => undefined)]);
  } finally {
    timeout.cancel();
  }
}

function delay(milliseconds: number): {
  promise: Promise<void>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
