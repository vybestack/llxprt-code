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

const OUTPUT_POLL_INTERVAL_MS = 100;
const APPROXIMATE_BYTES_PER_TOKEN = 4;
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
    private readonly maxOutputTokens?: number,
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
    const shell = getShellConfiguration();
    const handle = await this.connection.createTerminal({
      command: shell.executable,
      args: [...shell.argsPrefix, command],
      cwd,
      sessionId: this.sessionId,
      ...(this.maxOutputTokens === undefined
        ? {}
        : {
            outputByteLimit: this.maxOutputTokens * APPROXIMATE_BYTES_PER_TOKEN,
          }),
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
    let exit: acp.WaitForTerminalExitResponse | undefined;
    let exitError: unknown;
    const exitPromise = active.handle
      .waitForExit()
      .then((result) => {
        exit = result;
      })
      .catch((error: unknown) => {
        exitError = error;
      });
    let previousOutput = '';
    let killed = false;
    let killDeadline = 0;
    let done = false;
    while (!done) {
      if (signal.aborted && !killed) {
        killed = true;
        killDeadline = Date.now() + KILL_GRACE_PERIOD_MS;
        await this.kill(active);
      }
      done =
        exit !== undefined ||
        exitError !== undefined ||
        (killed && Date.now() >= killDeadline);
      if (!done) {
        const pollDelay = delay(OUTPUT_POLL_INTERVAL_MS);
        try {
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
          break;
        }
        const chunk = outputDelta(
          previousOutput,
          current.output,
          current.truncated,
        );
        if (chunk !== '') {
          onOutput({ type: 'data', chunk });
        }
        previousOutput = current.output;
      }
    }
    previousOutput = await this.pollFinalOutput(
      active,
      previousOutput,
      onOutput,
    );
    if (exitError !== undefined) {
      throw exitError;
    }
    return {
      output: previousOutput,
      exitCode: exit?.exitCode ?? null,
      signal: exit?.signal ?? null,
      error: null,
      aborted: signal.aborted,
      pid: undefined,
    };
  }

  private async pollFinalOutput(
    active: ActiveTerminal,
    previousOutput: string,
    onOutput: (event: ShellOutputEvent) => void,
  ): Promise<string> {
    try {
      const final = await withTimeout(
        active.handle.currentOutput(),
        OUTPUT_POLL_INTERVAL_MS * 5,
      );
      if (final === undefined) {
        return previousOutput;
      }
      const chunk = outputDelta(previousOutput, final.output, final.truncated);
      if (chunk !== '') {
        onOutput({ type: 'data', chunk });
      }
      return final.output;
    } catch (error) {
      this.logger.debug(
        () => `Terminal post-exit output poll failed: ${errorMessage(error)}`,
      );
      return previousOutput;
    }
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

function commandsMatch(preparedCommand: string, rawCommand: string): boolean {
  const trimmed = rawCommand.trim();
  if (preparedCommand === trimmed) {
    return true;
  }
  const terminated =
    trimmed.endsWith('&') || trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  return preparedCommand.startsWith(`{ ${terminated} }; __code=$?;`);
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

function outputDelta(
  previous: string,
  current: string,
  truncated: boolean,
): string {
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }
  if (!truncated) {
    return current;
  }
  for (
    let overlap = Math.min(previous.length, current.length);
    overlap > 0;
    overlap--
  ) {
    if (previous.endsWith(current.slice(0, overlap))) {
      return current.slice(overlap);
    }
  }
  return current;
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
