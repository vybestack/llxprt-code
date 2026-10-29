/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { Task } from '../agent/task.js';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { getProjectHash, SessionDiscovery } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';
import { describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectJournalFileRowsForAssertions } from '../../../test-utils/src/core/collect-rows-for-assertions.js';
import { CoderAgentExecutor } from '../agent/executor.js';
import { createTaskAgentConfig } from '../config/config.js';
import { createConfirmationMessageRequest } from '../utils/__tests__/testing_utils.js';
import { createApp } from './app.js';

interface ObservedEvent {
  taskId: string | undefined;
  contextId: string | undefined;
  final: boolean;
  state: string | undefined;
  awaitingApproval: boolean;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid protocol object');
  return Object.fromEntries(Object.entries(value));
}

function observeEvent(value: unknown): ObservedEvent {
  const result = record(record(value)['result']);
  const status = result['status'] === undefined ? {} : record(result['status']);
  const message =
    status['message'] === undefined ? {} : record(status['message']);
  const parts = message['parts'];
  return {
    taskId: typeof result['taskId'] === 'string' ? result['taskId'] : undefined,
    contextId:
      typeof result['contextId'] === 'string' ? result['contextId'] : undefined,
    final: result['final'] === true,
    state: typeof status['state'] === 'string' ? status['state'] : undefined,
    awaitingApproval:
      Array.isArray(parts) &&
      parts.some((part: unknown) => {
        const data = record(part)['data'];
        return (
          data !== undefined && record(data)['status'] === 'awaiting-approval'
        );
      }),
  };
}

async function nativeRows(
  path: string,
): Promise<{ rows: number; humans: number; calls: number; results: number }> {
  let counts = { rows: 0, humans: 0, calls: 0, results: 0 };
  await collectJournalFileRowsForAssertions(path, (rows) => {
    counts = {
      rows: rows.length,
      humans: rows.filter((row) => row.speaker === 'human').length,
      calls: rows
        .flatMap((row) => row.blocks)
        .filter((block) => block.type === 'tool_call').length,
      results: rows
        .flatMap((row) => row.blocks)
        .filter((block) => block.type === 'tool_response').length,
    };
  });
  return counts;
}

