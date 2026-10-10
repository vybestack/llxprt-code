/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';

const requestedTools = ['read_file', 'write_file'];
const wireSchema = z.object({
  model: z.literal('whitelist-child-model'),
  tools: z
    .array(
      z.object({
        type: z.literal('function'),
        function: z.object({ name: z.string() }),
      }),
    )
    .optional(),
});

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function completion(): string {
  return (
    [
      {
        id: 'whitelist-response',
        object: 'chat.completion.chunk',
        model: 'whitelist-child-model',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: 'Finished without calling tools.',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'whitelist-response',
        object: 'chat.completion.chunk',
        model: 'whitelist-child-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

async function observeChild(
  blockAll: boolean,
  denyParent = false,
): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'task-child-whitelist-'));
  const received = gate();
  const releaseResponse = gate();
  const requests: unknown[] = [];
  const errors: unknown[] = [];
  const cleanupCompleted: string[] = [];
  const server = createServer((request, response) => {
    const receive = async (): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      received.release();
      await releaseResponse.promise;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(completion());
    };
    void receive().catch((error: unknown) => {
      errors.push(error);
      received.release();
      response.destroy();
    });
  });
  let config: Config | undefined;
  let agent: Agent | undefined;
  let execution: Promise<unknown> | undefined;
  let visibleTools: string[] = [];
  let result: unknown;
  let parentGovernanceSnapshot: unknown;
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
    await profiles.saveProfile('whitelist-child', {
      version: 1,
      provider: 'openai',
      model: 'whitelist-child-model',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'local-test-key',
        'base-url': baseUrl,
        'tools.allowed': [...requestedTools],
      },
    });
    const subagents = new SubagentManager(
      join(directory, 'subagents'),
      profiles,
    );
    await subagents.saveSubagent(
      'whitelist-child',
      'whitelist-child',
      'Complete the task without invoking tools.',
    );
    const factories = createAgentRuntimeFactoryBindings();
    config = new Config({
      ...toConfigParameters({
        provider: 'openai',
        model: 'whitelist-parent-model',
        workingDir: directory,
        approvalMode: ApprovalMode.YOLO,
        folderTrust: true,
        interactive: false,
        coreTools: ['task', ...requestedTools],
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
      profileDirectory: join(directory, 'profiles'),
      subagentDirectory: join(directory, 'subagents'),
      sessionId: 'task-child-whitelist-session',
    });
    agent = await fromConfig({
      settingsService: new SettingsService(),
      runtimeFactoryBindings: factories,
      config,
      activation: {
        provider: 'openai',
        model: 'whitelist-parent-model',
        cliOverrides: { key: 'local-test-key', baseUrl },
      },
    });
    const registry = agent.agentClient.tools;
    const task = agent.tools.get('task');
    if (!task) throw new Error('Public direct task handle unavailable');
    if (blockAll) await agent.tools.setEnabled(['task']);
    expect(agent.getEphemeralSetting('tools.allowed')).toStrictEqual(
      blockAll ? ['task'] : undefined,
    );
    const ephemerals = agent.getEphemeralSettings();
    parentGovernanceSnapshot = {
      effectiveAllowed: agent.getEphemeralSetting('tools.allowed'),
      flatAllowed: ephemerals['tools.allowed'],
      nestedTools: ephemerals.tools,
    };
    expect(registry.getAllTools().map((tool) => tool.name)).toStrictEqual(
      expect.arrayContaining(requestedTools),
    );
    if (blockAll)
      expect(
        agent.tools
          .list()
          .filter((tool) => tool.enabled)
          .map((tool) => tool.name),
      ).toStrictEqual(['task']);
    if (denyParent) {
      await agent.tools.setEnabled([]);
      await expect(
        task.buildAndExecute(
          {
            subagent_name: 'whitelist-child',
            goal_prompt: 'Forbidden child work',
            async: false,
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow('unavailable');
      expect(requests).toHaveLength(0);
      expect(agent.tasks.list()).toStrictEqual([]);
      return [];
    }
    const controller = new AbortController();
    const running = task.buildAndExecute(
      {
        subagent_name: 'whitelist-child',
        goal_prompt: 'Finish without using tools.',
        tool_whitelist: [...requestedTools],
        async: false,
      },
      controller.signal,
    );
    execution = running;
    try {
      const reached = await Promise.race([
        received.promise.then(() => 'http-request'),
        running.then((earlyResult) => ({ earlyResult })),
      ]);
      expect(reached).toBe('http-request');
      expect(requests).toHaveLength(1);
      const wire = wireSchema.parse(requests[0]);
      visibleTools = (wire.tools ?? [])
        .map((tool) => tool.function.name)
        .sort();
      releaseResponse.release();
      result = await running;
      expect(result).not.toHaveProperty('error');
    } finally {
      releaseResponse.release();
      controller.abort();
      await running;
    }
  } catch (error) {
    errors.push(error);
  } finally {
    releaseResponse.release();
    const steps: Array<[string, () => Promise<unknown>]> = [
      ['execution-joined', async () => execution],
      ['agent-disposed', async () => agent?.dispose()],
      ['config-disposed', async () => config?.dispose()],
      [
        'http-server-closed',
        async () => {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          });
        },
      ],
      [
        'temporary-directory-removed',
        async () => rm(directory, { recursive: true, force: true }),
      ],
    ];
    for (const [name, cleanup] of steps) {
      try {
        await cleanup();
        cleanupCompleted.push(name);
      } catch (error) {
        errors.push(error);
      }
    }
    const evidenceDirectory = process.env['TASK_WHITELIST_EVIDENCE'];
    if (evidenceDirectory)
      await writeFile(
        join(
          evidenceDirectory,
          blockAll ? 'empty-allowed-wire.json' : 'baseline-wire.json',
        ),
        JSON.stringify(
          {
            route:
              'Agent.tools.get(task).buildAndExecute, foreground raw invocation',
            parentAllowed: blockAll ? ['task'] : 'absent',
            parentGovernanceSnapshot,
            childProfileAllowed: requestedTools,
            requestedTools,
            requests,
            visibleTools,
            result,
            cleanupCompleted,
            errors: errors.map(String),
          },
          null,
          2,
        ),
      );
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'Whitelist fixture failed');
  return visibleTools;
}

describe('public direct TaskTool child whitelist preservation', () => {
  it('does not start a retained task child or HTTP request when parent selection is empty', async () => {
    expect(await observeChild(false, true)).toStrictEqual([]);
  }, 30000);
  it('baseline exposes the nonempty requested whitelist in the child HTTP request', async () => {
    expect(await observeChild(false)).toStrictEqual([...requestedTools].sort());
  }, 30000);

  it('parent task-only selection keeps the child requested whitelist empty despite child profile defaults', async () => {
    expect(await observeChild(true)).toStrictEqual([]);
  }, 30000);
});
