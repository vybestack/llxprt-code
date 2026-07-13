/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type { DebugLogger } from '@vybestack/llxprt-code-core';
import { getShellConfiguration } from '@vybestack/llxprt-code-core';
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
      toolCallId: this.claimPendingCall(command, cwd),
    };
    this.activeTerminals.add(active);
    try {
      if (active.toolCallId !== undefined) {
        await this.sendTerminalUpdate(active);
      }
      return await this.waitForTerminal(active, onOutput, signal);
    } catch (error) {
      if (this.activeTerminals.delete(active)) {
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
      if (exitError !== undefined) {
        throw exitError;
      }
      if (signal.aborted && !killed) {
        killed = true;
        killDeadline = Date.now() + KILL_GRACE_PERIOD_MS;
        await this.kill(active);
      }
      done = exit !== undefined || (killed && Date.now() >= killDeadline);
      if (done) {
        continue;
      }
      await Promise.race([exitPromise, delay(OUTPUT_POLL_INTERVAL_MS)]);
      const current = await active.handle.currentOutput();
      const chunk = outputDelta(previousOutput, current.output);
      if (chunk !== '') {
        onOutput({ type: 'data', chunk });
      }
      previousOutput = current.output;
    }
    // Final poll after exit settles so output produced between the last poll
    // and process exit is never lost.
    if (exit !== undefined) {
      try {
        const final = await active.handle.currentOutput();
        const finalDelta = outputDelta(previousOutput, final.output);
        if (finalDelta !== '') {
          onOutput({ type: 'data', chunk: finalDelta });
        }
        previousOutput = final.output;
      } catch {
        // Swallow transient poll errors after exit.
      }
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
  return path.isAbsolute(value) ? value : path.resolve(targetDir, value);
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

function outputDelta(previous: string, current: string): string {
  return current.startsWith(previous)
    ? current.slice(previous.length)
    : current;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
