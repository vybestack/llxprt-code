import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentBusyError, type Agent } from '@vybestack/llxprt-code-agents';
import {
  collect,
  successful,
  withOwners,
} from './turn-revision-capture.fixture.js';

async function busy(operation: Promise<unknown>): Promise<void> {
  const outcome = await operation.then(
    () => ({ status: 'unexpected-success' }),
    (error: unknown) => ({ status: 'rejected', error }),
  );
  expect(outcome).toMatchObject({
    status: 'rejected',
    error: { code: 'busy' },
  });
  if (!('error' in outcome)) throw new Error('Rebuild unexpectedly succeeded');
  expect(outcome.error).toBeInstanceOf(AgentBusyError);
}

async function excludeRebuilds(agent: Agent): Promise<void> {
  const client = fixtureAgentResources(agent).publishedClient(agent);
  await busy(agent.setModel('competing-model'));
  await busy(agent.setProvider('anthropic', 'competing-provider-model'));
  await busy(agent.sessionClient.refreshAuth());
  await busy(agent.resetChat());
  await busy(agent.session.startNewSession());
  await busy(
    agent.profiles.applySnapshot({
      version: 1,
      provider: 'openai',
      model: 'competing-profile',
      modelParams: {},
      ephemeralSettings: {},
    }),
  );
  expect(fixtureAgentResources(agent).publishedClient(agent)).toBe(client);
  expect(agent.getModel()).toBe('capture-a');
}

async function immutableTool(agent: Agent): Promise<void> {
  const directory = agent.workspace.getWorkingDirectory();
  await writeFile(join(directory, 'original.txt'), 'captured physical record');
  await writeFile(
    join(directory, 'replacement.txt'),
    'replacement physical record',
  );
  const reader = agent.tools.get('read_file');
  if (reader === undefined) throw new Error('Missing admitted reader');
  const params = { absolute_path: join(directory, 'original.txt') };
  const invocation = reader.build(params);
  params.absolute_path = join(directory, 'replacement.txt');
  const result = await invocation.execute(new AbortController().signal);
  expect(String(result.llmContent)).toContain('captured physical record');
  expect(String(result.llmContent)).not.toContain(
    'replacement physical record',
  );
  expect(await readFile(join(directory, 'original.txt'), 'utf8')).toBe(
    'captured physical record',
  );
}

export async function runSameAgentAdmission(): Promise<readonly string[]> {
  let models: readonly string[] = [];
  await withOwners(async (a, b, wire, _peer, start) => {
    const input: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: 'captured turn input' },
    ];
    const stop = ['original-stop'];
    a.setModelParam('stop', stop);
    const first = collect(a.stream(input, { mcpDiscovery: 'skip' }));
    await Promise.race([
      wire.entered,
      first.then((result) => {
        throw new Error(`Turn missed wire boundary: ${JSON.stringify(result)}`);
      }),
    ]);
    input[0].text = 'mutated turn input';
    stop.push('mutated-stop');
    await excludeRebuilds(a);
    await immutableTool(a);
    const second = await start(a, 'Must not reach a replacement loop');
    expect(second.rejection).toBeInstanceOf(AgentBusyError);
    expect(second.rejection).toMatchObject({ code: 'busy' });
    expect(wire.requests()).toHaveLength(1);
    successful(await start(b, 'Peer remains independently admitted'));
    a.injectSteer('steering stays on the admitted run');
    wire.release();
    successful(await first);
    expect(wire.requests()).toHaveLength(2);
    expect(wire.requests()[1]).toMatchObject({
      model: 'capture-a',
      stop: ['original-stop'],
    });
    expect(JSON.stringify(wire.requests()[1]?.messages)).toContain(
      'steering stays on the admitted run',
    );
    expect(JSON.stringify(wire.requests()[1]?.messages)).toContain(
      'captured turn input',
    );
    expect(JSON.stringify(wire.requests()[1]?.messages)).not.toContain(
      'mutated turn input',
    );
    await a.profiles.applySnapshot({
      version: 1,
      provider: 'openai',
      model: 'after-safe-boundary',
      modelParams: { temperature: 0.4 },
      ephemeralSettings: {
        'base-url': wire.url,
        'auth-key': 'turn-capture-local-only',
      },
    });
    successful(await start(a, 'Fresh turn after actual profile transaction'));
    expect(wire.requests()[2]).toMatchObject({
      model: 'after-safe-boundary',
      temperature: 0.4,
    });
    models = wire.requests().map((request) => request.model);
  });
  return models;
}
