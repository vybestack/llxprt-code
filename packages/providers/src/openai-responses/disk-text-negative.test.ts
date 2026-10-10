/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

describe('disk text request option exclusion', () => {
  it('projects Codex WebSocket-capable transport by scanning the disk rows once', async () => {
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
      const projection = await provider.projectPromptEnvelope(
        setup.options(source),
      );
      expect(projection.transportToken).toBeDefined();
      expect(reads).toBeGreaterThan(0);
      await projection.releaseIfUnsent?.();
    } finally {
      provider.clearState();
      await setup.config.dispose();
    }
  });
});
