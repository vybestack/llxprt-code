import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import { captureAgentCreation as createAgent } from './helpers/agent-resource-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import fc from 'fast-check';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';

import type { Agent } from '../agent.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { projectCurrentSequenceModel } from '../agentStatsProjector.js';
import { SequenceModelClient } from './helpers/sequence-model-client.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

describe('Agent current sequence model delegation', () => {
  const credentials = useOwnedCredentials();
  const releases: Array<() => Promise<void>> = [];
  const suiteReleases: Array<() => Promise<void>> = [];
  afterAll(async () => runCleanupSteps(suiteReleases.splice(0).reverse()));
  beforeAll(async () => {
    const prompts = await mkdtemp(join(tmpdir(), 'sequence-model-prompts-'));
    suiteReleases.push(() => rm(prompts, { recursive: true, force: true }));
    const previous = process.env.LLXPRT_PROMPTS_DIR;
    suiteReleases.push(async () => {
      if (previous === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
      else process.env.LLXPRT_PROMPTS_DIR = previous;
    });
    process.env.LLXPRT_PROMPTS_DIR = prompts;
    await initializePromptSystem();
  });
  let agent: Agent;
  let sequenceForNextClient: string | null;
  const clients: SequenceModelClient[] = [];
  afterEach(async () => runCleanupSteps(releases.splice(0).reverse()));
  beforeEach(async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'sequence-model-'));
    releases.push(() => rm(temporary, { recursive: true, force: true }));
    const directory = await realpath(temporary);
    const oldReplay = process.env.LLXPRT_FAKE_RESPONSES;
    releases.push(async () => {
      if (oldReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldReplay;
    });
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    sequenceForNextClient = null;
    clients.length = 0;
    agent = await createAgent({
      provider: 'fake',
      model: 'fallback-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
      runtimeFactoryBindings: {
        ...createAgentRuntimeFactoryBindings(),
        agentClientFactory: (
          config,
          state,
          instructions,
          store,
          paths,
          reads,
        ) => {
          if (
            instructions === undefined ||
            store === undefined ||
            paths === undefined
          )
            throw new Error('Missing real sequence client construction inputs');
          const client = new SequenceModelClient(
            config,
            state,
            instructions,
            store,
            paths,
            undefined,
            undefined,
            reads,
          );
          client.sequenceModel = sequenceForNextClient;
          clients.push(client);
          return client;
        },
      },
    });
    releases.push(() => agent.dispose());
  });
  it('T9a client reports gpt-4o and the public Agent delegates to that real client', () => {
    for (const client of clients) client.sequenceModel = 'gpt-4o';
    expect(agent.getCurrentSequenceModel()).toBe('gpt-4o');
  });
  it('T9b null remains a genuine public contract value across repeated calls', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 25 }), async (count) => {
        for (let index = 0; index < count; index++)
          expect(agent.getCurrentSequenceModel()).toBeNull();
      }),
    );
  });
  it('T9c the actual projection used by Agent guards an absent pre-initialization client', () => {
    expect(projectCurrentSequenceModel(undefined)).toBeNull();
  });
  it('T9d resolves a genuinely replaced session client fresh on the same public Agent', async () => {
    for (const client of clients) client.sequenceModel = 'gpt-4o';
    expect(agent.getCurrentSequenceModel()).toBe('gpt-4o');
    const previous = clients.slice(-1).pop();
    if (previous === undefined)
      throw new Error('Missing originally acquired client');
    sequenceForNextClient = 'claude-x';
    await agent.session.startNewSession();
    expect(fixtureAgentResources(agent).publishedClient(agent)).not.toBe(
      previous,
    );
    previous.sequenceModel = 'retired-client-model';
    expect(agent.getCurrentSequenceModel()).toBe('claude-x');
  });
  it('PROP every nonempty scalar model reported by the real selected client reaches the public Agent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (model) => {
        for (const client of clients) client.sequenceModel = model;
        expect(agent.getCurrentSequenceModel()).toBe(model);
      }),
    );
  });
});
