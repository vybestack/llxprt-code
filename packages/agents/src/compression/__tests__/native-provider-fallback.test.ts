/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { FakeProvider } from '@vybestack/llxprt-code-providers/fake/FakeProvider.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `fallback row ${index}` }],
  };
}

describe('native provider fallback producer', () => {
  it('uses committed indexed history through the real handler after FakeProvider failure without creating files', async () => {
    await withNativeValueFixture(async ({ history, durable }) => {
      await history.detachedValues.replace(
        Array.from({ length: 8 }, (_, i) => row(i)),
      );
      await history.waitForCommit();
      const runtime = buildRuntimeContext(history, {
        contextLimit: 200_000,
        compressionStrategy: 'one-shot',
      });
      const provider = new FakeProvider('/dev/null');
      await buildCompressionSystemInstruction(runtime.state.model, {
        provider: provider.name,
        interactionMode: 'non-interactive',
      });
      const handler = new CompressionHandler(
        runtime,
        undefined,
        history,
        undefined,
        undefined,
        undefined,
        undefined,
        {},
        () => ({
          provider,
          runtime: runtime.providerRuntime,
          invocation: runtime.prepareProviderInvocation(provider.name),
        }),
        async () => {},
      );
      history.setCacheAnchorSeq(1);
      handler.setLastPromptTokenCount(150_000);
      const creates = operationFileCreates(async () => {
        await handler.enforceContextWindow(
          0,
          'native-provider-fallback',
          provider,
        );
      }, true);
      await expect(creates).resolves.toStrictEqual({
        directories: [],
        files: [],
      });
      const actual = await Array.fromAsync(history.streamRawHistory());
      expect(actual.map(({ blocks }) => blocks)).toStrictEqual([
        row(6).blocks,
        row(7).blocks,
      ]);
      expect(history.getTotalTokens()).toBe(2);
      expect(history.getCacheAnchorSeq()).toBe(0);
      expect(handler.getLastPromptTokenCount()).toBe(0);
      expect(handler.wasRecentlyCompressed()).toBe(true);
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(actual),
      );
    });
  }, 180_000);
});
