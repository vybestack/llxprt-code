/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { requestSelection } from './__tests__/support/request-selection.js';
import { Gpt56SourceProjection } from '../tokenizers/gpt56-source-projection.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import {
  projectionEndpoint,
  projectionRuntime,
} from './__tests__/support/projection-ownership-fixture.js';
import { diskTextFixture as projectionDiskRows } from './__tests__/support/disk-text-fixture.js';

async function lifecycle(
  returnBeforeNext: boolean | 'throw',
): Promise<boolean> {
  const disk = projectionDiskRows(false, false);
  const http = projectionEndpoint(false);
  const setup = await projectionRuntime(
    `http://127.0.0.1:${http.server.port}/v1`,
    disk.root,
  );
  const controller = new AbortController();
  const options = setup.options(requestSelection(disk.rows), controller.signal);
  const projection = await setup.provider.projectPromptEnvelope(options);
  const source = projection.finalizedProjection;
  const stream = setup.provider.generateChatCompletion({
    ...options,
    promptEnvelopeTransportToken: projection.transportToken,
  });
  try {
    if (returnBeforeNext === 'throw')
      await expect(
        stream.throw?.(new Error('unstarted disk consumer')),
      ).rejects.toThrow('unstarted disk consumer');
    else if (returnBeforeNext) await stream.return?.();
    else {
      const pending = stream.next();
      await Promise.race([
        http.arrived.wait,
        pending.then(() => {
          throw new Error('Response escaped the paused receiver');
        }),
      ]);
      const settled = pending.then(
        () => 'unexpected response',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
      controller.abort(new Error('stop disk HTTP upload'));
      expect(await settled).toBe('stop disk HTTP upload');
      await stream.return?.();
    }
    if (!(source instanceof Gpt56SourceProjection))
      throw new Error('Missing sealed source');
    expect(
      source.promptSegments.every(
        (segment) => !existsSync(segment.source.path),
      ),
    ).toBe(true);
    expect(disk.state.active).toBe(0);
    expect(activeRequestBodyCount()).toBe(0);
    return source.promptSegments.every(
      (segment) => !existsSync(segment.source.path),
    );
  } finally {
    http.readBody.release();
    http.respond.release();
    await stream.return?.();
    await projection.releaseIfUnsent?.();
    disk.close();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

describe('actual disk source send lifetime', () => {
  it('releases sent ownership when the consumer returns after the first actual response chunk', async () => {
    const disk = projectionDiskRows(false, false);
    const http = projectionEndpoint(false);
    const setup = await projectionRuntime(
      `http://127.0.0.1:${http.server.port}/v1`,
      disk.root,
    );
    const options = setup.options(requestSelection(disk.rows));
    const projection = await setup.provider.projectPromptEnvelope(options);
    const source = projection.finalizedProjection;
    const stream = setup.provider.generateChatCompletion({
      ...options,
      promptEnvelopeTransportToken: projection.transportToken,
    });
    http.readBody.release();
    http.respond.release();
    try {
      expect((await stream.next()).done).toBe(false);
      await stream.return?.();
      if (!(source instanceof Gpt56SourceProjection))
        throw new Error('Missing sealed source');
      expect(
        source.promptSegments.every(
          (segment) => !existsSync(segment.source.path),
        ),
      ).toBe(true);
      expect(activeRequestBodyCount()).toBe(0);
    } finally {
      await stream.return?.();
      await projection.releaseIfUnsent?.();
      disk.close();
      await http.server.stop(true);
      await setup.config.dispose();
    }
  });
});

describe('unstarted and aborted disk source send lifetime', () => {
  it('releases a prepared token when the consumer throws before first next', async () => {
    expect(await lifecycle('throw')).toBe(true);
  }, 120000);
  it('releases a prepared token when returned before the first provider next', async () => {
    expect(await lifecycle(true)).toBe(true);
  }, 120000);
  it('aborts a paused actual HTTP send and closes owned segments and body leases', async () => {
    expect(await lifecycle(false)).toBe(true);
  }, 120000);
});
