/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ApprovalMode,
  fromConfig,
  toConfigParameters,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import {
  AsyncTaskManager,
  type AsyncTaskInfo,
} from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';

const maximumKey = 'task-max-timeout-seconds';
const defaultKey = 'task-default-timeout-seconds';
const childName = 'timeout-validation-child';
const childMessage = 'Completed after repairing the timeout setting.';

function completion(): string {
  return (
    [
      {
        id: 'timeout-validation-response',
        object: 'chat.completion.chunk',
        model: 'timeout-validation-child-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: childMessage },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'timeout-validation-response',
        object: 'chat.completion.chunk',
        model: 'timeout-validation-child-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

interface Fixture {
  agent: Agent;
  config: Config;
  manager: AsyncTaskManager;
  requests: unknown[];
}

async function withTimeoutFixture(
  scenario: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'task-timeout-validation-'));
  const requests: unknown[] = [];
  const errors: unknown[] = [];
  const server = createServer((request, response) => {
    const receive = async (): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(completion());
    };
    void receive().catch((error: unknown) => {
      errors.push(error);
      response.destroy();
    });
  });
  const manager = new AsyncTaskManager(1);
  let config: Config | undefined;
  let agent: Agent | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('No HTTP port');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const profiles = new ProfileManager(join(directory, 'profiles'));
    await profiles.saveProfile(childName, {
      version: 1,
      provider: 'openai',
      model: 'timeout-validation-child-model',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'local-test-key',
        'base-url': baseUrl,
      },
    });
    const subagents = new SubagentManager(
      join(directory, 'subagents'),
      profiles,
    );
    await subagents.saveSubagent(childName, childName, 'Complete the task.');
    const factories = createAgentRuntimeFactoryBindings();
    config = new Config({
      ...toConfigParameters({
        provider: 'openai',
        model: 'timeout-validation-parent-model',
        workingDir: directory,
        approvalMode: ApprovalMode.YOLO,
        folderTrust: true,
        interactive: false,
        coreTools: ['task', 'check_async_tasks'],
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
      profileDirectory: join(directory, 'profiles'),
      subagentDirectory: join(directory, 'subagents'),
      sessionId: 'task-timeout-validation-session',
    });
    agent = await fromConfig({
      settingsService: new SettingsService(),
      runtimeFactoryBindings: factories,
      config,
      asyncTaskManager: manager,
      activation: {
        provider: 'openai',
        model: 'timeout-validation-parent-model',
        cliOverrides: { key: 'local-test-key', baseUrl },
      },
    });
    agent.setEphemeralSetting('task-max-async', 1);
    agent.setEphemeralSetting(defaultKey, 60);
    agent.setEphemeralSetting(maximumKey, 100);
    await scenario({ agent, config, manager, requests });
  } catch (error) {
    errors.push(error);
  } finally {
    for (const cleanup of [
      async (): Promise<void> => agent?.dispose(),
      async (): Promise<void> => config?.dispose(),
      async (): Promise<void> => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      },
      async (): Promise<void> =>
        rm(directory, { recursive: true, force: true }),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'Task timeout validation fixture failed');
}

async function verifySetting(
  fixture: Fixture,
  key: string,
  invalid: number,
  background: boolean,
): Promise<void> {
  const { agent, manager, requests } = fixture;
  const task = agent.tools.get('task');
  if (!task) throw new Error('Public direct task handle unavailable');
  const params = {
    subagent_name: childName,
    goal_prompt: 'Complete without calling tools.',
    tool_whitelist: [],
    async: background,
  };
  agent.setEphemeralSetting(key, invalid);
  expect(agent.getEphemeralSetting(key)).toBe(invalid);
  let rejectionMessage: string | undefined;
  if (background) {
    const rejected = await task.buildAndExecute(
      params,
      new AbortController().signal,
    );
    const error = z
      .object({ type: z.string(), message: z.string() })
      .parse(rejected.error);
    expect(error.type).not.toBe(ToolErrorType.TIMEOUT);
    rejectionMessage = error.message;
  } else {
    const rejected: unknown = await task
      .buildAndExecute(params, new AbortController().signal)
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Error);
    if (!(rejected instanceof Error))
      throw new Error('Expected validation error');
    rejectionMessage = rejected.message;
  }
  expect(rejectionMessage).toContain(key);
  expect(rejectionMessage).toContain('-1');
  expect(rejectionMessage).toContain('finite number');
  expect(rejectionMessage).toContain('greater than zero');
  expect(requests).toHaveLength(0);
  expect(agent.tasks.list()).toStrictEqual([]);
  expect(manager.getAllTasks()).toStrictEqual([]);
  expect(manager.canLaunchAsync().allowed).toBe(true);

  agent.setEphemeralSetting(key, key === maximumKey ? 100 : 60);
  const subscriptions: Array<() => void> = [];
  const terminal = new Promise<AsyncTaskInfo>((resolve) => {
    subscriptions.push(
      manager.onTaskCompleted(resolve),
      manager.onTaskFailed(resolve),
      manager.onTaskCancelled(resolve),
    );
  });
  try {
    const recovered = await task.buildAndExecute(
      params,
      new AbortController().signal,
    );
    expect(recovered.error).toBeUndefined();
    if (background) {
      const outcome = await terminal;
      expect(outcome.status).toBe('completed');
      expect(outcome.output?.final_message).toBe(childMessage);
      expect(recovered.llmContent).toContain(outcome.id);
      expect(agent.tasks.list()).toHaveLength(1);
      expect(agent.tasks.get(outcome.id)?.status).toBe('completed');
    } else {
      const output = z
        .object({ final_message: z.string() })
        .parse(JSON.parse(z.string().parse(recovered.llmContent)));
      expect(output.final_message).toBe(childMessage);
      expect(agent.tasks.list()).toStrictEqual([]);
    }
    expect(requests).toHaveLength(1);
    expect(z.object({ model: z.string() }).parse(requests[0]).model).toBe(
      'timeout-validation-child-model',
    );
    await agent.dispose();
    expect(agent.tasks.listRunning()).toStrictEqual([]);
    expect(manager.getRunningTasks()).toStrictEqual([]);
    expect(manager.canLaunchAsync().allowed).toBe(true);
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
  }
}

for (const background of [false, true]) {
  describe(`public direct TaskTool ${background ? 'async' : 'foreground'} configured timeout validation`, () => {
    for (const key of [maximumKey, defaultKey]) {
      it.each([0, -2, Infinity])(
        `rejects ${key}=%s before child HTTP and permits a repaired request on the same owner`,
        async (invalid) => {
          await expect(
            withTimeoutFixture((fixture) =>
              verifySetting(fixture, key, invalid, background),
            ),
          ).resolves.toBeUndefined();
        },
        30000,
      );
    }
  });
}
