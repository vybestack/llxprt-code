/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import express from 'express';
import { Agent, createServer, request } from 'node:http';
import {
  DefaultExecutionEventBus,
  RequestContext,
  ServerCallContext,
} from '@a2a-js/sdk/server';
import { CoderAgentExecutor } from './executor.js';
import { Task } from './task.js';
import { CoderAgentEvent } from '../types.js';
import { createRequestCancellationUser } from '../http/request-cancellation.js';

class CompletedTurnExecutor extends CoderAgentExecutor {
  override async createTask(
    taskId: string,
    contextId: string,
  ): ReturnType<CoderAgentExecutor['createTask']> {
    const task = new Task(
      taskId,
      contextId,
      async function* () {
        yield { type: 'done', reason: 'stop' };
      },
      () => undefined,
      () => 'test-model',
      () => 'test-provider',
      () => [],
      () => [],
      () => undefined,
      async () => {},
    );
    return {
      task,
      id: taskId,
      agentSettings: {
        kind: CoderAgentEvent.StateAgentSettingsEvent,
        workspacePath: process.cwd(),
      },
      toSDKTask: () => ({
        kind: 'task',
        id: taskId,
        contextId,
        status: { state: task.taskState },
      }),
    };
  }
}

describe('A2A execution socket lifetime', () => {
  it('removes execution listeners when completed turns reuse a keep-alive socket', async () => {
    const counts: number[] = [];
    const app = express();
    app.get('/', (req, res, next) => {
      void (async () => {
        const before = req.socket.listenerCount('end');
        const context = new RequestContext(
          {
            kind: 'message',
            role: 'user',
            messageId: 'message',
            parts: [{ kind: 'text', text: 'go' }],
          },
          'task',
          'context',
          undefined,
          undefined,
          new ServerCallContext(
            undefined,
            await createRequestCancellationUser(req),
          ),
        );
        await new CompletedTurnExecutor().execute(
          context,
          new DefaultExecutionEventBus(),
        );
        counts.push(req.socket.listenerCount('end') - before);
        res.end('done');
      })().catch(next);
    });
    const server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected server address');
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      for (let index = 0; index < 3; index++) {
        await new Promise<void>((resolve, reject) => {
          const outgoing = request(
            { host: '127.0.0.1', port: address.port, path: '/', agent },
            (response) => {
              response.resume();
              response.on('end', resolve);
              response.on('error', reject);
            },
          );
          outgoing.on('error', reject);
          outgoing.end();
        });
      }
      expect(counts).toStrictEqual([0, 0, 0]);
    } finally {
      agent.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
