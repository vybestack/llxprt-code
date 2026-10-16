/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { diskTextFixture } from './__tests__/support/disk-text-fixture.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

describe('actual request source estimation cancellation', () => {
  it('cancels source estimation through the actual request signal without a separately configured global factory signal', async () => {
    const disk = diskTextFixture(false, false);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const controller = new AbortController();
    const projection = await setup.provider.projectPromptEnvelope(
      setup.options(requestSelection(disk.rows), controller.signal),
    );
    const before = new Set(readdirSync(getScratchRoot()));
    try {
      controller.abort(new Error('cancel finalized source count'));
      await expect(
        estimatePromptEnvelope(
          setup.provider.name,
          projection,
          withGpt56DiskSources(setup.factory, getScratchRoot()),
        ),
      ).rejects.toThrow('tokenization-failed');
      expect(
        readdirSync(getScratchRoot()).filter(
          (name) => name.startsWith('o200k-count-') && !before.has(name),
        ),
      ).toHaveLength(0);
    } finally {
      await projection.releaseIfUnsent?.();
      disk.close();
      await setup.config.dispose();
    }
  });
});
