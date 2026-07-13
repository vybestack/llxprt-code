/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { buildCommandToExecute } from '@vybestack/llxprt-code-tools';

import { Session } from './zedIntegration.js';
import { TerminalManager } from './zed-terminal-manager.js';
import {
  buildFakeAgent,
  RecordingConnection,
  buildMinimalConfig,
} from './zed-test-helpers.js';

const createdSessions: Session[] = [];
// Derived from the production buildCommandToExecute so the wrapping format
// stays in sync automatically.
const preparedEcho = buildCommandToExecute(
  'echo hello',
  false,
  '/tmp/shell.tmp',
);

function terminalManager(
  connection: RecordingConnection,
  sendUpdate: (update: acp.SessionUpdate) => Promise<void> = (update) =>
    connection.sessionUpdate({ sessionId: 'test-session-id', update }),
): TerminalManager {
  return new TerminalManager(
    'test-session-id',
    connection as unknown as acp.AgentSideConnection,
    '/project',
    sendUpdate,
    new DebugLogger('llxprt:zed-terminal-test'),
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

describe('Zed terminal execution', () => {
  afterEach(async () => {
    await Promise.allSettled(
      createdSessions.splice(0).map((session) => session.dispose()),
    );
  });

  it('delegates shell execution to the ACP terminal exactly once', async () => {
    const connection = new RecordingConnection();
    connection.setTerminalOutput('hello\n');
    const terminals = terminalManager(connection);
    await terminals.observeToolCall({
      id: 'shell-1',
      name: 'run_shell_command',
      args: { command: 'echo hello' },
    });
    const chunks: string[] = [];

    const result = await terminals.executeShellCommand(
      preparedEcho,
      '/project',
      (event) => {
        if (event.type === 'data' && event.chunk !== undefined) {
          chunks.push(event.chunk);
        }
      },
      new AbortController().signal,
    );

    expect(connection.createTerminalCalls).toStrictEqual([
      {
        command: 'bash',
        args: ['-c', preparedEcho],
        cwd: '/project',
        sessionId: 'test-session-id',
      },
    ]);
    expect(result).toMatchObject({ output: 'hello\n', exitCode: 0 });
    expect(chunks.join('')).toBe('hello\n');
    expect(connection.onlySessionUpdates()).toContainEqual(
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'shell-1',
        content: [{ type: 'terminal', terminalId: 'terminal-1' }],
      }),
    );
    expect(connection.releaseCalls).toBe(1);
  });

  it('correlates a raw command that already ends with a semicolon', async () => {
    const connection = new RecordingConnection();
    const terminals = terminalManager(connection);
    await terminals.observeToolCall({
      id: 'shell-semicolon',
      name: 'run_shell_command',
      args: { command: 'echo hello;' },
    });

    await terminals.executeShellCommand(
      preparedEcho,
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(connection.onlySessionUpdates()).toContainEqual(
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'shell-semicolon',
        content: [{ type: 'terminal', terminalId: 'terminal-1' }],
      }),
    );
  });

  it('confines an agent-reported cwd to the session project root', async () => {
    const connection = new RecordingConnection();
    const terminals = terminalManager(connection);
    await terminals.observeToolCall({
      id: 'shell-traversal',
      name: 'run_shell_command',
      args: { command: 'echo hello', dir_path: '../../etc' },
    });

    await terminals.executeShellCommand(
      preparedEcho,
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(connection.onlySessionUpdates()).toContainEqual(
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'shell-traversal',
        content: [{ type: 'terminal', terminalId: 'terminal-1' }],
      }),
    );
  });

  it('retries terminal correlation after update delivery fails', async () => {
    const connection = new RecordingConnection();
    connection.delayTerminalExit();
    let deliveryAttempt = 0;
    const terminals = terminalManager(connection, async (update) => {
      deliveryAttempt += 1;
      if (deliveryAttempt === 1) {
        throw new Error('transport unavailable');
      }
      await connection.sessionUpdate({
        sessionId: 'test-session-id',
        update,
      });
    });
    const execution = terminals.executeShellCommand(
      preparedEcho,
      '/project',
      () => undefined,
      new AbortController().signal,
    );
    await connection.waitForTerminalProcessCreated();

    await expect(
      terminals.observeToolCall({
        id: 'shell-retry',
        name: 'run_shell_command',
        args: { command: 'echo hello' },
      }),
    ).rejects.toThrow('transport unavailable');
    await terminals.observeToolCall({
      id: 'shell-retry',
      name: 'run_shell_command',
      args: { command: 'echo hello' },
    });
    connection.resolveDelayedTerminalExit();
    await execution;

    expect(connection.onlySessionUpdates()).toContainEqual(
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'shell-retry',
      }),
    );
  });

  it('does not create a terminal for an already-cancelled execution', async () => {
    const connection = new RecordingConnection();
    const controller = new AbortController();
    controller.abort();

    await expect(
      terminalManager(connection).executeShellCommand(
        preparedEcho,
        '/project',
        () => undefined,
        controller.signal,
      ),
    ).resolves.toMatchObject({ aborted: true });
    expect(connection.createTerminalCalls).toHaveLength(0);
  });

  it('does not mirror a shell command merely by observing its agent event', async () => {
    const connection = new RecordingConnection();
    const terminals = terminalManager(connection);
    const { agent } = buildFakeAgent(
      [
        shellToolCallEvent('shell-observed', 'touch side-effect'),
        shellToolResultEvent('shell-observed', 'locally executed'),
        doneEvent,
      ],
      { run_shell_command: 'execute' },
    );
    const session = new Session(
      'test-session-id',
      agent,
      buildMinimalConfig(),
      connection as unknown as acp.AgentSideConnection,
      false,
      terminals,
    );
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'run it once' }],
    });

    expect(connection.createTerminalCalls).toHaveLength(0);
  });

  it('kills and releases delegated execution on cancellation', async () => {
    const connection = new RecordingConnection();
    connection.delayTerminalExit();
    const terminals = terminalManager(connection);
    await terminals.observeToolCall({
      id: 'shell-cancel',
      name: 'run_shell_command',
      args: { command: 'echo hello' },
    });
    const controller = new AbortController();
    const execution = terminals.executeShellCommand(
      preparedEcho,
      '/project',
      () => undefined,
      controller.signal,
    );

    await connection.waitForTerminalCreated();
    controller.abort();
    await execution;

    expect(connection.killCalls).toBe(1);
    expect(connection.releaseCalls).toBe(1);
  });

  it('cleans up the client process when terminal update delivery fails', async () => {
    const connection = new RecordingConnection();
    const terminals = terminalManager(connection, async () => {
      throw new Error('transport closed');
    });
    await terminals.observeToolCall({
      id: 'shell-failure',
      name: 'run_shell_command',
      args: { command: 'echo hello' },
    });

    await expect(
      terminals.executeShellCommand(
        preparedEcho,
        '/project',
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow('transport closed');
    expect(connection.killCalls).toBe(1);
    expect(connection.releaseCalls).toBe(1);
  });

  it('retains text-only behavior when terminal capability is absent', async () => {
    const connection = new RecordingConnection();
    const { agent } = buildFakeAgent(
      [
        shellToolCallEvent('shell-fallback', 'echo text-output'),
        shellToolResultEvent('shell-fallback', 'text-output'),
        doneEvent,
      ],
      { run_shell_command: 'execute' },
    );
    const session = new Session(
      'test-session-id',
      agent,
      buildMinimalConfig(),
      connection as unknown as acp.AgentSideConnection,
    );
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'echo' }],
    });

    expect(connection.createTerminalCalls).toHaveLength(0);
    expect(connection.onlySessionUpdates()).toContainEqual(
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        content: [
          { type: 'content', content: { type: 'text', text: 'text-output' } },
        ],
      }),
    );
  });
});
