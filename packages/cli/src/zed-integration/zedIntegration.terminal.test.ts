/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import {
  DebugLogger,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core';
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
const preparedEchoSemicolon = buildCommandToExecute(
  'echo hello;',
  false,
  '/tmp/shell.tmp',
);
// Builder-generated wrapper whose temp path contains a literal newline. The
// path is quoted by singleQuoteForShell so it is valid real Bash, but a parser
// that splits the wrapper at the first newline would fail to correlate it.
const preparedEchoNewlinePath = buildCommandToExecute(
  'echo hello',
  false,
  '/tmp/before' + String.fromCharCode(10) + 'after.tmp',
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

// bun:test's `expect(p).rejects.toThrow()` is typed to return `void`, so
// `await expect(...).rejects...` trips @typescript-eslint/await-thenable.
// Drive the promise directly and assert on the captured rejection instead.
async function expectRejection(
  promise: Promise<unknown>,
  messageFragment: string,
): Promise<void> {
  let caught: unknown;
  let rejected = false;
  try {
    await promise;
  } catch (error) {
    caught = error;
    rejected = true;
  }
  expect(rejected).toBe(true);
  const text = caught instanceof Error ? caught.message : String(caught);
  expect(text).toContain(messageFragment);
}

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
        if (event.type === 'data' && typeof event.chunk === 'string') {
          chunks.push(event.chunk);
        }
      },
      new AbortController().signal,
    );

    const shell = getShellConfiguration();
    expect(connection.createTerminalCalls).toStrictEqual([
      {
        command: shell.executable,
        args: [...shell.argsPrefix, preparedEcho],
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
      preparedEchoSemicolon,
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

  it('correlates a wrapper whose temp path contains a literal newline', async () => {
    const connection = new RecordingConnection();
    const terminals = terminalManager(connection);
    await terminals.observeToolCall({
      id: 'shell-newline-path',
      name: 'run_shell_command',
      args: { command: 'echo hello' },
    });

    await terminals.executeShellCommand(
      preparedEchoNewlinePath,
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(connection.onlySessionUpdates()).toContainEqual(
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'shell-newline-path',
        content: [{ type: 'terminal', terminalId: 'terminal-1' }],
      }),
    );
  });

  it('rejects an agent-reported cwd outside the session project root', async () => {
    const connection = new RecordingConnection();
    const terminals = terminalManager(connection);

    await expectRejection(
      terminals.observeToolCall({
        id: 'shell-traversal',
        name: 'run_shell_command',
        args: { command: 'echo hello', dir_path: '../../etc' },
      }),
      'Shell tool cwd resolves outside the session root',
    );

    expect(connection.createTerminalCalls).toHaveLength(0);
    expect(connection.onlySessionUpdates()).toHaveLength(0);
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

    await expectRejection(
      terminals.observeToolCall({
        id: 'shell-retry',
        name: 'run_shell_command',
        args: { command: 'echo hello' },
      }),
      'transport unavailable',
    );
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

    const cancelledResult = await terminalManager(
      connection,
    ).executeShellCommand(
      preparedEcho,
      '/project',
      () => undefined,
      controller.signal,
    );
    expect(cancelledResult).toMatchObject({ aborted: true });
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

    await expectRejection(
      terminals.executeShellCommand(
        preparedEcho,
        '/project',
        () => undefined,
        new AbortController().signal,
      ),
      'transport closed',
    );
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

describe('Zed terminal command correlation does not over-match', () => {
  async function correlationAttempt(
    rawObserved: string,
    prepared: string,
  ): Promise<acp.SessionUpdate[]> {
    const connection = new RecordingConnection();
    const terminals = terminalManager(connection);
    await terminals.observeToolCall({
      id: 'shell-no-match',
      name: 'run_shell_command',
      args: { command: rawObserved },
    });
    await terminals.executeShellCommand(
      prepared,
      '/project',
      () => undefined,
      new AbortController().signal,
    );
    return connection.onlySessionUpdates();
  }

  it('does not correlate an arbitrary (non-canonical) trap command', async () => {
    const updates = await correlationAttempt(
      'echo hi',
      "trap 'echo malicious' EXIT\necho hi",
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({ toolCallId: 'shell-no-match' }),
    );
  });

  it('does not treat a plain command as equal to a semicolon-terminated one', async () => {
    const updates = await correlationAttempt(
      'echo hello',
      preparedEchoSemicolon,
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({ toolCallId: 'shell-no-match' }),
    );
  });

  it('does not treat a plain command as equal to a real trailing-& command', async () => {
    const preparedEchoAmp = buildCommandToExecute(
      'echo hello &',
      false,
      '/tmp/shell.tmp',
    );
    const updates = await correlationAttempt('echo hello', preparedEchoAmp);
    expect(updates).not.toContainEqual(
      expect.objectContaining({ toolCallId: 'shell-no-match' }),
    );
  });

  it('does not strip an escaped/literal terminal character to force a match', async () => {
    const preparedEscapedAmp = buildCommandToExecute(
      'printf foo\\&',
      false,
      '/tmp/shell.tmp',
    );
    const updates = await correlationAttempt('printf foo', preparedEscapedAmp);
    expect(updates).not.toContainEqual(
      expect.objectContaining({ toolCallId: 'shell-no-match' }),
    );
  });
});
