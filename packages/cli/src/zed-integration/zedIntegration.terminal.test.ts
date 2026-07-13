/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import type { Config } from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';

import { Session } from './zedIntegration.js';
import {
  buildFakeAgent,
  buildBlockingFakeAgent,
  RecordingConnection,
  buildMinimalConfig,
} from './zed-test-helpers.js';

const createdSessions: Session[] = [];

async function disposeCreatedSessions(): Promise<void> {
  await Promise.allSettled(
    createdSessions.splice(0).map(async (session) => {
      try {
        await session.dispose();
      } catch {
        // Continue disposing remaining sessions even if one fails
      }
    }),
  );
}

function createTerminalSession(
  events: readonly AgentEvent[],
  connection: RecordingConnection,
  config: Config = buildMinimalConfig(),
  terminalEnabled = true,
): Session {
  const { agent } = buildFakeAgent(events, { run_shell_command: 'execute' });
  return new Session(
    'test-session-id',
    agent,
    config,
    connection as unknown as acp.AgentSideConnection,
    false,
    terminalEnabled,
  );
}

function createBlockingTerminalSession(
  events: readonly AgentEvent[],
  connection: RecordingConnection,
  config: Config = buildMinimalConfig(),
  terminalEnabled = true,
): Session {
  const { agent } = buildBlockingFakeAgent(events, {
    run_shell_command: 'execute',
  });
  return new Session(
    'test-session-id',
    agent,
    config,
    connection as unknown as acp.AgentSideConnection,
    false,
    terminalEnabled,
  );
}

function shellToolCallEvent(toolCallId: string, command: string): AgentEvent {
  return {
    type: 'tool-call',
    call: {
      id: toolCallId,
      name: 'run_shell_command',
      args: { command },
    },
  };
}

function shellToolStatusEvent(toolCallId: string): AgentEvent {
  return {
    type: 'tool-status',
    update: {
      id: toolCallId,
      name: 'run_shell_command',
      status: 'executing',
    },
  };
}

function shellToolResultEvent(toolCallId: string, output: string): AgentEvent {
  return {
    type: 'tool-result',
    result: {
      id: toolCallId,
      name: 'run_shell_command',
      output,
    },
  };
}

const doneEvent: AgentEvent = { type: 'done', reason: 'stop' };

