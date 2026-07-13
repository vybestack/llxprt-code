/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { Config } from '@vybestack/llxprt-code-core';
import { todoEvents } from '@vybestack/llxprt-code-core';

import { Session } from './zedIntegration.js';
import { STREAM_BLOCKED_MESSAGE } from './zed-stream-batcher.js';
import {
  buildFakeAgent,
  buildScriptedAgent,
  RecordingConnection,
  buildMinimalConfig,
  createSession,
  runPrompt,
  editConfirmation,
} from './zed-test-helpers.js';

const createdSessions: Session[] = [];

async function disposeCreatedSessions(): Promise<void> {
  await Promise.allSettled(
    createdSessions.splice(0).map((session) => session.dispose()),
  );
}

describe('Zed Session.prompt (Agent API) - streaming output', () => {
  afterEach(disposeCreatedSessions);
  it('emits agent_message_chunk events in stream order followed by end_turn', async () => {
    const { agent } = buildFakeAgent([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

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
    createdSessions.push(session);

    await runPrompt(session);

    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'agent_thought_chunk',
      'agent_message_chunk',
    ]);
  });

  it('preserves interleaved text and thought ordering within a batch', async () => {
    const { agent } = buildFakeAgent([
      { type: 'text', text: 'before. ' },
      {
        type: 'thinking',
        thought: { subject: 'thought', description: '' },
      },
      { type: 'text', text: 'after. ' },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await runPrompt(session);

    expect(
      connection.onlySessionUpdates().map((update) => ({
        kind: update.sessionUpdate,
        text: (update as { content: { text: string } }).content.text,
      })),
    ).toStrictEqual([
      { kind: 'agent_message_chunk', text: 'before. ' },
      { kind: 'agent_thought_chunk', text: 'thought' },
      { kind: 'agent_message_chunk', text: 'after. ' },
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
    createdSessions.push(session);

    await runPrompt(session);

    const update = connection.onlySessionUpdates()[0] as {
      content: { text: string };
    };
    expect(update.content.text).toContain('blocked due to emoji detection');
  });

  it('flushes the emoji buffer on a blocked chunk so a following clean chunk is emitted instead of re-blocked', async () => {
    // Error mode: the first chunk carries an emoji and is blocked. The blocking
    // content stays in the EmojiFilter's internal buffer; without flushing it on
    // the blocked path, the NEXT (clean) chunk would be concatenated with the
    // stale emoji buffer, re-detected, and blocked again — losing the clean text.
    const { agent } = buildFakeAgent([
      { type: 'text', text: 'blocked \u{1F600}' },
      { type: 'text', text: 'all clean now.' },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const config = {
      ...buildMinimalConfig(),
      getEphemeralSetting: (key: string) =>
        key === 'emojifilter' ? 'error' : undefined,
    } as unknown as Config;
    const session = createSession(agent, connection, config);
    createdSessions.push(session);

    await runPrompt(session);

    // Exactly ONE blocked error, THEN the clean follow-up text — proving the
    // buffer was flushed so the clean chunk filtered cleanly instead of being
    // re-blocked (which would produce a second error and drop 'all clean now.').
    const texts = connection
      .onlySessionUpdates()
      .map((u) => (u as { content: { text: string } }).content.text);
    expect(texts).toStrictEqual([STREAM_BLOCKED_MESSAGE, 'all clean now.']);
  });
});

describe('Zed Session.prompt (Agent API) - tool permission round-trip', () => {
  afterEach(disposeCreatedSessions);

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
    createdSessions.push(session);

    await runPrompt(session);

    expect(connection.messages.map((m) => m.kind)).toStrictEqual([
      'sessionUpdate',
      'requestPermission',
      'sessionUpdate',
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
    createdSessions.push(session);

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
    createdSessions.push(session);

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
    createdSessions.push(session);

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
  afterEach(disposeCreatedSessions);

  it('maps done reasons to ACP stop reasons and terminal errors', async () => {
    const aborted = createSession(
      buildFakeAgent([{ type: 'done', reason: 'aborted' }]).agent,
      new RecordingConnection(),
    );
    createdSessions.push(aborted);
    await expect(runPrompt(aborted)).resolves.toStrictEqual({
      stopReason: 'cancelled',
    });

    const maxTurns = createSession(
      buildFakeAgent([{ type: 'done', reason: 'max-turns' }]).agent,
      new RecordingConnection(),
    );
    createdSessions.push(maxTurns);
    await expect(runPrompt(maxTurns)).resolves.toStrictEqual({
      stopReason: 'max_turn_requests',
    });

    const contextOverflow = createSession(
      buildFakeAgent([{ type: 'done', reason: 'context-overflow' }]).agent,
      new RecordingConnection(),
    );
    createdSessions.push(contextOverflow);
    await expect(runPrompt(contextOverflow)).resolves.toStrictEqual({
      stopReason: 'max_tokens',
    });

    const errorSession = createSession(
      buildFakeAgent([{ type: 'done', reason: 'error' }]).agent,
      new RecordingConnection(),
    );
    createdSessions.push(errorSession);
    await expect(runPrompt(errorSession)).rejects.toThrow(
      /terminal reason: error/,
    );

    const hookStoppedSession = createSession(
      buildFakeAgent([{ type: 'done', reason: 'hook-stopped' }]).agent,
      new RecordingConnection(),
    );
    createdSessions.push(hookStoppedSession);
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
    createdSessions.push(session);

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
    createdSessions.push(session);

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
    createdSessions.push(session);

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
  afterEach(disposeCreatedSessions);

  it('handles notice, loop detection, errors, and ignored metadata events', async () => {
    const notice = createSession(
      buildFakeAgent([
        { type: 'notice', message: 'Heads up!' },
        { type: 'loop-detected' },
      ]).agent,
      new RecordingConnection(),
    );
    createdSessions.push(notice);
    await expect(runPrompt(notice)).resolves.toStrictEqual({
      stopReason: 'end_turn',
    });

    const invalid = createSession(
      buildFakeAgent([{ type: 'invalid-stream' }]).agent,
      new RecordingConnection(),
    );
    createdSessions.push(invalid);
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
    createdSessions.push(hookBlocked);
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
    createdSessions.push(ignored);
    await expect(runPrompt(ignored)).resolves.toStrictEqual({
      stopReason: 'end_turn',
    });
  });
});

describe('Zed Session (Agent API) - lifecycle', () => {
  afterEach(disposeCreatedSessions);

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

describe('Zed Session.prompt (Agent API) - session_info_update (issue #1611)', () => {
  afterEach(disposeCreatedSessions);

  it('emits a session_info_update with a title derived from the first prompt', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'Investigate session lifecycle' }],
    });

    const infoUpdates = connection.sessionInfoUpdates();
    expect(infoUpdates).toHaveLength(1);
    expect(infoUpdates[0].title).toBe('Investigate session lifecycle');
    expect(infoUpdates[0].updatedAt).toStrictEqual(expect.any(String));
  });

  it('emits updatedAt on a subsequent prompt without regenerating the title', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'First prompt here' }],
    });
    const firstInfoUpdates = connection.sessionInfoUpdates();

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'Second prompt here' }],
    });

    const infoUpdates = connection.sessionInfoUpdates();
    expect(firstInfoUpdates).toHaveLength(1);
    expect(infoUpdates).toHaveLength(2);
    expect(infoUpdates[1].updatedAt).toStrictEqual(expect.any(String));
    expect(infoUpdates[1].title).toBeUndefined();
  });

  it('emits updatedAt after a cancelled turn', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'aborted' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const response = await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'A prompt that gets cancelled' }],
    });

    expect(response.stopReason).toBe('cancelled');
    const infoUpdates = connection.sessionInfoUpdates();
    expect(infoUpdates).toHaveLength(1);
    expect(infoUpdates[0].updatedAt).toStrictEqual(expect.any(String));
  });

  it('emits updatedAt after a failed turn (error event)', async () => {
    const { agent } = buildFakeAgent([
      { type: 'error', error: { message: 'kaboom' } },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await expect(
      session.prompt({
        sessionId: 'test-session-id',
        prompt: [{ type: 'text', text: 'A prompt that errors' }],
      }),
    ).rejects.toThrow(/kaboom/);

    const infoUpdates = connection.sessionInfoUpdates();
    expect(infoUpdates).toHaveLength(1);
    expect(infoUpdates[0].updatedAt).toStrictEqual(expect.any(String));
  });

  it('does not emit a title when the first prompt has no text content', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'resource_link', uri: 'file:///p', name: 'p.ts' }],
    });

    const infoUpdates = connection.sessionInfoUpdates();
    expect(infoUpdates).toHaveLength(1);
    expect(infoUpdates[0].updatedAt).toStrictEqual(expect.any(String));
    expect(infoUpdates[0].title).toBeUndefined();
  });

  it('exposes the derived title and updatedAt via getLifecycleInfo for the session listing', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'Listing title here' }],
    });

    const info = session.getLifecycleInfo();
    expect(info.title).toBe('Listing title here');
    expect(info.updatedAt).toStrictEqual(expect.any(String));
  });
});
