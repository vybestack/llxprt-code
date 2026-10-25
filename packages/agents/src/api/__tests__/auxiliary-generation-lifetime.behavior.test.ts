import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { RuntimeContentGeneratorFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeContentGeneratorFactory.js';
import { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  emptyModelOutput,
  type EmbedContentRequest,
  type EmbedContentResult,
  type ModelGenerationRequest,
  type ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

import { gate } from './helpers/recording-finalizer-join-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// What a held transport throws once it observes the session's cancellation.
const OBSERVED_ABORT = 'Held transport observed session cancellation';

function contents(): IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Generate a value' }] },
  ];
}

interface ModelTransport {
  readonly generate?: (request: ModelGenerationRequest) => Promise<ModelOutput>;
  readonly embed: (request: EmbedContentRequest) => Promise<EmbedContentResult>;
}

interface OpenedAgent {
  readonly agent: Agent;
  readonly close: () => Promise<void>;
}

async function openAgent(
  authority: CredentialAuthority,
  transport: ModelTransport,
): Promise<OpenedAgent> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'auxiliary-generation-')),
  );
  const contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator> =
    {
      createContentGenerator: () => ({
        generateContent: (request) => {
          if (transport.generate === undefined)
            throw new Error('Transport does not generate');
          return transport.generate(request);
        },
        generateContentStream: async () => {
          throw new Error('Transport does not stream');
        },
        countTokens: async () => ({ totalTokens: 1 }),
        embedContent: transport.embed,
      }),
    };
  let agent: Agent | undefined;
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => agent?.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  try {
    agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      credentialAuthority: authority,
      contentGeneratorFactory,
    });
  } catch (primary) {
    await close();
    throw primary;
  }
  return { agent, close };
}

describe('auxiliary generation lifetime', () => {
  useFakeResponsesReplay('plain-text.jsonl');
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
  const peerCredentials = useOwnedCredentials();

  for (const kind of ['json', 'embedding'] as const) {
    it(`joins accepted ${kind} work after facade closure`, async () => {
      const entered = gate();
      const release = gate();
      const failure = new Error('Held transport failed');
      let cancellation: AbortSignal | undefined;
      const heldTransport = async (signal: AbortSignal | undefined) => {
        cancellation = signal;
        entered.release();
        await release.promise;
        throw signal?.aborted === true ? new Error(OBSERVED_ABORT) : failure;
      };
      const built = await openAgent(builtCredentials().authority, {
        generate: (request) => heldTransport(request.abortSignal),
        embed: (request) => heldTransport(request.abortSignal),
      });
      const peer = await openAgent(peerCredentials().authority, {
        embed: async ({ texts }) => ({
          embeddings: texts.map((text) => [text.length]),
        }),
      });
      const agent = built.agent;
      const pending =
        kind === 'json'
          ? agent.generateJson(contents(), { type: 'object' })
          : agent.generateEmbedding(['held']);
      const result = pending.then(
        () => undefined,
        (error: unknown) => error,
      );
      await entered.promise;
      const closing = agent.dispose();
      const outcome = closing.then(
        () => undefined,
        (error: unknown) => error,
      );
      let finished = false;
      void outcome.then(() => {
        finished = true;
      });
      try {
        await expect(agent.generateJson(contents(), {})).rejects.toThrow(
          /closed|disposed/,
        );
        await expect(agent.generateEmbedding(['late'])).rejects.toThrow(
          /closed|disposed/,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(finished).toBe(false);
        expect(cancellation?.aborted).toBe(true);
        expect((await peer.agent.generateEmbedding(['sibling'])).length).toBe(
          1,
        );
        release.release();
        expect(await result).toMatchObject({
          message: expect.stringContaining(OBSERVED_ABORT),
        });
        expect(await outcome).toBeUndefined();
      } finally {
        release.release();
        await result;
        await outcome;
        await peer.close();
        await built.close();
      }
    });
  }

  it('leaves unrelated work on another agent running when the facade closes', async () => {
    const admitted = gate();
    const unrelated = gate();
    const release = gate();
    const signals: Record<'admitted' | 'unrelated', AbortSignal | undefined> = {
      admitted: undefined,
      unrelated: undefined,
    };
    const embed = async ({
      texts,
      abortSignal,
    }: EmbedContentRequest): Promise<EmbedContentResult> => {
      const owner = texts[0] === 'unrelated' ? 'unrelated' : 'admitted';
      signals[owner] = abortSignal;
      (owner === 'unrelated' ? unrelated : admitted).release();
      await release.promise;
      if (abortSignal?.aborted === true) throw new Error(OBSERVED_ABORT);
      return { embeddings: texts.map((text) => [text.length]) };
    };
    const built = await openAgent(builtCredentials().authority, { embed });
    const other = await openAgent(peerCredentials().authority, { embed });
    const facadeCall = built.agent.generateEmbedding(['admitted']).then(
      () => undefined,
      (error: unknown) => error,
    );
    const directCall = other.agent.generateEmbedding(['unrelated']);
    try {
      await admitted.promise;
      await unrelated.promise;
      const closing = built.agent.dispose();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(signals.admitted?.aborted).toBe(true);
      expect(signals.unrelated?.aborted).toBe(false);
      release.release();
      await closing;
      expect(await facadeCall).toMatchObject({
        message: expect.stringContaining(OBSERVED_ABORT),
      });
      expect(await directCall).toStrictEqual([[9]]);
    } finally {
      release.release();
      await facadeCall;
      await directCall.catch(() => undefined);
      await other.close();
      await built.close();
    }
  });

  it('carries caller cancellation into the JSON transport', async () => {
    const controller = new AbortController();
    const entered = gate();
    const release = gate();
    let cancellation: AbortSignal | undefined;
    const built = await openAgent(builtCredentials().authority, {
      generate: async (request) => {
        cancellation = request.abortSignal;
        entered.release();
        await release.promise;
        const output = emptyModelOutput();
        return {
          ...output,
          content: {
            ...output.content,
            blocks: [{ type: 'text', text: '{}' }],
          },
        };
      },
      embed: async () => ({ embeddings: [] }),
    });
    const pending = built.agent.generateJson(
      contents(),
      {},
      { signal: controller.signal, model: 'fake-model' },
    );
    await entered.promise;
    try {
      controller.abort();
      expect(cancellation?.aborted).toBe(true);
    } finally {
      release.release();
      await pending;
      await built.close();
    }
  });
});
