/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { FakeProvider } from '@vybestack/llxprt-code-providers/fake/FakeProvider.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';

describe('native pending-token last-resort ranking', () => {
  it('stubs the retained current-turn response through the real handler without creating operation files', async () => {
    await withNativeValueFixture(async ({ history, durable }) => {
      history.setTokenizerFactory({
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: (text: string) => text.length,
        }),
      });
      await history.detachedValues.replace([
        { speaker: 'human', blocks: [{ type: 'text', text: 'inspect' }] },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'current',
              name: 'read_file',
              parameters: { path: 'a' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'current',
              toolName: 'read_file',
              result: 'x'.repeat(200_000),
            },
          ],
        },
      ]);
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
      const files = operationFileCreates(async () => {
        await handler.enforceContextWindow(
          17,
          'native-pending-token-ranking',
          provider,
        );
      }, true);
      await expect(files).resolves.toStrictEqual({
        directories: [],
        files: [],
      });
      const actual = await Array.fromAsync(history.streamRawHistory());
      const responses = actual.flatMap((row) =>
        row.blocks.filter((block) => block.type === 'tool_response'),
      );
      expect(responses).toHaveLength(1);
      expect(responses[0].providerMetadata?.contextTruncated).toBe(true);
      expect(history.getTotalTokens()).toBeLessThan(1000);
      expect(handler.getLastPromptTokenCount()).toBe(0);
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(actual),
      );
    });
  }, 180_000);
});
