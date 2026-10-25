/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import {
  createAgent,
  type Agent,
  type AgentConfig,
} from '@vybestack/llxprt-code-agents';
import { ProviderReadFixture } from './helpers/provider-read-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { drain, countType } from './helpers/agentHarness.js';

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3217-001
 * @requirement:REQ-3217-003
 *
 * Tokenizer readiness during agent construction: the agent waits for the
 * supplied tokenizer factory to prepare the activated provider and model
 * before it is returned, and a preparation failure rejects construction with
 * its cause. The factory arrives through the public `tokenizerFactory` input.
 */

function createReadinessFactory(
  prepareTokenizer: (providerName: string, model?: string) => Promise<void>,
  countTokens: (providerName: string, model?: string) => number,
): RuntimeTokenizerFactory {
  return {
    prepareTokenizer,
    getTokenizer: (providerName, model) => ({
      fallbackPolicy: 'deny',
      countTokens: () => countTokens(providerName, model),
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'test-readiness',
      estimatorVersion: 'test-readiness-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  };
}

function readinessSignal() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

describe('fromConfig tokenizer readiness @requirement:REQ-3217-001 @requirement:REQ-3217-003', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const builtCredentials = useOwnedCredentials();
  useFakeResponsesReplay('plain-text.jsonl');

  async function constructAgent(
    directory: string,
    overrides: Readonly<Partial<AgentConfig>>,
  ): Promise<Agent> {
    return createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      credentialAuthority: builtCredentials().authority,
      ...overrides,
    });
  }

  async function withDirectory(
    run: (directory: string) => Promise<void>,
  ): Promise<void> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'tokenizer-readiness-')),
    );
    try {
      await run(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('awaits post-activation provider/model preparation before returning a usable Agent', async () => {
    const preparationStarted = readinessSignal();
    const releasePreparation = readinessSignal();
    const events: string[] = [];
    let prepared = false;
    const factory = createReadinessFactory(
      async (providerName, model) => {
        events.push(`prepare:${providerName}:${model ?? ''}`);
        preparationStarted.resolve();
        await releasePreparation.promise;
        prepared = true;
        events.push('prepared');
      },
      (providerName, model) => {
        if (!prepared) {
          throw new Error('tokenizer used before preparation completed');
        }
        events.push(`tokenize:${providerName}:${model ?? ''}`);
        return 7;
      },
    );

    await withDirectory(async (directory) => {
      try {
        const pendingAgent = constructAgent(directory, {
          model: 'ready-model',
          activation: {
            provider: 'fake',
            model: 'ready-model',
            authMode: 'auto',
          },
          tokenizerFactory: factory,
        });
        await preparationStarted.promise;
        let completed = false;
        const observedAgent = pendingAgent.then((agent) => {
          completed = true;
          return agent;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(completed).toBe(false);

        releasePreparation.resolve();
        const agent = await observedAgent;
        try {
          const turnEvents = await drain(agent.stream('hello'));
          expect(countType(turnEvents, 'done')).toBe(1);
          expect(events[0]).toBe('prepare:fake:ready-model');
          expect(events[1]).toBe('prepared');
          expect(
            events.some((event) => event === 'tokenize:fake:ready-model'),
          ).toBe(true);
        } finally {
          await agent.dispose();
        }
      } finally {
        releasePreparation.resolve();
      }
    });
  });

  it('rejects with the causal preparation failure reached through authoritative post-activation state without allowing an ownerless accessor', async () => {
    const failure = new Error('mandatory tokenizer readiness failed causally');
    const runtimeId = 'from-config-rejected-tokenizer-readiness';
    let readinessTarget:
      | { readonly provider: string; readonly model: string }
      | undefined;
    const tokenizerFactory = createReadinessFactory(
      async (providerName, model) => {
        readinessTarget = { provider: providerName, model: model ?? '' };
        throw failure;
      },
      () => {
        throw new Error('unreachable tokenizer use');
      },
    );

    await withDirectory(async (directory) => {
      const rejection = await constructAgent(directory, {
        sessionId: runtimeId,
        activation: { provider: 'fake', model: 'fake-model' },
        tokenizerFactory,
      }).then(
        () => {
          throw new Error('Expected construction to reject');
        },
        (error: unknown) => error,
      );
      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toContain(failure.message);
      expect((rejection as Error).message).not.toMatch(/dispos/i);
      expect((rejection as Error).cause).toBe(failure);
      // Authoritative post-activation manager state ('fake'/'fake-model')
      // reached readiness.
      expect(readinessTarget).toStrictEqual({
        provider: 'fake',
        model: 'fake-model',
      });
      expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
        'Provider reads require an explicit session owner',
      );
    });
  });
});
