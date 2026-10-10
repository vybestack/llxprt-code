/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { heapSize } from 'bun:jsc';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeEstimate,
  type PromptEnvelopeProjection,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import {
  getO200kBaseEncoder,
  countO200kBaseTokens,
} from '../tokenizers/o200kBaseCounter.js';
import {
  projectionDiskRows,
  projectionEndpoint,
  projectionInstructions,
  projectionModel,
  projectionRowText,
  projectionRuntime,
  projectionWireOracle,
  rowCount,
} from './__tests__/support/projection-ownership-fixture.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

type Setup = Awaited<ReturnType<typeof projectionRuntime>>;
type Disk = ReturnType<typeof projectionDiskRows>;
type Prepared = {
  readonly projection: PromptEnvelopeProjection;
  readonly estimate: PromptEnvelopeEstimate;
  readonly options: ReturnType<Setup['options']>;
};
type PreparedLease = Omit<Prepared, 'projection'> & {
  readonly retainedCodeUnits: number;
  readonly releaseIfUnsent?: () => Promise<void>;
};
interface ProjectionFacts {
  readonly large: boolean;
  readonly retain: boolean;
  readonly expected: { bytes: number; sha256: string };
  readonly estimate: PromptEnvelopeEstimate;
  readonly preparedBytes: number;
  readonly pausedUploadBytes: number;
  readonly uploadedBytes: number;
  readonly responseBytes: number;
  readonly retainedCodeUnits: number;
  readonly sourceRowsRead: number;
  readonly retainedRows: number;
  readonly sourceLiveRows: number;
}

async function collectHeap(): Promise<number> {
  await Bun.sleep(0);
  Bun.gc(true);
  await Bun.sleep(0);
  Bun.gc(true);
  return heapSize();
}

async function independentTokenCount(large: boolean): Promise<number> {
  let input = '[';
  for (let index = 0; index < rowCount; index++) {
    if (index !== 0) input += ',';
    input += JSON.stringify({
      role: 'user',
      content: projectionRowText(index, large && index === rowCount - 1),
    });
  }
  input += ']';
  const encoder = await getO200kBaseEncoder();
  return (
    countO200kBaseTokens(encoder, projectionInstructions) +
    countO200kBaseTokens(encoder, input)
  );
}

async function independentActualEstimate(
  setup: Setup,
  large: boolean,
): Promise<PromptEnvelopeEstimate> {
  const rows = {
    count: rowCount,
    async *openReader(): AsyncGenerator<IContent, void> {
      for (let index = 0; index < rowCount; index++) {
        yield {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: projectionRowText(index, large && index === 63),
            },
          ],
        };
      }
    },
  };
  const projection = await setup.provider.projectPromptEnvelope({
    ...setup.options(rows),
    requestRows: undefined,
  });
  try {
    return await estimatePromptEnvelope(
      setup.provider.name,
      projection,
      setup.factory,
    );
  } finally {
    await projection.releaseIfUnsent?.();
  }
}

function retainedProjectionCodeUnits(
  projection: PromptEnvelopeProjection,
): number {
  const value = projection.finalizedProjection;
  if (typeof value !== 'object' || value === null) return 0;
  const text =
    'promptText' in value && typeof value.promptText === 'string'
      ? value.promptText.length
      : 0;
  if (!('promptSegments' in value) || !Array.isArray(value.promptSegments))
    return text;
  return (
    text +
    value.promptSegments.reduce(
      (sum: number, segment: unknown) =>
        sum + (typeof segment === 'string' ? segment.length : 0),
      0,
    )
  );
}

async function prepareMeasured(
  setup: Setup,
  disk: Disk,
  signal?: AbortSignal,
): Promise<Prepared> {
  const options = setup.options(disk.rows, signal);
  const projection = await setup.provider.projectPromptEnvelope(options);
  const estimate = await estimatePromptEnvelope(
    setup.provider.name,
    projection,
    setup.factory,
  );
  return {
    projection,
    estimate,
    options: {
      ...options,
      promptEnvelopeTransportToken: projection.transportToken,
    },
  };
}

