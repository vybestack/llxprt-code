/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectedWithin } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { NativeResponsesEstimateProjection } from './native-responses-estimate.js';
import {
  projectSourcePrompt,
  sourcePromptText,
} from './__tests__/support/source-prompt-text.js';
import { nativeDiskRows } from './__tests__/support/native-disk-text-rows.js';
import {
  projectionEndpoint,
  projectionRuntime,
} from './__tests__/support/projection-ownership-fixture.js';
import {
  diskTextFixture as projectionDiskRows,
  diskTextWireOracle as projectionWireOracle,
} from './__tests__/support/disk-text-fixture.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

async function gcRows(
  references: ReadonlyArray<WeakRef<object>>,
): Promise<void> {
  await Promise.all(references.map((row) => collectedWithin(row)));
}

describe('explicit actual provider disk text route', () => {
  it('seals the actual finalized projection without retaining rows or strings and releases an unsent token', async () => {
    const disk = projectionDiskRows(false, false);
    const native = await nativeDiskRows(disk);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const before = new Set(readdirSync(getScratchRoot()));
    try {
      const rows = native.selection;
      const projection = await setup.provider.projectPromptEnvelope({
        ...setup.options(rows),
        requestRows: rows,
      });
      const finalized = projection.finalizedProjection;
      expect(finalized).toBeInstanceOf(NativeResponsesEstimateProjection);
      await gcRows(disk.references);
      expect(disk.state.pulled).toBe(64);
      expect(disk.state.active).toBe(0);
      expect(
        disk.references.filter((row) => row.deref() !== undefined),
      ).toHaveLength(0);
      await projection.releaseIfUnsent?.();
      expect(
        readdirSync(getScratchRoot()).filter(
          (name) =>
            name.startsWith('responses-prompt-keys-') && !before.has(name),
        ),
      ).toHaveLength(0);
    } finally {
      await native.close();
      disk.close();
      await setup.config.dispose();
    }
  }, 120000);
});

describe('actual source HTTP replay', () => {
  it('preserves independent actual HTTP bytes through 503 replay using fresh segment readers', async () => {
    const disk = projectionDiskRows(false, false);
    const native = await nativeDiskRows(disk);
    const http = projectionEndpoint(true);
    const setup = await projectionRuntime(
      `http://127.0.0.1:${http.server.port}/v1`,
      disk.root,
    );
    const rows = native.selection;
    const options = setup.options(rows);
    const projection = await projectSourcePrompt(setup.provider, options);
    const iterator = setup.provider.generateChatCompletion({
      ...options,
      promptEnvelopeTransportToken: projection.transportToken,
    });
    try {
      const first = iterator.next();
      await Promise.race([
        http.arrived.wait,
        first.then(() => {
          throw new Error('Response escaped before HTTP arrival');
        }),
      ]);
      await gcRows(disk.references);
      const scanAtHttpArrival = disk.state.pulled;
      expect(
        disk.references.filter((row) => row.deref() !== undefined),
      ).toHaveLength(0);
      http.readBody.release();
      await http.uploaded.wait;
      http.respond.release();
      expect((await first).done).toBe(false);
      for await (const row of iterator) expect(row.speaker).toBe('ai');
      expect(http.bodies).toStrictEqual([
        projectionWireOracle(false),
        projectionWireOracle(false),
      ]);
      expect([scanAtHttpArrival, disk.state.pulled]).toStrictEqual([64, 64]);
      await expect(sourcePromptText(projection)).rejects.toThrow(
        'Native Responses prompt is closed',
      );
    } finally {
      http.readBody.release();
      http.respond.release();
      await iterator.return?.();
      await projection.releaseIfUnsent?.();
      await native.close();
      disk.close();
      await http.server.stop(true);
      await setup.config.dispose();
    }
  }, 120000);
});

describe('actual source pinned estimate', () => {
  it('uses complete prompt-key pinned accounting rather than row sums through the provider estimate seam', async () => {
    const disk = projectionDiskRows(false, false);
    const native = await nativeDiskRows(disk);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    let release: (() => Promise<void>) | undefined;
    try {
      const eager = await setup.provider.projectPromptEnvelope({
        ...setup.options(requestSelection(disk.rows)),
        requestRows: undefined,
      });
      const oracle = await estimatePromptEnvelope(
        setup.provider.name,
        eager,
        setup.factory,
      );
      await eager.releaseIfUnsent?.();
      const rows = native.selection;
      const projection = await setup.provider.projectPromptEnvelope(
        setup.options(rows),
      );
      release = projection.releaseIfUnsent;
      const estimate = await estimatePromptEnvelope(
        setup.provider.name,
        projection,
        withGpt56DiskSources(setup.factory, getScratchRoot()),
      );
      expect(estimate).toStrictEqual(oracle);
    } finally {
      await release?.();
      await native.close();
      disk.close();
      await setup.config.dispose();
    }
  }, 120000);
});