describe('native A2A task protocol', () => {
  it('persists a real HTTP approval/tool continuation and next message under the same task identity', async () => {
    const saved = { ...process.env };
    const cwd = process.cwd();
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'w23-a2a-native-protocol-')),
    );
    const fixture = join(root, 'turns.jsonl');
    await writeFile(
      fixture,
      [
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'native-write',
                  name: 'write_file',
                  parameters: {
                    absolute_path: join(root, 'output.txt'),
                    content: 'A2A native file evidence',
                  },
                },
              ],
            },
          ],
        },
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'Write completed.' }],
            },
          ],
        },
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'Next turn completed.' }],
            },
          ],
        },
        {
          chunks: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'cancel-write',
                  name: 'write_file',
                  parameters: {
                    absolute_path: join(root, 'canceled.txt'),
                    content: 'This write must remain unapproved.',
                  },
                },
              ],
            },
          ],
        },
      ]
        .map((value) => JSON.stringify(value))
        .join('\n') + '\n',
    );

    process.env.LLXPRT_FAKE_RESPONSES = fixture;
    process.env.LLXPRT_LOG_HOME = join(root, 'logs');
    process.env.LLXPRT_DEFAULT_PROVIDER = 'fake';
    delete process.env.LLXPRT_YOLO_MODE;
    process.chdir(root);
    const agents: Agent[] = [];
    const store = new InMemoryTaskStore();
    const executor = new CoderAgentExecutor(
      store,
      async (taskId, contextId, _settings, eventBus) => {
        const agent = await createAgent(
          createTaskAgentConfig(
            { folderTrust: true, coreTools: ['write_file'] },
            [],
            taskId,
          ),
        );
        agents.push(agent);
        await agent.session.setRecording({ enabled: true });
        return new Task(
          taskId,
          contextId,
          (input, options) => agent.stream(input, options),
          (text) => agent.injectSteer(text),
          () => agent.getModel(),
          () => agent.getProvider(),
          () => agent.listTools(),
          () => agent.mcp.listServers(),
          (id, decision, payload, confirmation) =>
            agent.tools.respondToConfirmation(
              id,
              decision,
              payload,
              confirmation,
            ),
          () => agent.dispose(),
          eventBus,
        );
      },
    );
    const app = await createApp({
      createStartupContext: async () => ({
        extensions: [],
        model: 'fake-model',
        git: undefined,
        checkpointing: {
          enabled: false,
          getProjectTempCheckpointsDir: () => join(root, 'checkpoints'),
        },
        agentExecutor: executor,
        taskStoreForExecutor: store,
        taskStoreForHandler: store,
      }),
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing A2A HTTP port');
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    async function send(message: unknown): Promise<ObservedEvent[]> {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      });
      expect(response.status).toBe(200);
      return (await response.text())
        .split('\n\n')
        .filter(Boolean)
        .map((chunk) => {
          const data = chunk
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (data === undefined) throw new Error('Missing SSE data');
          return observeEvent(JSON.parse(data.slice(6)));
        });
    }
    try {
      const initial = await send({
        jsonrpc: '2.0',
        id: 'first',
        method: 'message/stream',
        params: {
          message: {
            kind: 'message',
            role: 'user',
            messageId: 'write-request',
            parts: [{ kind: 'text', text: 'Write output.txt' }],
          },
        },
      });
      const approval = initial.find((event) => event.awaitingApproval);
      if (approval?.taskId === undefined || approval.contextId === undefined)
        throw new Error('Missing task approval identity');
      const { taskId, contextId } = approval;
      const confirmed = await send(
        createConfirmationMessageRequest(
          'native-write',
          'proceed_once',
          'approval',
          taskId,
          contextId,
        ),
      );
      expect(confirmed[confirmed.length - 1]).toMatchObject({
        taskId,
        contextId,
        final: true,
        state: 'input-required',
      });
      expect(confirmed.filter((event) => event.final)).toHaveLength(1);
      expect(await readFile(join(root, 'output.txt'), 'utf8')).toBe(
        'A2A native file evidence',
      );
      const agent = agents.find(
        (candidate) => candidate.session.getSessionId() === taskId,
      );
      if (agent === undefined) throw new Error('Missing task Agent');
      await agent.session.flushRecording();
      const storage = new Storage(root);
      const recorded = (
        await SessionDiscovery.listSessions(
          storage.getProjectChatsDir(),
          getProjectHash(root),
        )
      ).find((session) => session.sessionId === taskId);
      if (recorded === undefined)
        throw new Error('Missing native task recording');
      expect(await nativeRows(recorded.filePath)).toStrictEqual({
        rows: 4,
        humans: 1,
        calls: 1,
        results: 1,
      });
      expect(recorded.projectHash).toBe(getProjectHash(root));
      const next = await send({
        jsonrpc: '2.0',
        id: 'next',
        method: 'message/stream',
        params: {
          message: {
            kind: 'message',
            role: 'user',
            messageId: 'next-request',
            taskId,
            contextId,
            parts: [{ kind: 'text', text: 'Continue' }],
          },
        },
      });
      expect(next[next.length - 1]).toMatchObject({
        taskId,
        contextId,
        final: true,
        state: 'input-required',
      });
      expect(agents).toHaveLength(1);
      await agent.session.flushRecording();
      expect(await nativeRows(recorded.filePath)).toStrictEqual({
        rows: 6,
        humans: 2,
        calls: 1,
        results: 1,
      });
      expect(
        (await readdir(storage.getProjectChatsDir())).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toHaveLength(1);
      const pending = await send({
        jsonrpc: '2.0',
        id: 'cancel-turn',
        method: 'message/stream',
        params: {
          message: {
            kind: 'message',
            role: 'user',
            messageId: 'cancel-request',
            taskId,
            contextId,
            parts: [{ kind: 'text', text: 'Prepare another write' }],
          },
        },
      });
      expect(pending.find((event) => event.awaitingApproval)).toMatchObject({
        taskId,
        contextId,
      });
      const canceledResponse = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'cancel',
          method: 'tasks/cancel',
          params: { id: taskId },
        }),
      });
      expect(canceledResponse.status).toBe(200);
      const canceled = record(record(await canceledResponse.json())['result']);
      expect(canceled['id']).toBe(taskId);
      expect(canceled['contextId']).toBe(contextId);
      expect(record(canceled['status'])['state']).toBe('canceled');
      expect((await store.load(taskId))?.status.state).toBe('canceled');
      expect(await readdir(root)).not.toContain('canceled.txt');
      await executor.getTask(taskId)?.task.dispose();
      expect(await nativeRows(recorded.filePath)).toMatchObject({
        humans: 3,
        calls: 2,
      });
      expect(
        (await readdir(storage.getProjectChatsDir())).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toStrictEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      for (const task of executor.getAllTasks()) await task.task.dispose();
      process.chdir(cwd);
      for (const key of [
        'LLXPRT_FAKE_RESPONSES',
        'LLXPRT_LOG_HOME',
        'LLXPRT_DEFAULT_PROVIDER',
        'LLXPRT_YOLO_MODE',
      ]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  }, 30000);
});
