/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { Gpt56SourceProjection } from '../tokenizers/gpt56-source-projection.js';
import {
  projectionEndpoint,
  projectionRuntime,
} from './__tests__/support/projection-ownership-fixture.js';
import {
  diskTextFixture as projectionDiskRows,
  diskTextWireOracle as projectionWireOracle,
} from './__tests__/support/disk-text-fixture.js';

async function gcRows(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Bun.sleep(0);
    Bun.gc(true);
  }
}

describe('explicit actual provider disk text route', () => {
  it('seals the actual finalized projection without retaining rows or strings and releases an unsent token', async () => {
    const disk = projectionDiskRows(false, false);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const before = new Set(readdirSync(tmpdir()));
    try {
      const rows = requestSelection(disk.rows);
      const projection = await setup.provider.projectPromptEnvelope({
        ...setup.options(rows),
        requestRows: rows,
        readRequestRowsAtTransport: true as const,
      });
      const finalized = projection.finalizedProjection;
      expect(finalized).toBeInstanceOf(Gpt56SourceProjection);
      await gcRows();
      expect(disk.state.pulled).toBe(64);
      expect(disk.state.active).toBe(0);
      expect(
        disk.references.filter((row) => row.deref() !== undefined),
      ).toHaveLength(0);
      await projection.releaseIfUnsent?.();
      expect(
        readdirSync(tmpdir()).filter(
          (name) =>
            name.startsWith('responses-prompt-keys-') && !before.has(name),
        ),
      ).toHaveLength(0);
    } finally {
      disk.close();
      await setup.config.dispose();
    }
  }, 120000);
});

describe('actual source HTTP replay', () => {
  it('preserves independent actual HTTP bytes through 503 replay using fresh segment readers', async () => {
    const disk = projectionDiskRows(false, false);
    const http = projectionEndpoint(true);
    const setup = await projectionRuntime(
      `http://127.0.0.1:${http.server.port}/v1`,
      disk.root,
    );
    const rows = requestSelection(disk.rows);
    const options = setup.options(rows);
    const projection = await setup.provider.projectPromptEnvelope(options);
    const source = projection.finalizedProjection;
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
      await gcRows();
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
      if (!(source instanceof Gpt56SourceProjection))
        throw new Error('Missing sealed source');
      expect(
        source.promptSegments.every(
          (segment) => !existsSync(segment.source.path),
        ),
      ).toBe(true);
    } finally {
      http.readBody.release();
      http.respond.release();
      await iterator.return?.();
      await projection.releaseIfUnsent?.();
      disk.close();
      await http.server.stop(true);
      await setup.config.dispose();
    }
  }, 120000);
});

describe('actual source pinned estimate', () => {
  it('uses complete prompt-key pinned accounting rather than row sums through the provider estimate seam', async () => {
    const disk = projectionDiskRows(false, false);
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
      const rows = requestSelection(disk.rows);
      const projection = await setup.provider.projectPromptEnvelope(
        setup.options(rows),
      );
      release = projection.releaseIfUnsent;
      const estimate = await estimatePromptEnvelope(
        setup.provider.name,
        projection,
        withGpt56DiskSources(setup.factory, tmpdir()),
      );
      expect(estimate).toStrictEqual(oracle);
    } finally {
      await release?.();
      disk.close();
      await setup.config.dispose();
    }
  }, 120000);
});
