/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { FakeProvider } from '@vybestack/llxprt-code-providers/fake/FakeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { fallbackRow } from './native-provider-fallback-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

class RejectingTransport extends FakeProvider {
  readonly failures: Error[] = [];
  constructor(private readonly failure: Error | undefined) {
    super('/dev/null');
  }
  override async *generateChatCompletion(
    options: Parameters<FakeProvider['generateChatCompletion']>[0],
  ): AsyncIterableIterator<IContent> {
    if (this.failure !== undefined) {
      this.failures.push(this.failure);
      throw this.failure;
    }
    yield* super.generateChatCompletion(options);
  }
}

describe('native fallback after external compression transport rejection', () => {
  it.each([400, 429])(
    'runs the actual provider fallback after status %i with committed-only rows',
    async (status) => {
      await withNativeValueFixture(async ({ history, durable }) => {
        await history.detachedValues.replace(
          Array.from({ length: 8 }, (_, index) => fallbackRow(index)),
        );
        await history.waitForCommit();
        const failure = Object.assign(
          new Error(
            status === 400 ? 'maximum context length exceeded' : 'rate limited',
          ),
          { status },
        );
        const provider = new RejectingTransport(failure);
        const runtime = buildRuntimeContext(history, {
          contextLimit: 200_000,
          compressionStrategy: 'one-shot',
        });
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
        handler.setLastPromptTokenCount(150_000);
        const creates = await operationFileCreates(async () => {
          await handler.enforceContextWindow(
            0,
            'external-provider-error',
            provider,
          );
        }, true);
        const actual = await Array.fromAsync(history.streamRawHistory());
        expect(actual.map((row) => row.blocks)).toStrictEqual([
          fallbackRow(6).blocks,
          fallbackRow(7).blocks,
        ]);
        expect(actual[1].metadata?.responsesStored).toBeUndefined();
        expect(history.getTotalTokens()).toBe(2);
        expect(handler.getLastPromptTokenCount()).toBe(0);
        expect(creates).toStrictEqual({ directories: [], files: [] });
        expect(provider.failures).toHaveLength(status === 429 ? 6 : 1);
        expect(await durable()).toStrictEqual(
          await compressionValueDigest(actual),
        );
      });
    },
    180_000,
  );
});
