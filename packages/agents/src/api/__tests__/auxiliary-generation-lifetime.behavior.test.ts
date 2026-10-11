/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { AggregateDisposeError } from '../disposeErrors.js';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';

function contents(): IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Generate a value' }] },
  ];
}

describe('auxiliary generation lifetime', () => {
  for (const kind of ['json', 'embedding'] as const) {
    it(`joins accepted ${kind} work and retains a borrowed client after facade closure`, async () => {
      const built = await buildCliStyleConfig('plain-text.jsonl');
      await built.agentClient.startChat();
      const peer = await buildCliStyleConfig('plain-text.jsonl');
      await peer.agentClient.startChat();
      const entered = gate();
      const release = gate();
      const generator = built.agentClient.getContentGenerator();
      let cancellation: AbortSignal | undefined;
      const failure = new Error('Held transport failed');
      generator.generateContent = async (request) => {
        cancellation = request.abortSignal;
        entered.release();
        await release.promise;
        throw failure;
      };
      generator.embedContent = async () => {
        entered.release();
        await release.promise;
        throw failure;
      };
      const agent = await fromConfig({
        settingsService: built.settingsService,
        settingsOwner: built.settingsOwner,
        config: built.config,
        providerManager: built.providerManager,
        mcpRuntime: built.mcpRuntime,
        agentClient: built.agentClient,
      });
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
        await Promise.resolve();
        await Promise.resolve();
        expect(finished).toBe(false);
        peer.agentClient.getContentGenerator().embedContent = async ({
          texts,
        }) => ({
          embeddings: texts.map((text) => [text.length]),
        });
        expect(
          (await peer.agentClient.generateEmbedding(['sibling'])).length,
        ).toBe(1);
        release.release();
        expect(await result).toBeInstanceOf(Error);
        expect(await outcome).toBeInstanceOf(AggregateDisposeError);
        expect(kind === 'embedding' || cancellation?.aborted).toBe(true);
        generator.embedContent = async ({ texts }) => ({
          embeddings: texts.map((text) => [text.length]),
        });
        expect(
          (
            await built.agentClient.generateEmbedding([
              'borrowed',
              'still usable',
            ])
          ).map((row) => row.length),
        ).toStrictEqual([1, 1]);
      } finally {
        release.release();
        await result;
        await outcome;
        await peer.cleanup();
        await built.cleanup();
      }
    });
  }

  it('joins raw client embedding work before removing owned listeners', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    await built.agentClient.startChat();
    const client = built.agentClient;
    const entered = gate();
    const release = gate();
    client.getContentGenerator().embedContent = async ({ texts }) => {
      entered.release();
      await release.promise;
      return { embeddings: texts.map((text) => [text.length]) };
    };
    const pending = client.generateEmbedding(['one', 'two']);
    await entered.promise;
    const closing = client.dispose();
    let finished = false;
    void closing.then(() => {
      finished = true;
    });
    try {
      await expect(client.generateEmbedding(['late'])).rejects.toThrow(
        /closed/,
      );
      await Promise.resolve();
      expect(finished).toBe(false);
      release.release();
      expect((await pending).length).toBe(2);
      await closing;
    } finally {
      release.release();
      await pending;
      await closing;
      await built.cleanup();
    }
  });

  it('carries caller cancellation into the JSON transport', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    await built.agentClient.startChat();
    const controller = new AbortController();
    const entered = gate();
    const release = gate();
    let cancellation: AbortSignal | undefined;
    built.agentClient.getContentGenerator().generateContent = async (
      request,
    ) => {
      cancellation = request.abortSignal;
      entered.release();
      await release.promise;
      const output = emptyModelOutput();
      return {
        ...output,
        content: { ...output.content, blocks: [{ type: 'text', text: '{}' }] },
      };
    };
    const pending = built.agentClient.generateJson(
      contents(),
      {},
      controller.signal,
      'fake-model',
    );
    await entered.promise;
    try {
      controller.abort();
      expect(cancellation?.aborted).toBe(true);
    } finally {
      release.release();
      await pending;
      await built.cleanup();
    }
  });
});
