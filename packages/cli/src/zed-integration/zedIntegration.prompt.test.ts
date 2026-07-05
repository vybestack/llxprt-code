/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentEvent, Agent } from '@vybestack/llxprt-code-agents';
import {
  ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
import type { ApprovalMode, Config } from '@vybestack/llxprt-code-core';
import { todoEvents } from '@vybestack/llxprt-code-core';

import { Session } from './zedIntegration.js';

type ConfirmationCapture = {
  confirmationId: string;
  decision: ToolConfirmationOutcome;
  payload?: ToolConfirmationPayload;
  requiresUserConfirmation?: boolean;
};

function buildFakeAgent(events: readonly AgentEvent[]): {
  agent: Agent;
  confirmations: ConfirmationCapture[];
} {
  return buildScriptedAgent(() => events);
}

function buildScriptedAgent(nextEvents: () => readonly AgentEvent[]): {
  agent: Agent;
  confirmations: ConfirmationCapture[];
} {
  const confirmations: ConfirmationCapture[] = [];
  const agent = {
    async *stream(_input: unknown, _opts?: unknown): AsyncIterable<AgentEvent> {
      for (const e of nextEvents()) {
        yield e;
      }
    },
    getApprovalMode: (): ApprovalMode => 'default' as ApprovalMode,
    setApprovalMode: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    tools: {
      respondToConfirmation: (
        confirmationId: string,
        decision: ToolConfirmationOutcome,
        payload?: ToolConfirmationPayload,
        requiresUserConfirmation?: boolean,
      ) => {
        confirmations.push({
          confirmationId,
          decision,
          ...(payload === undefined ? {} : { payload }),
          ...(requiresUserConfirmation === undefined
            ? {}
            : { requiresUserConfirmation }),
        });
      },
      onConfirmationRequest: () => () => {},
      onToolUpdate: () => () => {},
      setEditorCallbacks: () => {},
      setEnabled: vi.fn().mockResolvedValue(undefined),
      list: () => [],
      keys: {},
    },
  } as unknown as Agent;
  return { agent, confirmations };
}

class RecordingConnection {
  readonly messages: Array<
    | { kind: 'sessionUpdate'; update: acp.SessionUpdate }
    | {
        kind: 'requestPermission';
        request: acp.RequestPermissionRequest;
        outcome: acp.RequestPermissionOutcome;
      }
  > = [];
  private permissionOutcome: acp.RequestPermissionOutcome = {
    outcome: 'selected',
    optionId: ToolConfirmationOutcome.ProceedOnce,
  };
  private permissionRejection: Error | null = null;
  private gatedDeferred: {
    resolve: (o: acp.RequestPermissionOutcome) => void;
    promise: Promise<acp.RequestPermissionOutcome>;
  } | null = null;
  private gatedArrived: (() => void) | null = null;

  setPermissionOutcome(outcome: acp.RequestPermissionOutcome): void {
    this.permissionOutcome = outcome;
  }

  rejectPermission(error: Error): void {
    this.permissionRejection = error;
  }

  armPermissionGate(): {
    arrived: Promise<void>;
    settle: (o: acp.RequestPermissionOutcome) => void;
  } {
    let resolveArrived!: () => void;
    const arrived = new Promise<void>((r) => {
      resolveArrived = r;
    });
    let resolvePermission!: (o: acp.RequestPermissionOutcome) => void;
    const promise = new Promise<acp.RequestPermissionOutcome>((r) => {
      resolvePermission = r;
    });
    this.gatedDeferred = { resolve: resolvePermission, promise };
    this.gatedArrived = resolveArrived;
    return {
      arrived,
      settle: (o: acp.RequestPermissionOutcome) => {
        const d = this.gatedDeferred;
        this.gatedDeferred = null;
        this.gatedArrived = null;
        d?.resolve(o);
      },
    };
  }

  sessionUpdate = vi.fn(
    async (params: acp.SessionNotification): Promise<void> => {
      this.messages.push({ kind: 'sessionUpdate', update: params.update });
    },
  );

  requestPermission = vi.fn(
    async (
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
      if (this.permissionRejection !== null) {
        throw this.permissionRejection;
      }
      if (this.gatedDeferred !== null) {
        this.messages.push({
          kind: 'requestPermission',
          request: params,
          outcome: {
            outcome: 'selected',
            optionId: ToolConfirmationOutcome.Cancel,
          },
        });
        const arrivedFn = this.gatedArrived;
        this.gatedArrived = null;
        arrivedFn?.();
        const outcome = await this.gatedDeferred.promise;
        this.gatedDeferred = null;
        return { outcome };
      }
      this.messages.push({
        kind: 'requestPermission',
        request: params,
        outcome: this.permissionOutcome,
      });
      return { outcome: this.permissionOutcome };
    },
  );

  onlySessionUpdates(): acp.SessionUpdate[] {
    return this.messages
      .filter((m) => m.kind === 'sessionUpdate')
      .map((m) => (m as { update: acp.SessionUpdate }).update);
  }

  sessionUpdateKinds(): string[] {
    return this.onlySessionUpdates().map((u) => u.sessionUpdate);
  }
}

function buildMinimalConfig(): Config {
  return {
    getEphemeralSetting: () => undefined,
    getDebugMode: () => false,
    getApprovalMode: () => 'default' as ApprovalMode,
    setApprovalMode: () => {},
    getTargetDir: () => '/project',
    getFileService: () => ({ shouldIgnoreFile: () => false }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getEnableRecursiveFileSearch: () => false,
    getFileSystemService: () => ({ readTextFile: async () => '' }),
    getMaxSessionTurns: () => 50,
  } as unknown as Config;
}

function createSession(
  agent: Agent,
  connection: RecordingConnection,
  config: Config = buildMinimalConfig(),
): Session {
  return new Session(
    'test-session-id',
    agent,
    config,
    connection as unknown as acp.AgentSideConnection,
  );
}

async function runPrompt(session: Session): Promise<acp.PromptResponse> {
  return session.prompt({
    sessionId: 'test-session-id',
    prompt: [{ type: 'text', text: 'hello' }],
  });
}

function editConfirmation(
  confirmationId: string,
  toolCallId: string,
): Extract<AgentEvent, { type: 'tool-confirmation' }> {
  return {
    type: 'tool-confirmation',
    confirmation: {
      confirmationId,
      toolCallId,
      name: 'edit',
      details: {
        type: 'edit',
        title: 'Edit file',
        fileName: '/project/file.txt',
        filePath: '/project/file.txt',
        fileDiff: 'diff',
        originalContent: 'old',
        newContent: 'new',
        onConfirm: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

describe('Zed Session.prompt (Agent API) - streaming output', () => {
  it('emits agent_message_chunk events in stream order followed by end_turn', async () => {
    const { agent } = buildFakeAgent([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    const response = await runPrompt(session);

    expect(response.stopReason).toBe('end_turn');
    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'agent_message_chunk',
    ]);
    const combinedText = connection
      .onlySessionUpdates()
      .map((u) => (u as { content: { text: string } }).content.text)
      .join('');
    expect(combinedText).toBe('Hello world');
  });

  it('emits agent_thought_chunk before agent_message_chunk when thought precedes text', async () => {
    const { agent } = buildFakeAgent([
      {
        type: 'thinking',
        thought: { subject: 'reasoning here', description: '' },
      },
      { type: 'text', text: 'answer' },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    await runPrompt(session);

    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'agent_thought_chunk',
      'agent_message_chunk',
    ]);
  });

  it('preserves interleaved text and thought ordering within a batch', async () => {
    const { agent } = buildFakeAgent([
      { type: 'text', text: 'before' },
      {
        type: 'thinking',
        thought: { subject: 'thought', description: '' },
      },
      { type: 'text', text: 'after' },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    await runPrompt(session);

    expect(
      connection.onlySessionUpdates().map((update) => ({
        kind: update.sessionUpdate,
        text: (update as { content: { text: string } }).content.text,
      })),
    ).toStrictEqual([
      { kind: 'agent_message_chunk', text: 'before' },
      { kind: 'agent_thought_chunk', text: 'thought' },
      { kind: 'agent_message_chunk', text: 'after' },
    ]);
  });
  it('emits the emoji-blocked message without hanging', async () => {
    const { agent } = buildFakeAgent([
      { type: 'text', text: 'blocked \u{1F600}' },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const config = {
      ...buildMinimalConfig(),
      getEphemeralSetting: (key: string) =>
        key === 'emojifilter' ? 'error' : undefined,
    } as unknown as Config;
    const session = createSession(agent, connection, config);

    await runPrompt(session);

    const update = connection.onlySessionUpdates()[0] as {
      content: { text: string };
    };
    expect(update.content.text).toContain('blocked due to emoji detection');
  });
});

describe('Zed Session.prompt (Agent API) - tool-call status progression', () => {
  it('surfaces tool_call and tool_call_update events in order', async () => {
    const toolCallId = 'tool-1';
    const { agent } = buildFakeAgent([
      {
        type: 'tool-call',
        call: {
          id: toolCallId,
          name: 'read_file',
          args: { absolute_path: '/project/file.txt', offset: 7 },
        },
      },
      {
        type: 'tool-status',
        update: { id: toolCallId, name: 'read_file', status: 'executing' },
      },
      {
        type: 'tool-result',
        result: { id: toolCallId, name: 'read_file', output: 'file contents' },
      },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    await runPrompt(session);

    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'tool_call',
      'tool_call_update',
      'tool_call_update',
    ]);
    const updates = connection.onlySessionUpdates();
    const startUpdate = updates[0] as {
      locations: acp.ToolCallLocation[];
      status: string;
    };
    expect(startUpdate.status).toBe('in_progress');
    expect(startUpdate.locations).toStrictEqual([
      { path: '/project/file.txt', line: 7 },
    ]);
    expect((updates[1] as { status: string }).status).toBe('in_progress');
    expect((updates[2] as { status: string }).status).toBe('completed');
  });

  it('surfaces multiple path locations and known tool kinds', async () => {
    const { agent } = buildFakeAgent([
      {
        type: 'tool-call',
        call: {
          id: 'multi-read',
          name: 'read_many_files',
          args: { paths: ['/project/a.ts', '/project/b.ts'] },
        },
      },
      {
        type: 'tool-call',
        call: {
          id: 'line-delete',
          name: 'delete_line_range',
          args: { absolute_path: '/project/c.ts', start_line: 12 },
        },
      },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    await runPrompt(session);

    const updates = connection.onlySessionUpdates();
    expect(updates[0]).toMatchObject({
      kind: 'read',
      locations: [{ path: '/project/a.ts' }, { path: '/project/b.ts' }],
    });
    expect(updates[1]).toMatchObject({
      kind: 'edit',
      locations: [{ path: '/project/c.ts', line: 12 }],
    });
  });
  it('surfaces live tool-status output as tool_call_update content', async () => {
    const toolCallId = 'tool-live';
    const { agent } = buildFakeAgent([
      {
        type: 'tool-call',
        call: { id: toolCallId, name: 'run_shell_command', args: {} },
      },
      {
        type: 'tool-status',
        update: {
          id: toolCallId,
          name: 'run_shell_command',
          status: 'executing',
          output: 'line 1',
        },
      },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    await runPrompt(session);

    const liveUpdate = connection.onlySessionUpdates()[1] as {
      content: acp.ToolCallContent[];
    };
    expect(liveUpdate.content).toStrictEqual([
      { type: 'content', content: { type: 'text', text: 'line 1' } },
    ]);
  });

  it('surfaces failed, suppressed, and diff tool result content correctly', async () => {
    const { agent } = buildFakeAgent([
      { type: 'tool-call', call: { id: 'err', name: 'bad_tool', args: {} } },
      {
        type: 'tool-result',
        result: { id: 'err', name: 'bad_tool', output: 'boom', isError: true },
      },
      {
        type: 'tool-call',
        call: { id: 'suppress', name: 'secret_tool', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'suppress',
          name: 'secret_tool',
          output: 'secret data',
          suppressDisplay: true,
        },
      },
      {
        type: 'tool-call',
        call: { id: 'display-content', name: 'display_tool', args: {} },
      },
      {
        type: 'tool-result',
        result: {
          id: 'display-content',
          name: 'display_tool',
          display: { content: 'human readable' },
        },
      },
      { type: 'tool-call', call: { id: 'diff', name: 'edit', args: {} } },
      {
        type: 'tool-result',
        result: {
          id: 'diff',
          name: 'edit',
          display: {
            fileDiff: 'diff',
            fileName: '/project/file.txt',
            originalContent: 'old',
            newContent: 'new',
          },
        },
      },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    await runPrompt(session);

    const updates = connection.onlySessionUpdates();
    const failed = updates[1] as { status: string; content: unknown };
    expect(failed.status).toBe('failed');
    expect(JSON.stringify(failed.content)).toContain('boom');
    const suppressed = updates[3] as { status: string; content: unknown };
    expect(suppressed.status).toBe('completed');
    expect(suppressed.content).toStrictEqual([]);
    const display = updates[5] as {
      status: string;
      content: acp.ToolCallContent[];
    };
    expect(display.status).toBe('completed');
    expect(display.content).toStrictEqual([
      { type: 'content', content: { type: 'text', text: 'human readable' } },
    ]);
    const diff = updates[7] as {
      status: string;
      content: acp.ToolCallContent[];
    };
    expect(diff.status).toBe('completed');
    expect(diff.content).toStrictEqual([
      {
        type: 'diff',
        path: '/project/file.txt',
        oldText: 'old',
        newText: 'new',
      },
    ]);
  });
});

describe('Zed Session.prompt (Agent API) - tool permission round-trip', () => {
  it('requests permission then completes the tool after approval, in order', async () => {
    const confirmationId = 'conf-1';
    const toolCallId = 'perm-tool-1';
    const { agent, confirmations } = buildFakeAgent([
      { type: 'tool-call', call: { id: toolCallId, name: 'edit', args: {} } },
      editConfirmation(confirmationId, toolCallId),
      { type: 'tool-result', result: { id: toolCallId, name: 'edit' } },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    await runPrompt(session);

    expect(connection.messages.map((m) => m.kind)).toStrictEqual([
      'sessionUpdate',
      'requestPermission',
      'sessionUpdate',
    ]);
    expect(confirmations).toStrictEqual([
      { confirmationId, decision: ToolConfirmationOutcome.ProceedOnce },
    ]);
    const permission = connection.messages[1] as {
      request: acp.RequestPermissionRequest;
    };
    expect(permission.request.toolCall.locations).toStrictEqual([
      { path: '/project/file.txt' },
    ]);
  });

  it('denies rejected permissions and emits no completed update', async () => {
    const confirmationId = 'conf-2';
    const toolCallId = 'perm-tool-2';
    const { agent, confirmations } = buildFakeAgent([
      { type: 'tool-call', call: { id: toolCallId, name: 'edit', args: {} } },
      editConfirmation(confirmationId, toolCallId),
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    connection.setPermissionOutcome({
      outcome: 'selected',
      optionId: ToolConfirmationOutcome.Cancel,
    });
    const session = createSession(agent, connection);

    const response = await runPrompt(session);

    expect(confirmations).toStrictEqual([
      { confirmationId, decision: ToolConfirmationOutcome.Cancel },
    ]);
    expect(connection.sessionUpdateKinds()).toStrictEqual(['tool_call']);
    expect(response.stopReason).toBe('end_turn');
  });

  it('cancels the agent confirmation and fails the turn when permission request rejects', async () => {
    const confirmationId = 'conf-rejects';
    const toolCallId = 'perm-tool-rejects';
    const { agent, confirmations } = buildFakeAgent([
      { type: 'tool-call', call: { id: toolCallId, name: 'edit', args: {} } },
      editConfirmation(confirmationId, toolCallId),
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    connection.rejectPermission(new Error('permission transport failed'));
    const session = createSession(agent, connection);

    await expect(runPrompt(session)).rejects.toThrow(
      /permission transport failed/,
    );
    expect(confirmations).toStrictEqual([
      { confirmationId, decision: ToolConfirmationOutcome.Cancel },
    ]);
  });

  it('passes edited command and new content payloads back to the agent', async () => {
    const confirmationId = 'conf-payload';
    const toolCallId = 'perm-tool-payload';
    const { agent, confirmations } = buildFakeAgent([
      { type: 'tool-call', call: { id: toolCallId, name: 'edit', args: {} } },
      editConfirmation(confirmationId, toolCallId),
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    connection.setPermissionOutcome({
      outcome: 'selected',
      optionId: ToolConfirmationOutcome.SuggestEdit,
      payload: { editedCommand: '  echo hi  ', newContent: 'replacement' },
    } as acp.RequestPermissionOutcome);
    const session = createSession(agent, connection);

    await runPrompt(session);

    expect(confirmations).toStrictEqual([
      {
        confirmationId,
        decision: ToolConfirmationOutcome.SuggestEdit,
        payload: { editedCommand: 'echo hi', newContent: 'replacement' },
        requiresUserConfirmation: true,
      },
    ]);
  });
});

describe('Zed Session.prompt (Agent API) - cancellation', () => {
  it('maps done reasons to ACP stop reasons and terminal errors', async () => {
    const aborted = createSession(
      buildFakeAgent([{ type: 'done', reason: 'aborted' }]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(aborted)).resolves.toStrictEqual({
      stopReason: 'cancelled',
    });

    const maxTurns = createSession(
      buildFakeAgent([{ type: 'done', reason: 'max-turns' }]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(maxTurns)).resolves.toStrictEqual({
      stopReason: 'max_turn_requests',
    });

    const contextOverflow = createSession(
      buildFakeAgent([{ type: 'done', reason: 'context-overflow' }]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(contextOverflow)).resolves.toStrictEqual({
      stopReason: 'max_tokens',
    });

    const errorSession = createSession(
      buildFakeAgent([{ type: 'done', reason: 'error' }]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(errorSession)).rejects.toThrow(
      /terminal reason: error/,
    );

    const hookStoppedSession = createSession(
      buildFakeAgent([{ type: 'done', reason: 'hook-stopped' }]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(hookStoppedSession)).rejects.toThrow(
      /terminal reason: hook-stopped/,
    );
  });

  it('maps structured 429 agent error events to ACP rate-limit errors', async () => {
    const session = createSession(
      buildFakeAgent([
        {
          type: 'error',
          error: { message: 'too many requests', status: 429 },
        },
      ]).agent,
      new RecordingConnection(),
    );

    await expect(runPrompt(session)).rejects.toMatchObject({
      code: 429,
      message: 'Rate limit exceeded. Try again later.',
    });
  });

  it('responds Cancel when prompt cancellation races with pending permission', async () => {
    const confirmationId = 'conf-cancel';
    const toolCallId = 'perm-cancel-tool';
    const { agent, confirmations } = buildFakeAgent([
      { type: 'tool-call', call: { id: toolCallId, name: 'edit', args: {} } },
      editConfirmation(confirmationId, toolCallId),
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const gate = connection.armPermissionGate();
    const session = createSession(agent, connection);

    const promptPromise = runPrompt(session);
    await gate.arrived;
    await session.cancelPendingPrompt();
    const response = await promptPromise;
    gate.settle({
      outcome: 'selected',
      optionId: ToolConfirmationOutcome.ProceedOnce,
    });
    await Promise.resolve();

    expect(confirmations).toStrictEqual([
      { confirmationId, decision: ToolConfirmationOutcome.Cancel },
    ]);
    expect(response.stopReason).toBe('cancelled');
  });

  it('cancels a pending permission when a new prompt supersedes the old one', async () => {
    const confirmationId = 'conf-supersede';
    const toolCallId = 'perm-supersede-tool';
    let promptCount = 0;
    const { agent, confirmations } = buildScriptedAgent(() => {
      promptCount += 1;
      return promptCount === 1
        ? [
            {
              type: 'tool-call',
              call: { id: toolCallId, name: 'edit', args: {} },
            },
            editConfirmation(confirmationId, toolCallId),
            { type: 'done', reason: 'stop' },
          ]
        : [
            { type: 'text', text: 'second' },
            { type: 'done', reason: 'stop' },
          ];
    });
    const connection = new RecordingConnection();
    const gate = connection.armPermissionGate();
    const session = createSession(agent, connection);

    const firstPrompt = runPrompt(session);
    await gate.arrived;
    const secondPrompt = runPrompt(session);
    const firstResponse = await firstPrompt;
    const secondResponse = await secondPrompt;

    expect(firstResponse.stopReason).toBe('cancelled');
    expect(secondResponse.stopReason).toBe('end_turn');
    expect(confirmations).toStrictEqual([
      { confirmationId, decision: ToolConfirmationOutcome.Cancel },
    ]);
  });
});

describe('Zed Session.prompt (Agent API) - previously-dropped event variants', () => {
  it('handles notice, loop detection, errors, and ignored metadata events', async () => {
    const notice = createSession(
      buildFakeAgent([
        { type: 'notice', message: 'Heads up!' },
        { type: 'loop-detected' },
      ]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(notice)).resolves.toStrictEqual({
      stopReason: 'end_turn',
    });

    const invalid = createSession(
      buildFakeAgent([{ type: 'invalid-stream' }]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(invalid)).rejects.toThrow(/invalid stream/i);

    const hookBlocked = createSession(
      buildFakeAgent([
        {
          type: 'hook-blocked',
          info: { reason: 'hook', systemMessage: 'Blocked by pre-tool hook' },
        },
      ]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(hookBlocked)).rejects.toThrow(
      /Blocked by pre-tool hook/,
    );

    const ignored = createSession(
      buildFakeAgent([
        {
          type: 'usage',
          usage: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
        {
          type: 'context-warning',
          estimatedRequestTokenCount: 1000,
          remainingTokenCount: 500,
        },
        { type: 'compression', info: null },
        { type: 'model-info', info: { model: 'test-model' } },
        { type: 'retry' },
        { type: 'citation', citation: 'src.ts' },
        { type: 'done', reason: 'stop' },
      ]).agent,
      new RecordingConnection(),
    );
    await expect(runPrompt(ignored)).resolves.toStrictEqual({
      stopReason: 'end_turn',
    });
  });
});

describe('Zed Session (Agent API) - lifecycle', () => {
  it('stops receiving todo updates after dispose', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);

    todoEvents.emitTodoUpdated({
      sessionId: 'test-session-id',
      todos: [{ id: 'task-1', content: 'task', status: 'in_progress' }],
      timestamp: new Date(),
    });
    await new Promise((r) => setImmediate(r));
    expect(connection.sessionUpdateKinds()).toContain('plan');

    await session.dispose();

    connection.messages.length = 0;
    todoEvents.emitTodoUpdated({
      sessionId: 'test-session-id',
      todos: [{ id: 'task-1', content: 'task', status: 'completed' }],
      timestamp: new Date(),
    });
    await new Promise((r) => setImmediate(r));
    expect(connection.sessionUpdateKinds()).not.toContain('plan');
  });
});
