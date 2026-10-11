/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';

import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { json } from 'node:stream/consumers';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ApprovalMode,
  fromConfig,
  toConfigParameters,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import {
  type LoadBalancerProfile,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { createObservedChildTask } from './helpers/child-parameter-tool.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface Wire {
  model: string;
  temperature?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  messages?: unknown;
}

async function endpoint(
  holdFirst: boolean,
  toolDirectory?: string,
  failFirst = false,
): Promise<{
  url: string;
  received: Promise<void>;
  release(): void;
  requests(): readonly Wire[];
  stop(): Promise<void>;
}> {
  const received = gate();
  const release = gate();
  const requests: Wire[] = [];
  const server = createServer((request, reply) => {
    void json(request)
      .then(async (body: unknown) => {
        if (
          typeof body !== 'object' ||
          body === null ||
          !('model' in body) ||
          typeof body.model !== 'string'
        )
          throw new Error('Invalid HTTP request');
        const wire = body as Wire;
        requests.push(wire);
        if (holdFirst && requests.length === 1) {
          received.release();
          await release.promise;
        }
        if (failFirst) {
          reply.writeHead(503, { 'Content-Type': 'application/json' });
          reply.end(
            JSON.stringify({ error: { message: 'Primary unavailable' } }),
          );
          return;
        }
        const useTool = toolDirectory !== undefined && requests.length === 1;
        const chunk = {
          id: 'child-capture',
          object: 'chat.completion.chunk',
          model: wire.model,
          choices: [
            {
              index: 0,
              delta: useTool
                ? {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'child-list-directory',
                        type: 'function',
                        function: {
                          name: 'list_directory',
                          arguments: JSON.stringify({
                            dir_path: toolDirectory,
                          }),
                        },
                      },
                    ],
                  }
                : { role: 'assistant', content: 'Done.' },
              finish_reason: useTool ? 'tool_calls' : 'stop',
            },
          ],
        };
        reply.writeHead(200, { 'Content-Type': 'text/event-stream' });
        reply.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      })
      .catch((error: unknown) =>
        reply.destroy(error instanceof Error ? error : undefined),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    received: received.promise,
    release: release.release,
    requests: () => requests,
    stop: async () => {
      release.release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function exercise(
  interactive: boolean,
  loadBalanced = false,
): Promise<number> {
  let childRequests = 0;
  const directory = await mkdtemp(join(tmpdir(), 'child-parameter-admission-'));
  const parent = await endpoint(true);
  const child = await endpoint(!loadBalanced, directory);
  const primary = loadBalanced
    ? await endpoint(true, undefined, true)
    : undefined;
  let definitions: WorkspaceDefinitionOwner | undefined;
  let config: Config | undefined;
  let workspace: McpRuntimeOwner | undefined;
  let agent: Agent | undefined;
  let selectedChildSettings: SettingsService | undefined;
  const abort = new AbortController();
  try {
    definitions = new WorkspaceDefinitionOwner(
      join(directory, 'profiles'),
      join(directory, 'subagents'),
    );
    const profiles = definitions.profileWrites;
    const childProfile = (temperature: number, presence_penalty: number) => ({
      version: 1,
      provider: 'openai',
      model: 'child-model',
      modelParams: { temperature },
      ephemeralSettings: {
        'auth-key': 'test-key',
        'base-url': child.url,
        presence_penalty,
      },
    });
    const member = (model: string, url: string, penalty: number) => ({
      version: 1,
      provider: 'openai',
      model,
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'test-key',
        'base-url': url,
        presence_penalty: penalty,
      },
    });
    const lbProfile = (temperature: number): LoadBalancerProfile => ({
      version: 1,
      type: 'loadbalancer',
      provider: '',
      model: '',
      modelParams: { temperature },
      ephemeralSettings: {},
      policy: 'failover',
      profiles: ['primary', 'secondary'],
    });
    if (primary) {
      await profiles.saveProfile(
        'primary',
        member('primary-model', primary.url, 0.2),
      );
      await profiles.saveProfile(
        'secondary',
        member('secondary-model', child.url, 0.4),
      );
      await profiles.saveProfile('child', lbProfile(0.3));
    } else {
      await profiles.saveProfile('child', childProfile(0.3, 0.4));
    }
    const subagents = definitions.subagentWrites;
    await subagents.saveSubagent('child', 'child', 'Complete the goal.');
    const factories = createAgentRuntimeFactoryBindings();
    config = new Config({
      ...toConfigParameters({
        provider: 'openai',
        model: 'parent-model',
        workingDir: directory,
        approvalMode: ApprovalMode.YOLO,
        folderTrust: true,
        interactive,
        coreTools: ['task', 'list_directory'],
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
      profileDirectory: join(directory, 'profiles'),
      subagentDirectory: join(directory, 'subagents'),
      sessionId: 'child-parameter-admission',
    });
    workspace = await McpRuntimeOwner.create(createTestOAuthBinding(), config);
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    agent = await fromConfig({
      settingsService,
      settingsOwner,
      mcpRuntime: workspace,
      mcpOwnership: 'caller',
      definitionOwner: definitions,
      definitionOwnership: 'caller',
      runtimeFactoryBindings: factories,
      config,
      activation: {
        provider: 'openai',
        model: 'parent-model',
        cliOverrides: { key: 'test-key', baseUrl: parent.url },
      },
    });
    agent.setModelParam('temperature', 0.2);
    const parentAgent = agent;
    const parentRun = (async () => {
      for await (const _event of parentAgent.stream('Parent run')) {
        /* consume */
      }
    })();
    await parent.received;
    const task = createObservedChildTask(
      agent,
      config,
      agent.workspace.subagentDefinitions,
      agent.workspace.profileDefinitions,
      (settings) => {
        selectedChildSettings = settings;
      },
      workspace.workspacePaths,
      workspace.workspaceMemory.operations,
      workspace.readInstructions,
      settingsOwner,
      workspace.trust,
    );
    const taskArguments = {
      subagent_name: 'child',
      goal_prompt: 'Complete the goal.',
      async: false,
      max_turns: 2,
    };
    const first = task.buildAndExecute(taskArguments, abort.signal);
    await Promise.race([
      primary?.received ?? child.received,
      first.then((result) => {
        throw new Error(
          `Child ended before its first HTTP request: ${JSON.stringify(result)}`,
        );
      }),
    ]);
    expect(primary?.requests() ?? child.requests()).toHaveLength(1);
    if (!selectedChildSettings) throw new Error('Child settings unavailable');
    expect(selectedChildSettings).not.toBe(settingsService);
    if (primary) {
      selectedChildSettings.set('providers.openai.frequency_penalty', 0.55);
      await profiles.saveProfile('secondary', {
        ...member('secondary-model', child.url, 0.8),
        ephemeralSettings: {
          ...member('secondary-model', child.url, 0.8).ephemeralSettings,
          frequency_penalty: 0.6,
        },
      });
      await profiles.saveProfile('child', lbProfile(0.7));
    } else {
      selectedChildSettings.set('providers.openai.temperature', 0.6);
      selectedChildSettings.set('providers.openai.presence_penalty', 0.65);
      await profiles.saveProfile('child', childProfile(0.7, 0.8));
    }
    expect(selectedChildSettings.getProviderSettings('openai')).toMatchObject(
      primary
        ? { frequency_penalty: 0.55 }
        : { temperature: 0.6, presence_penalty: 0.65 },
    );
    agent.setModelParam('temperature', 0.9);
    primary?.release();
    child.release();
    await first;
    expect(child.requests().length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(child.requests()[1]?.messages)).toContain(
      '"role":"tool"',
    );
    expect(
      child
        .requests()
        .slice(0, 2)
        .map((request) => [request.temperature, request.presence_penalty]),
    ).toStrictEqual([
      [0.3, 0.4],
      [0.3, 0.4],
    ]);
    if (primary) {
      expect(primary.requests()[0]).toMatchObject({
        model: 'primary-model',
        temperature: 0.3,
        presence_penalty: 0.2,
      });
      expect(
        child
          .requests()
          .slice(0, 2)
          .map((request) => request.frequency_penalty),
      ).toStrictEqual([undefined, undefined]);
    }
    agent.injectSteer('Continue the parent run');
    parent.release();
    await parentRun;
    expect(
      parent.requests().map((request) => request.temperature),
    ).toStrictEqual([0.2, 0.2]);
    await task.buildAndExecute(taskArguments, abort.signal);
    expect(child.requests().slice(2)[0]).toMatchObject({
      temperature: 0.7,
      presence_penalty: 0.8,
      ...(primary ? { frequency_penalty: 0.6 } : {}),
    });
    for await (const _event of agent.stream('Next parent run')) {
      /* consume */
    }
    expect(parent.requests()[parent.requests().length - 1]?.temperature).toBe(
      0.9,
    );
    childRequests = child.requests().length;
  } finally {
    abort.abort();
    parent.release();
    child.release();
    primary?.release();
    await agent?.dispose();
    await workspace?.dispose();
    await config?.dispose();
    await definitions?.dispose();
    await parent.stop();
    await child.stop();
    await primary?.stop();
    await rm(directory, { recursive: true, force: true });
  }
  return childRequests;
}

describe('TaskTool child parameter admission over real HTTP', () => {
  it('holds interactive child goal parameters independently from the parent and next child', async () => {
    expect(await exercise(true)).toBe(3);
  }, 30000);
  it('holds noninteractive child goal parameters independently from the parent and next child', async () => {
    expect(await exercise(false)).toBe(3);
  }, 30000);
  it('keeps both captured member partitions on an HTTP failover and tool continuation', async () => {
    expect(await exercise(false, true)).toBe(3);
  }, 30000);
});
