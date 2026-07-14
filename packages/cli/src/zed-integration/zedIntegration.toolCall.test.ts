/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';

import {
  buildFakeAgent,
  RecordingConnection,
  createSession,
  runPrompt,
} from './zed-test-helpers.js';

import type { Session } from './zedIntegration.js';

const createdSessions: Session[] = [];

async function disposeCreatedSessions(): Promise<void> {
  await Promise.allSettled(
    createdSessions.splice(0).map((session) => session.dispose()),
  );
}

describe('Zed Session.prompt (Agent API) - tool-call status progression', () => {
  afterEach(disposeCreatedSessions);

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
    createdSessions.push(session);

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
      rawInput?: Record<string, unknown>;
    };
    expect(startUpdate.status).toBe('in_progress');
    expect(startUpdate.locations).toStrictEqual([
      { path: '/project/file.txt', line: 7 },
    ]);
    // The live tool_call start carries rawInput for replay parity and ACP debugging.
    expect(startUpdate.rawInput).toStrictEqual({
      absolute_path: '/project/file.txt',
      offset: 7,
    });
    expect((updates[1] as { status: string }).status).toBe('in_progress');
    expect((updates[2] as { status: string }).status).toBe('completed');
  });

  it('uses the registered tool kind on every live tool notification', async () => {
    const toolCallId = 'registry-kind';
    const { agent } = buildFakeAgent(
      [
        {
          type: 'tool-call',
          call: { id: toolCallId, name: 'custom_lookup', args: {} },
        },
        {
          type: 'tool-status',
          update: {
            id: toolCallId,
            name: 'custom_lookup',
            status: 'executing',
          },
        },
        {
          type: 'tool-result',
          result: { id: toolCallId, name: 'custom_lookup', output: 'found' },
        },
        { type: 'done', reason: 'stop' },
      ],
      { custom_lookup: 'search' },
    );
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await runPrompt(session);

    expect(
      connection
        .onlySessionUpdates()
        .map((update) => (update as { kind?: acp.ToolKind }).kind),
    ).toStrictEqual(['search', 'search', 'search']);
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
    createdSessions.push(session);

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

  it('coerces string-typed numeric line/offset args to numeric locations', async () => {
    const { agent } = buildFakeAgent([
      {
        type: 'tool-call',
        call: {
          id: 'str-offset',
          name: 'read_file',
          args: { absolute_path: '/project/file.txt', offset: '7' },
        },
      },
      {
        type: 'tool-call',
        call: {
          id: 'str-start-line',
          name: 'delete_line_range',
          args: { absolute_path: '/project/c.ts', start_line: '42' },
        },
      },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await runPrompt(session);

    const updates = connection.onlySessionUpdates();
    expect(updates[0]).toMatchObject({
      locations: [{ path: '/project/file.txt', line: 7 }],
    });
    expect(updates[1]).toMatchObject({
      locations: [{ path: '/project/c.ts', line: 42 }],
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
    createdSessions.push(session);

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
    createdSessions.push(session);

    await runPrompt(session);

    const updates = connection.onlySessionUpdates();
    const failed = updates[1] as {
      status: string;
      content: acp.ToolCallContent[];
    };
    expect(failed.status).toBe('failed');
    expect(failed.content).toStrictEqual([
      { type: 'content', content: { type: 'text', text: 'boom' } },
    ]);
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