async function prepareMeasuredLease(
  setup: Setup,
  disk: Disk,
): Promise<PreparedLease> {
  const prepared = await prepareMeasured(setup, disk);
  return {
    options: prepared.options,
    estimate: prepared.estimate,
    retainedCodeUnits: retainedProjectionCodeUnits(prepared.projection),
    releaseIfUnsent: prepared.projection.releaseIfUnsent,
  };
}

async function runProjectionScenario(
  large: boolean,
  retain: boolean,
): Promise<ProjectionFacts> {
  const http = projectionEndpoint(true);
  const setup = await projectionRuntime(
    `http://127.0.0.1:${http.server.port}/v1`,
    process.cwd(),
  );
  const expected = projectionWireOracle(large);
  const expectedEstimate = await independentActualEstimate(setup, large);
  expect(expectedEstimate.estimatedPromptTokens).toBe(
    await independentTokenCount(large),
  );
  const disk = projectionDiskRows(large, retain);
  const baseline = await collectHeap();
  let stream: AsyncIterableIterator<IContent> | undefined;
  let releaseIfUnsent: (() => Promise<void>) | undefined;
  try {
    const prepared = await prepareMeasuredLease(setup, disk);
    releaseIfUnsent = prepared.releaseIfUnsent;
    expect(prepared.estimate).toStrictEqual(expectedEstimate);
    expect(prepared.options.metadata?.['_retryRequestContext']).toStrictEqual({
      requestId: 'actual-projection',
    });
    expect(disk.state.active).toBe(0);
    const preparedBytes = (await collectHeap()) - baseline;
    const retainedCodeUnits = prepared.retainedCodeUnits;
    stream = setup.provider.generateChatCompletion(prepared.options);
    const first = stream.next();
    await http.arrived.wait;
    const pausedUploadBytes = (await collectHeap()) - baseline;
    http.readBody.release();
    await http.uploaded.wait;
    expect(disk.state.active).toBe(0);
    const uploadedBytes = (await collectHeap()) - baseline;
    expect(disk.state.closed).toBe(false);
    http.respond.release();
    const firstResult = await first;
    expect(firstResult.done).toBe(false);
    const responseBytes = (await collectHeap()) - baseline;
    await drainProjectionResponse(stream, firstResult.value);
    expect(http.bodies).toStrictEqual([expected, expected]);
    expect(disk.state.active).toBe(0);
    expect(activeRequestBodyCount()).toBe(0);
    const facts = {
      large,
      retain,
      expected,
      estimate: prepared.estimate,
      preparedBytes,
      pausedUploadBytes,
      uploadedBytes,
      responseBytes,
      retainedCodeUnits,
      sourceRowsRead: disk.state.pulled,
      retainedRows: disk.retained.length,
      sourceLiveRows: disk.references.filter(
        (reference) => reference.deref() !== undefined,
      ).length,
    };
    return facts;
  } finally {
    http.readBody.release();
    http.respond.release();
    await stream?.return?.();
    await releaseIfUnsent?.();
    disk.close();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

async function drainProjectionResponse(
  stream: AsyncIterableIterator<IContent>,
  first: IContent | void,
): Promise<void> {
  let text =
    first === undefined
      ? ''
      : first.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('');
  for await (const row of stream) {
    text += row.blocks
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
  }
  expect(text).toBe('finished');
}

async function abortPausedProjection(): Promise<string> {
  const http = projectionEndpoint(false);
  const disk = projectionDiskRows(false, false);
  const setup = await projectionRuntime(
    `http://127.0.0.1:${http.server.port}/v1`,
    disk.root,
  );
  const controller = new AbortController();
  const prepared = await prepareMeasured(setup, disk, controller.signal);
  const stream = setup.provider.generateChatCompletion(prepared.options);
  try {
    const readersBeforeSend = disk.state.opened;
    const pending = stream.next();
    const settled = pending.then(
      () => 'unexpected response',
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    );
    await http.arrived.wait;
    controller.abort(new Error('cancel paused actual projection'));
    const outcome = await settled;
    expect(outcome).toBe('cancel paused actual projection');
    expect(disk.state.opened - readersBeforeSend).toBe(0);
    expect(http.bodies).toHaveLength(0);
    expect(disk.state.active).toBe(0);
    expect(activeRequestBodyCount()).toBe(0);
    return outcome;
  } finally {
    http.readBody.release();
    http.respond.release();
    await stream.return?.();
    await prepared.projection.releaseIfUnsent?.();
    disk.close();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

describe('actual Responses projection disk ownership', () => {
  it.each([false, true])(
    'preserves independent BODY bytes and exact actual estimate through paused HTTP and retry, oversized=%s',
    async (large) => {
      const facts = await runProjectionScenario(large, false);
      expect(facts.estimate.model).toBe(projectionModel);
      expect(facts.estimate.estimatorMethod).toBe('exact');
      expect(facts.estimate.estimatorFamily).toBe('openai-gpt-5.6');
      expect(facts.estimate.estimatorVersion).toBe('gpt-5.6-o200k-v2');
      expect(facts.estimate.projectionRevision).toBe(4);
      expect(facts.estimate.unsupportedMedia).toStrictEqual([]);
      expect(facts.sourceLiveRows).toBe(0);
      expect(
        Buffer.byteLength(projectionRowText(rowCount - 1, large)),
      ).toBeGreaterThan(large ? 10 * 1024 * 1024 : 96 * 1024);
      const distinctPrefixes = new Set<string>();
      for (let index = 0; index < rowCount; index++) {
        distinctPrefixes.add(projectionRowText(index, false).slice(0, 40));
      }
      expect(distinctPrefixes.size).toBe(rowCount);
      expect(facts.expected.bytes).toBeGreaterThan(
        large ? 10 * 1024 * 1024 : 64 * 96 * 1024,
      );
    },
    120000,
  );

  it('removes its request snapshot workspace when an unused actual projection is released', async () => {
    const disk = projectionDiskRows(false, false);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const before = new Set(readdirSync(getScratchRoot()));
    try {
      const prepared = await prepareMeasuredLease(setup, disk);
      await prepared.releaseIfUnsent?.();
      expect(activeRequestBodyCount()).toBe(0);
      const abandoned = readdirSync(getScratchRoot()).filter(
        (name) =>
          name.startsWith('responses-request-snapshot-') && !before.has(name),
      );
      expect(abandoned).toHaveLength(0);
    } finally {
      disk.close();
      await setup.config.dispose();
    }
  }, 60000);

  it('keeps finalized estimation source-backed without complete promptText or promptSegments payloads', async () => {
    const facts = await runProjectionScenario(false, false);
    expect(facts.retainedCodeUnits).toBe(0);
  }, 60000);

  it('does not retain context-scale text or request graphs during prepared request, HTTP pause and response lifetime', async () => {
    const facts = await runProjectionScenario(
      true,
      process.env.ISSUE854_RETAIN_REAL_PROJECTION === '1',
    );
    expect(
      Math.max(facts.preparedBytes, facts.uploadedBytes, facts.responseBytes),
    ).toBeLessThanOrEqual(1024 * 1024);
    expect(facts.retainedCodeUnits).toBe(0);
  }, 120000);

  it('cancels a projected actual HTTP request while the receiver is paused without opening a new row reader', async () => {
    expect(await abortPausedProjection()).toBe(
      'cancel paused actual projection',
    );
  }, 60000);

  if (process.env.ISSUE854_RETAIN_REAL_PROJECTION === '1') {
    it('detects a deliberately retaining disk owner even while actual projection estimates and body remain correct', async () => {
      const facts = await runProjectionScenario(false, true);
      expect(facts.retainedRows).toBe(rowCount);
      expect(facts.sourceLiveRows).toBe(0);
      expect(facts.preparedBytes).toBeLessThanOrEqual(1024 * 1024);
    }, 120000);
  }
});
