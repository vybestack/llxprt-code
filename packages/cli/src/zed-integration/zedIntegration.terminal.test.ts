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
import {
  createByteBudget,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
} from '@vybestack/llxprt-code-tools/acquisition.js';

import { Session } from './zedIntegration.js';
import { TerminalManager } from './zed-terminal-manager.js';
import { TERMINAL_DISCONTINUITY_NOTICE } from './terminalOutputDelta.js';
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
  outputByteLimit?: number,
): TerminalManager {
  return new TerminalManager(
    'test-session-id',
    connection as unknown as acp.AgentSideConnection,
    '/project',
    sendUpdate,
    new DebugLogger('llxprt:zed-terminal-test'),
    createByteBudget(outputByteLimit ?? DEFAULT_ACQUISITION_BUDGET_BYTES),
  );
}

function waitForTestSignal(
  signal: Promise<void>,
  description: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${description}`));
    }, 2000);
    void signal.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
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

  async function verifyDelegatesShellExecutionToTheACPTerminalExactlyOnce() {
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

    return {
      connection,
      chunks,
      result,
    };
  }

  it('delegates shell execution to the ACP terminal exactly once', async () => {
    const behaviorResult =
      await verifyDelegatesShellExecutionToTheACPTerminalExactlyOnce();

    const shell = getShellConfiguration();
    expect(behaviorResult.connection.createTerminalCalls).toStrictEqual([
      {
        command: shell.executable,
        args: [...shell.argsPrefix, preparedEcho],
        cwd: '/project',
        sessionId: 'test-session-id',
        outputByteLimit: DEFAULT_ACQUISITION_BUDGET_BYTES,
      },
    ]);
    expect(behaviorResult.result).toMatchObject({
      output: 'hello\n',
      exitCode: 0,
    });
    expect(behaviorResult.chunks.join('')).toBe('hello\n');
    expect(behaviorResult.connection.onlySessionUpdates()).toContainEqual(
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'shell-1',
        content: [{ type: 'terminal', terminalId: 'terminal-1' }],
      }),
    );
    expect(behaviorResult.connection.releaseCalls).toBe(1);
  });

  async function verifyRetriesAfterATransientTerminalOutputPollFailure() {
    const connection = new RecordingConnection();
    connection.delayTerminalExit();
    connection.setTerminalOutput('recovered output\n');
    connection.failNextTerminalOutputPoll();
    const terminals = terminalManager(connection);
    let resolveOutput: () => void = () => undefined;
    const sawOutput = new Promise<void>((resolve) => {
      resolveOutput = resolve;
    });

    const execution = terminals.executeShellCommand(
      preparedEcho,
      '/project',
      (event) => {
        if (
          event.type === 'data' &&
          typeof event.chunk === 'string' &&
          event.chunk.includes('recovered output')
        ) {
          resolveOutput();
        }
      },
      new AbortController().signal,
    );

    await connection.waitForTerminalProcessCreated();
    await waitForTestSignal(sawOutput, 'recovered terminal output');
    connection.resolveDelayedTerminalExit();
    const result = await execution;

    return {
      output: result.output,
      killCalls: connection.killCalls,
      releaseCalls: connection.releaseCalls,
    };
  }

  it('retries after a transient terminal output poll failure', async () => {
    const behaviorResult =
      await verifyRetriesAfterATransientTerminalOutputPollFailure();

    expect(behaviorResult.output).toBe('recovered output\n');
    expect(behaviorResult.killCalls).toBe(0);
    expect(behaviorResult.releaseCalls).toBe(1);
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

  async function verifyRetriesTerminalCorrelationAfterUpdateDeliveryFails() {
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

    return connection.onlySessionUpdates();
  }

  it('retries terminal correlation after update delivery fails', async () => {
    const sessionUpdates =
      await verifyRetriesTerminalCorrelationAfterUpdateDeliveryFails();
    expect(sessionUpdates).toContainEqual(
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

describe('Zed terminal byte-budget enforcement (issue #3200 finding 4)', () => {
  afterEach(async () => {
    await Promise.allSettled(
      createdSessions.splice(0).map((session) => session.dispose()),
    );
  });

  it('fails fast and releases a hostile peer that exceeds the byte budget', async () => {
    const connection = new RecordingConnection();
    // Set terminal output far exceeding the small budget.
    connection.setTerminalOutput('X'.repeat(100000));
    const terminals = terminalManager(connection, undefined, 1024);

    await expectRejection(
      terminals.executeShellCommand(
        preparedEcho,
        '/project',
        () => undefined,
        new AbortController().signal,
      ),
      'exceeded output byte budget',
    );

    // The terminal must be killed and released (fail fast).
    expect(connection.killCalls).toBeGreaterThanOrEqual(1);
    expect(connection.releaseCalls).toBeGreaterThanOrEqual(1);
  });

  async function verifyEmitsTruthfulQuantifiableMetadataAndOneNoticeWhenThePeerEvictsContent() {
    // The peer first shows a large output, then evicts the head and reports a
    // small disjoint tail with truncated=true. The manager must surface the
    // quantifiable loss (observed > retained) as exact metadata and include one
    // visible discontinuity notice in the returned output.
    const connection = new RecordingConnection();
    connection.delayTerminalExit();
    const bigOutput = 'HEAD_MARKER' + 'X'.repeat(8000);
    connection.setTerminalOutput(bigOutput);
    let resolveBig: () => void = () => undefined;
    const sawBig = new Promise<void>((resolve) => {
      resolveBig = resolve;
    });
    const budget = 16384; // larger than bigOutput so it is not fail-fast killed
    const streamedChunks: string[] = [];
    const terminals = terminalManager(connection, undefined, budget);
    const execution = terminals.executeShellCommand(
      preparedEcho,
      '/project',
      (event) => {
        if (event.type !== 'data' || typeof event.chunk !== 'string') {
          return;
        }
        streamedChunks.push(event.chunk);
        if (
          event.chunk.includes('HEAD_MARKER') &&
          !event.chunk.includes(TERMINAL_DISCONTINUITY_NOTICE)
        ) {
          resolveBig();
        }
      },
      new AbortController().signal,
    );
    await connection.waitForTerminalProcessCreated();
    // Wait until the first poll has delivered the big output, then simulate the
    // peer evicting it to a small disjoint tail.
    await waitForTestSignal(sawBig, 'initial bounded terminal snapshot');
    connection.setTerminalOutput('TAIL_ONLY_ZZZ');
    connection.setTerminalTruncated(true);
    connection.resolveDelayedTerminalExit();
    const result = await execution;

    // Quantifiable lower bound: observed (the big peak) exceeds retained (the
    // tail), but the peer may have evicted bytes before they were observed.
    return {
      outputTruncation: result.outputTruncation,
      streamedNoticeCount:
        streamedChunks.join('').split(TERMINAL_DISCONTINUITY_NOTICE).length - 1,
      retainedNoticeCount:
        result.output.split(TERMINAL_DISCONTINUITY_NOTICE).length - 1,
      output: result.output,
      budget,
    };
  }

  it('emits truthful quantifiable metadata and one notice when the peer evicts content', async () => {
    const behaviorResult =
      await verifyEmitsTruthfulQuantifiableMetadataAndOneNoticeWhenThePeerEvictsContent();

    expect(behaviorResult.outputTruncation).toBeDefined();
    expect(behaviorResult.outputTruncation?.truncated).toBe(true);
    expect(behaviorResult.outputTruncation?.omittedBytes).toBeGreaterThan(0);
    expect(behaviorResult.outputTruncation?.omittedBytesExact).toBe(false);
    expect(behaviorResult.outputTruncation?.budgetBytes).toBe(
      behaviorResult.budget,
    );
    // Exactly one durable discontinuity notice is streamed and retained.
    expect(behaviorResult.streamedNoticeCount).toBe(1);
    expect(behaviorResult.retainedNoticeCount).toBe(1);
    expect(behaviorResult.output).toContain('TAIL_ONLY_ZZZ');
  });

  it('does not fabricate exact metadata when the peer reports truncated but no loss is observed', async () => {
    // A peer that reports truncated=true but whose output never shrinks (we
    // never observe an eviction) must NOT claim observed==retained with
    // omittedBytes 0 as exact metadata — that would be a fabricated guarantee.
    const connection = new RecordingConnection();
    connection.setTerminalOutput('some output\n');
    connection.setTerminalTruncated(true);
    const terminals = terminalManager(connection, undefined, 4096);

    const result = await terminals.executeShellCommand(
      preparedEcho,
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    // No quantifiable loss was observed, so no exact-count metadata is emitted.
    expect(result.outputTruncation).toBeUndefined();
    expect(result.output).toBe('some output\n');
  });

  it('does not set truncation metadata when the peer is not truncated', async () => {
    const connection = new RecordingConnection();
    connection.setTerminalOutput('clean output\n');
    const terminals = terminalManager(connection, undefined, 4096);

    const result = await terminals.executeShellCommand(
      preparedEcho,
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(result.outputTruncation).toBeUndefined();
  });

  it('enforces the configured byte budget as the retention bound', async () => {
    // Output exactly at the configured budget is retained fully (byte-accurate),
    // confirming the configured budget — not a fixed character cap — governs
    // retention. Combined with the fail-fast test above, retained state is
    // always bounded by the configured budget.
    const connection = new RecordingConnection();
    const budget = 4096;
    const multibyteUnit = '世';
    const unitBytes = Buffer.byteLength(multibyteUnit, 'utf8');
    const output =
      multibyteUnit.repeat(Math.floor(budget / unitBytes)) +
      'B'.repeat(budget % unitBytes);
    expect(Buffer.byteLength(output, 'utf8')).toBe(budget);
    connection.setTerminalOutput(output);
    const terminals = terminalManager(connection, undefined, budget);

    const result = await terminals.executeShellCommand(
      preparedEcho,
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(Buffer.byteLength(result.output, 'utf8')).toBe(budget);
    expect(result.exitCode).toBe(0);
    expect(result.outputTruncation).toBeUndefined();
  });
});
