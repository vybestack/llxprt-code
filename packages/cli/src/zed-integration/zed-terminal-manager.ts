/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import type { DebugLogger } from '@vybestack/llxprt-code-core';
import type { AgentToolCall } from '@vybestack/llxprt-code-agents';

type TerminalHandleLike = Pick<acp.TerminalHandle, 'id' | 'kill' | 'release'>;

type SendUpdateFn = (update: acp.SessionUpdate) => Promise<void>;

/**
 * Manages ACP terminal lifecycle for a single Zed session.
 *
 * When the client advertises the `terminal` capability, shell tool-calls
 * trigger terminal creation via `connection.createTerminal`.  Each terminal
 * is correlated to its tool-call by `toolCallId` so that terminal content can
 * be emitted inline and terminals are cleaned up on completion, cancel, and
 * dispose.
 */
export class TerminalManager {
  private readonly activeTerminals = new Map<string, TerminalHandleLike>();

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
   * Creates an ACP terminal for a shell tool-call and immediately correlates
   * it by `toolCallId`.  Emits a terminal-content update so the client renders
   * the terminal inline during execution.
   */
  async handleToolCall(call: AgentToolCall): Promise<void> {
    const command =
      typeof call.args['command'] === 'string' ? call.args['command'] : '';
    if (command === '') return;
    const cwd =
      typeof call.args['dir_path'] === 'string'
        ? call.args['dir_path']
        : this.targetDir;
    try {
      const handle = await this.connection.createTerminal({
        command,
        cwd,
        sessionId: this.sessionId,
        args: ['-c', command],
      });
      this.activeTerminals.set(call.id, handle);
      await this.sendUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: call.id,
        status: 'in_progress',
        content: [{ type: 'terminal', terminalId: handle.id }],
      });
    } catch (error) {
      this.logger.debug(() => `Failed to create ACP terminal: ${error}`);
    }
  }

  /**
   * Releases a terminal after its tool call has completed.  Safe to call
   * multiple times — the handle is removed on first call.
   */
  async releaseTerminal(toolCallId: string): Promise<void> {
    const handle = this.activeTerminals.get(toolCallId);
    if (handle === undefined) return;
    this.activeTerminals.delete(toolCallId);
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
