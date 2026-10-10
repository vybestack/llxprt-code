/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

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
});
