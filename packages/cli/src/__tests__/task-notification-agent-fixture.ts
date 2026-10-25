/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { type Agent } from '@vybestack/llxprt-code-agents';
import { openRouteAAgent } from '../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';

export async function buildTaskNotificationAgent(
  authority: CredentialAuthority,
): Promise<{ readonly agent: Agent; readonly cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'task-notification-agent-'));
  const restore = enterTaskNotificationEnvironment(directory);
  try {
    const route = await openRouteAAgent({
      authority,
      config: { workingDir: directory },
      intent: {
        activation: { provider: 'fake', model: 'fake-model', authMode: 'auto' },
      },
    });
    return {
      agent: route.agent,
      cleanup: async () => {
        try {
          await runCleanupSteps([
            () => route.close(),
            () => rm(directory, { recursive: true, force: true }),
          ]);
        } finally {
          restore();
        }
      },
    };
  } catch (primary) {
    return cleanupAfterFailure(primary, async () => {
      try {
        await rm(directory, { recursive: true, force: true });
      } finally {
        restore();
      }
    });
  }
}

function createHeldChildServer(
  accepted: () => void,
  settled: Promise<boolean>,
): Server {
  return createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      if (request.method === 'GET') {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ data: [{ id: 'notification-child' }] }));
        return;
      }
      accepted();
      void settled.then((failed) => {
        if (failed)
          response.writeHead(400, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              error: {
                message: 'Physical child failure',
                type: 'invalid_request_error',
              },
            }),
          );
        else
          response
            .writeHead(200, { 'content-type': 'text/event-stream' })
            .end(
              'data: {"id":"task-notice","choices":[{"index":0,"delta":{"content":"OLD_SESSION_OUTPUT"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            );
      });
    });
  });
}

export async function launchHeldNotificationTask(agent: Agent): Promise<{
  readonly release: (fail?: boolean) => void;
  readonly close: () => Promise<void>;
}> {
  let release!: (failed?: boolean) => void;
  let entered!: () => void;
  const held = new Promise<boolean>((resolve) => {
    release = (failed = false) => resolve(failed);
  });
  const accepted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const server = createHeldChildServer(entered, held);
  const close = async (): Promise<void> => {
    release();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
  const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing child HTTP address');
    const name = `notification-${randomUUID()}`;
    await agent.workspace.profileWrites.saveProfile(name, {
      version: 1,
      provider: 'openai',
      model: 'notification-child',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'local-child-key',
        'base-url': `http://127.0.0.1:${address.port}/v1`,
      },
    });
    await agent.workspace.subagentWrites.saveSubagent(
      name,
      name,
      'Complete the requested task.',
    );
    const task = agent.tools.get('task');
    if (!task) throw new Error('Missing public task tool');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    Reflect.deleteProperty(globalThis, 'navigator');
    const result = await task.buildAndExecute(
      { subagent_name: name, goal_prompt: 'work', async: true },
      new AbortController().signal,
    );
    if (result.error !== undefined) throw new Error(String(result.error));
    await accepted;
    return { release, close };
  } catch (primary) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [primary, cleanup],
        'Physical notification task acquisition failed',
      );
    }
    throw primary;
  } finally {
    if (navigator) Object.defineProperty(globalThis, 'navigator', navigator);
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function enterTaskNotificationEnvironment(directory: string): () => void {
  const previousHome = process.env.LLXPRT_CONFIG_HOME;
  const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_CONFIG_HOME = directory;
  process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
    new URL(
      '../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
      import.meta.url,
    ),
  );
  return (): void => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  };
}
