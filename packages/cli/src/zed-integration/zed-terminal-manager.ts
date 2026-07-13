/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import type { DebugLogger } from '@vybestack/llxprt-code-core';
import type { AgentToolCall } from '@vybestack/llxprt-code-agents';

interface PendingShellCall {
  readonly toolCallId: string;
  readonly command: string;
  readonly cwd: string;
}

type SendUpdateFn = (update: acp.SessionUpdate) => Promise<void>;

/**
 * Manages ACP terminal lifecycle for a single Zed session.
 *
 * When the client advertises the `terminal` capability, shell tool-calls
 * trigger terminal creation via `connection.createTerminal`.  Each terminal
 * is correlated to its tool-call (by command/cwd matching) so that terminal
 * content can be emitted inline and terminals are cleaned up on completion,
 * cancel, and dispose.
 */
export class TerminalManager {
  private readonly activeTerminals = new Map<string, acp.TerminalHandle>();
  private readonly pendingShellCalls: PendingShellCall[] = [];

  constructor(
    private readonly sessionId: string,
    private readonly connection: acp.AgentSideConnection,
    private readonly targetDir: string,
    private readonly sendUpdate: SendUpdateFn,
    private readonly logger: DebugLogger,
  ) {}

  /**
   * Returns `true` if the tool-call is an execute-kind shell command that
   * should trigger terminal creation.
   */
  static isShellToolCall(
    call: AgentToolCall,
    kind: string | undefined,
  ): boolean {
    return kind === 'execute' && typeof call.args['command'] === 'string';
  }

  /**
   * Records a pending shell tool-call and creates an ACP terminal for it.
   * Emits an early terminal-content update so the client renders the terminal
   * inline during execution.
   */
  async handleToolCall(call: AgentToolCall): Promise<void> {
    const command =
      typeof call.args['command'] === 'string' ? call.args['command'] : '';
    if (command === '') return;
    const cwd =
      typeof call.args['dir_path'] === 'string'
        ? call.args['dir_path']
        : this.targetDir;
    this.pendingShellCalls.push({ toolCallId: call.id, command, cwd });
    try {
      const handle = await this.connection.createTerminal({
        command,
        cwd,
        sessionId: this.sessionId,
        args: ['-c', command],
      });
      await this.registerTerminal(command, cwd, handle);
    } catch (error) {
      this.logger.debug(() => `Failed to create ACP terminal: ${error}`);
    }
  }

  /**
   * Correlates a created terminal to its tool-call by matching command/cwd,
   * records the handle, and emits the terminal-content update.
   */
  async registerTerminal(
    command: string,
    cwd: string,
    handle: acp.TerminalHandle,
  ): Promise<void> {
    const match = this.pendingShellCalls.find(
      (entry) => entry.command === command && entry.cwd === cwd,
    );
    if (match === undefined) return;
    this.activeTerminals.set(match.toolCallId, handle);
    await this.sendUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: match.toolCallId,
      status: 'in_progress',
      content: [{ type: 'terminal', terminalId: handle.id }],
    });
  }

  /**
   * Releases a terminal after its tool call has completed.  Safe to call
   * multiple times — the handle is removed on first call.
   */
  async releaseTerminal(toolCallId: string): Promise<void> {
    const handle = this.activeTerminals.get(toolCallId);
    if (handle === undefined) return;
    this.activeTerminals.delete(toolCallId);
    const idx = this.pendingShellCalls.findIndex(
      (entry) => entry.toolCallId === toolCallId,
    );
    if (idx >= 0) this.pendingShellCalls.splice(idx, 1);
    try {
      await handle.release();
    } catch (error) {
      this.logger.debug(() => `Terminal release failed: ${error}`);
    }
  }

  /**
   * Kills and releases all active terminals.  Called on cancel and dispose
   * so no terminal is leaked.
   */
  async settleAll(): Promise<void> {
    const entries = [...this.activeTerminals.entries()];
    this.activeTerminals.clear();
    await Promise.allSettled(
      entries.map(async ([, handle]) => {
        try {
          await handle.kill();
        } catch (error) {
          this.logger.debug(() => `Terminal kill failed: ${error}`);
        }
        try {
          await handle.release();
        } catch (error) {
          this.logger.debug(() => `Terminal release failed: ${error}`);
        }
      }),
    );
  }
}
