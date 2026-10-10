/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

function rows(row: IContent): ProviderRequestSelection {
  return requestSelection({
    count: 1,
    async *openReader() {
      yield row;
    },
  });
}

describe('disk text request option exclusion', () => {
  it('rejects Codex WebSocket-capable transport without scanning disk rows', async () => {
    const setup = await projectionRuntime(
      'http://127.0.0.1:1/v1',
      process.cwd(),
    );
    let reads = 0;
    const source = requestSelection({
      count: 1,
      async *openReader(): AsyncGenerator<IContent, void> {
        reads++;
        yield { speaker: 'human', blocks: [{ type: 'text', text: 'payload' }] };
      },
    });
    const provider = new OpenAIResponsesProvider(
      'test-key',
      'http://127.0.0.1:1/v1',
      undefined,
      undefined,
      [],
      'codex',
    );
    try {
      await expect(
        provider.projectPromptEnvelope(setup.options(source)),
      ).rejects.toThrow('does not support Codex or WebSocket');
      expect(reads).toBe(0);
    } finally {
      provider.clearState();
      await setup.config.dispose();
    }
  });

  it.each([
    { 'responses-stateful': true },
    { store: true },
    { previous_response_id: 'resp_parent' },
  ])('rejects incompatible explicit options %j', async (ephemerals) => {
    const setup = await projectionRuntime(
      'http://127.0.0.1:1/v1',
      process.cwd(),
    );
    const options = setup.options(
      rows({ speaker: 'human', blocks: [{ type: 'text', text: 'payload' }] }),
    );
    if (options.runtime === undefined || options.settings === undefined)
      throw new Error('Missing fixture runtime');
    const invocation = createRuntimeInvocationContext({
      runtime: options.runtime,
      settings: options.settings,
      providerName: setup.provider.name,
      ephemeralsSnapshot: ephemerals,
    });
    try {
      await expect(
        setup.provider.projectPromptEnvelope({ ...options, invocation }),
      ).rejects.toThrow('Explicit Responses disk text route does not support');
    } finally {
      await setup.config.dispose();
    }
  });
});
