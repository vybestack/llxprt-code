/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ApprovalMode,
  createAgent,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import {
  saveInitialChildProfiles,
  saveNextChildProfiles,
  startChildParameterEndpoint,
} from './helpers/child-parameter-http.js';

async function exercise(
  interactive: boolean,
  loadBalanced = false,
): Promise<number> {
  let childRequests = 0;
  const directory = await mkdtemp(join(tmpdir(), 'child-parameter-admission-'));
  const parent = await startChildParameterEndpoint(true);
  const child = await startChildParameterEndpoint(!loadBalanced, directory);
  const primary = loadBalanced
    ? await startChildParameterEndpoint(true, undefined, true)
    : undefined;
  let definitions: WorkspaceDefinitionOwner | undefined;
  let agent: Agent | undefined;
  const abort = new AbortController();
  try {
    definitions = new WorkspaceDefinitionOwner(
      join(directory, 'profiles'),
      join(directory, 'subagents'),
    );
    const profiles = definitions.profileWrites;
    const endpoints = { childUrl: child.url, primaryUrl: primary?.url };
    await saveInitialChildProfiles(profiles, endpoints);
    await definitions.subagentWrites.saveSubagent(
      'child',
      'child',
      'Complete the goal.',
    );
    agent = await createAgent({
      provider: 'openai',
      model: 'parent-model',
      workingDir: directory,
      approvalMode: ApprovalMode.YOLO,
      folderTrust: true,
      interactive,
      coreTools: ['task', 'list_directory'],
      telemetry: { enabled: false },
      recording: { enabled: false },
      auth: { apiKey: 'test-key', baseUrl: parent.url },
      definitionOwner: definitions,
      definitionOwnership: 'caller',
    });
    agent.setModelParam('temperature', 0.2);
    const parentAgent = agent;
    const parentRun = (async () => {
      for await (const _event of parentAgent.stream('Parent run')) {
        /* consume */
      }
    })();
    await parent.received;
    const task = agent.tools.get('task');
    if (task === undefined) throw new Error('Missing task tool');
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
    await saveNextChildProfiles(profiles, endpoints);
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
    await definitions?.dispose();
    await parent.stop();
    await child.stop();
    await primary?.stop();
    await rm(directory, { recursive: true, force: true });
  }
  return childRequests;
}

describe('task tool child parameter admission over real HTTP', () => {
  it('launches an interactive child with the profile parameters while the parent parameters change', async () => {
    expect(await exercise(true)).toBe(3);
  }, 30000);
  it('launches a noninteractive child with the profile parameters while the parent parameters change', async () => {
    expect(await exercise(false)).toBe(3);
  }, 30000);
  it('keeps both load-balancer member partitions on an HTTP failover and tool continuation', async () => {
    expect(await exercise(false, true)).toBe(3);
  }, 30000);
});