describe('Zed Session — terminal capability integration', () => {
  afterEach(disposeCreatedSessions);

  describe('terminal-enabled sessions', () => {
    it('emits terminal content on shell tool calls when terminal capability is present', async () => {
      const toolCallId = 'shell-1';
      const connection = new RecordingConnection();
      connection.setTerminalOutput('hello');
      const session = createTerminalSession(
        [
          shellToolCallEvent(toolCallId, 'echo hello'),
          shellToolStatusEvent(toolCallId),
          shellToolResultEvent(toolCallId, 'hello'),
          doneEvent,
        ],
        connection,
      );
      createdSessions.push(session);

      await session.prompt({
        sessionId: 'test-session-id',
        prompt: [{ type: 'text', text: 'run echo' }],
      });

      const toolCallUpdates = connection
        .onlySessionUpdates()
        .filter(
          (
            u,
          ): u is Extract<acp.SessionUpdate, { sessionUpdate: 'tool_call' }> =>
            u.sessionUpdate === 'tool_call',
        );
      expect(toolCallUpdates).toHaveLength(1);
      expect(toolCallUpdates[0].kind).toBe('execute');

      const hasTerminalContent = connection.onlySessionUpdates().some((u) => {
        if (u.sessionUpdate !== 'tool_call_update') return false;
        const content = u.content ?? [];
        return content.some(
          (c): c is Extract<typeof c, { type: 'terminal' }> =>
            c.type === 'terminal',
        );
      });
      expect(hasTerminalContent).toBe(true);
    });

    it('creates a terminal via connection.createTerminal for shell commands', async () => {
      const toolCallId = 'shell-create';
      const connection = new RecordingConnection();
      connection.setTerminalOutput('file1\nfile2');
      const session = createTerminalSession(
        [
          shellToolCallEvent(toolCallId, 'ls'),
          shellToolResultEvent(toolCallId, 'file1\nfile2'),
          doneEvent,
        ],
        connection,
      );
      createdSessions.push(session);

      await session.prompt({
        sessionId: 'test-session-id',
        prompt: [{ type: 'text', text: 'list files' }],
      });

      expect(connection.createTerminalCalls).toHaveLength(1);
      const call = connection.createTerminalCalls[0];
      expect(call.command).toBe('ls');
      expect(call.sessionId).toBe('test-session-id');
    });

    it('releases terminals on normal completion', async () => {
      const toolCallId = 'shell-release';
      const connection = new RecordingConnection();
      connection.setTerminalOutput('done');
      const session = createTerminalSession(
        [
          shellToolCallEvent(toolCallId, 'echo done'),
          shellToolResultEvent(toolCallId, 'done'),
          doneEvent,
        ],
        connection,
      );
      createdSessions.push(session);

      await session.prompt({
        sessionId: 'test-session-id',
        prompt: [{ type: 'text', text: 'echo' }],
      });

      expect(connection.releaseCalls).toBe(1);
    });

    it('kills and releases terminals on cancel', async () => {
      const toolCallId = 'shell-cancel';
      const connection = new RecordingConnection();
      connection.setTerminalOutput('');
      connection.delayTerminalExit();
      const session = createBlockingTerminalSession(
        [
          shellToolCallEvent(toolCallId, 'sleep 999'),
          shellToolStatusEvent(toolCallId),
        ],
        connection,
      );
      createdSessions.push(session);

      const promptPromise = session.prompt({
        sessionId: 'test-session-id',
        prompt: [{ type: 'text', text: 'sleep' }],
      });

      await connection.waitForTerminalCreated();
      await session.cancelPendingPrompt();
      await promptPromise;

      expect(connection.killCalls).toBeGreaterThanOrEqual(1);
    });

    it('kills and releases terminals on dispose', async () => {
      const toolCallId = 'shell-dispose';
      const connection = new RecordingConnection();
      connection.setTerminalOutput('');
      connection.delayTerminalExit();
      const session = createBlockingTerminalSession(
        [
          shellToolCallEvent(toolCallId, 'sleep 999'),
          shellToolStatusEvent(toolCallId),
        ],
        connection,
      );
      createdSessions.push(session);

      const promptPromise = session.prompt({
        sessionId: 'test-session-id',
        prompt: [{ type: 'text', text: 'sleep' }],
      });

      await connection.waitForTerminalCreated();
      await session.dispose();
      await promptPromise.catch(() => undefined);

      expect(connection.killCalls).toBeGreaterThanOrEqual(1);
    });
  });

  describe('terminal-disabled sessions (fallback)', () => {
    it('does not create terminals and emits text content when terminal capability is absent', async () => {
      const toolCallId = 'shell-fallback';
      const connection = new RecordingConnection();
      const session = createTerminalSession(
        [
          shellToolCallEvent(toolCallId, 'echo text-output'),
          shellToolResultEvent(toolCallId, 'text-output'),
          doneEvent,
        ],
        connection,
        undefined,
        false,
      );
      createdSessions.push(session);

      await session.prompt({
        sessionId: 'test-session-id',
        prompt: [{ type: 'text', text: 'echo' }],
      });

      expect(connection.createTerminalCalls).toHaveLength(0);

      const hasTerminalContent = connection.onlySessionUpdates().some((u) => {
        if (u.sessionUpdate !== 'tool_call_update') return false;
        const content = u.content ?? [];
        return content.some((c) => c.type === 'terminal');
      });
      expect(hasTerminalContent).toBe(false);

      const hasTextContent = connection.onlySessionUpdates().some((u) => {
        if (u.sessionUpdate !== 'tool_call_update') return false;
        const content = u.content ?? [];
        return content.some(
          (c): c is Extract<typeof c, { type: 'content' }> =>
            c.type === 'content',
        );
      });
      expect(hasTextContent).toBe(true);
    });
  });
});
