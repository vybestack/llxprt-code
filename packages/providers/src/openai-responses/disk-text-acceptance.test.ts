/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { heapSize } from 'bun:jsc';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeEstimate,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { Gpt56SourceProjection } from '../tokenizers/gpt56-source-projection.js';
import {
  diskTextFixture,
  diskTextRow,
  diskTextWireOracle,
} from './__tests__/support/disk-text-fixture.js';
import {
  projectionEndpoint,
  projectionRuntime,
} from './__tests__/support/projection-ownership-fixture.js';
import { observeDiskBody } from './__tests__/support/disk-text-body-observer.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';

type Setup = Awaited<ReturnType<typeof projectionRuntime>>;
type BodyObservation = ReturnType<typeof observeDiskBody>;
async function heap(): Promise<number> {
  for (let index = 0; index < 8; index++) {
    await Bun.sleep(0);
    Bun.gc(true);
  }
  return heapSize();
}
async function nativeEstimate(
  setup: Setup,
  large: boolean,
): Promise<PromptEnvelopeEstimate> {
  const rows = {
    count: 64,
    async *openReader() {
      for (let index = 0; index < 64; index++) yield diskTextRow(index, large);
    },
  };
  const projection = await setup.provider.projectPromptEnvelope({
    ...setup.options(requestSelection(rows)),
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
function segmentDescriptors(source: Gpt56SourceProjection): string[] {
  const result = spawnSync('lsof', ['-p', String(process.pid), '-Fn'], {
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`Descriptor inspection failed: ${result.stderr}`);
  return result.stdout
    .split('\n')
    .filter((line) =>
      source.promptSegments.some(
        (segment) => line === `n${segment.source.path}`,
      ),
    );
}
async function warmRuntime(setup: Setup): Promise<void> {
  let requests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      await request.arrayBuffer();
      if (++requests === 1)
        return new Response('{"error":{"message":"warm retry"}}', {
          status: 503,
        });
      return new Response(
        'data: {"type":"response.completed","response":{"id":"resp_warm","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const rows = requestSelection({
    count: 1,
    async *openReader() {
      yield diskTextRow(0, false);
    },
  });
  const options = {
    ...setup.options(rows),
    resolved: { baseURL: `http://127.0.0.1:${server.port}/v1` },
  };
  const projection = await setup.provider.projectPromptEnvelope(options);
  const observer = observeDiskBody();
  observer.resume.release();
  try {
    await estimatePromptEnvelope(
      setup.provider.name,
      projection,
      withGpt56DiskSources(setup.factory, tmpdir()),
    );
    if (!(projection.finalizedProjection instanceof Gpt56SourceProjection))
      throw new Error('Missing warm source');
    segmentDescriptors(projection.finalizedProjection);
    for await (const row of setup.provider.generateChatCompletion({
      ...options,
      promptEnvelopeTransportToken: projection.transportToken,
    }))
      expect(row.speaker).toBe('ai');
  } finally {
    observer.restore();
    await projection.releaseIfUnsent?.();
    await server.stop(true);
  }
}
async function uploadMeasurements(
  stream: AsyncIterableIterator<
    import('@vybestack/llxprt-code-core/services/history/IContent.js').IContent
  >,
  http: ReturnType<typeof projectionEndpoint>,
  observer: BodyObservation,
  source: Gpt56SourceProjection,
): Promise<{
  firstChunkHeap: number;
  firstDemand: BodyObservation['state'];
  pausedHeap: number;
  lastChunkHeap: number;
  responseHeap: number;
  finalHeap: number;
  descriptorsAtUpload: string[];
}> {
  const first = stream.next();
  await Promise.race([
    observer.first.wait,
    first.then(() => {
      throw new Error('No actual BODY demand');
    }),
  ]);
  const firstChunkHeap = await heap();
  const firstDemand = { ...observer.state };
  observer.resume.release();
  await http.arrived.wait;
  const pausedHeap = await heap();
  http.readBody.release();
  await http.uploaded.wait;
  await observer.last.wait;
  const lastChunkHeap = await heap();
  const descriptorsAtUpload = segmentDescriptors(source);
  http.respond.release();
  if ((await first).done === true)
    throw new Error('Missing actual provider response');
  const responseHeap = await heap();
  for await (const row of stream) expect(row.speaker).toBe('ai');
  const finalHeap = await heap();
  return {
    firstChunkHeap,
    firstDemand,
    pausedHeap,
    lastChunkHeap,
    responseHeap,
    finalHeap,
    descriptorsAtUpload,
  };
}

function largestRowSize(large: boolean): number {
  return diskTextRow(63, large).blocks.reduce(
    (sum, block) =>
      sum + (block.type === 'text' ? Buffer.byteLength(block.text) : 0),
    0,
  );
}
function requireSource(value: unknown): Gpt56SourceProjection {
  if (!(value instanceof Gpt56SourceProjection))
    throw new Error('Missing actual provider source projection');
  return value;
}
async function acceptance(large: boolean, retainRows = false) {
  const disk = diskTextFixture(large, retainRows);
  const http = projectionEndpoint(true);
  const setup = await projectionRuntime(
    `http://127.0.0.1:${http.server.port}/v1`,
    disk.root,
  );
  const expected = diskTextWireOracle(large);
  const oracle = await nativeEstimate(setup, large);
  const largestRowBytes = largestRowSize(large);
  await warmRuntime(setup);
  const baseline = await heap();
  const options = setup.options(requestSelection(disk.rows));
  const projection = await setup.provider.projectPromptEnvelope(options);
  const source = requireSource(projection.finalizedProjection);
  const estimate = await estimatePromptEnvelope(
    setup.provider.name,
    projection,
    withGpt56DiskSources(setup.factory, tmpdir()),
  );
  const preparedHeap = await heap();
  const preparedScan = disk.state.pulled;
  const livePreparedRows = disk.references.filter(
    (row) => row.deref() !== undefined,
  ).length;
  const observer = observeDiskBody();
  const stream = setup.provider.generateChatCompletion({
    ...options,
    promptEnvelopeTransportToken: projection.transportToken,
  });
  try {
    const measurements = await uploadMeasurements(
      stream,
      http,
      observer,
      source,
    );
    const liveFinalRows = disk.references.filter(
      (row) => row.deref() !== undefined,
    ).length;
    const facts = {
      large,
      expected,
      oracle,
      estimate,
      largestRowBytes,
      preparedScan,
      finalScan: disk.state.pulled,
      livePreparedRows,
      liveFinalRows,
      bodyDemand: { ...observer.state },
      baseline,
      preparedHeap,
      ...measurements,
      finalDescriptors: segmentDescriptors(source),
      pathsRemoved: source.promptSegments.every(
        (segment) => !existsSync(segment.source.path),
      ),
      bodies: http.bodies,
      activeBodies: activeRequestBodyCount(),
    };
    return facts;
  } finally {
    observer.resume.release();
    http.readBody.release();
    http.respond.release();
    await stream.return?.();
    await projection.releaseIfUnsent?.();
    observer.restore();
    disk.close();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

function assertAcceptance(facts: Awaited<ReturnType<typeof acceptance>>): void {
  expect(facts.estimate).toStrictEqual(facts.oracle);
  expect(facts.bodies).toStrictEqual([facts.expected, facts.expected]);
  expect(facts.preparedScan).toBe(64);
  expect(facts.finalScan).toBe(64);
  expect(facts.livePreparedRows).toBe(0);
  expect(facts.liveFinalRows).toBe(0);
  expect(
    Math.max(
      facts.preparedHeap,
      facts.firstChunkHeap,
      facts.pausedHeap,
      facts.lastChunkHeap,
      facts.responseHeap,
      facts.finalHeap,
    ) - facts.baseline,
  ).toBeLessThanOrEqual(1024 * 1024);
  expect(facts.bodyDemand.bytes).toBe(2 * facts.expected.bytes);
  expect(facts.bodyDemand.attempts).toBe(2);
  expect(facts.bodyDemand.active).toBe(0);
  expect(facts.descriptorsAtUpload).toHaveLength(0);
  expect(facts.finalDescriptors).toHaveLength(0);
  expect(facts.pathsRemoved).toBe(true);
  expect(facts.activeBodies).toBe(0);
}
describe('actual stateless disk provider ownership acceptance', () => {
  it.each([false, true])(
    'preserves native metadata and independent HTTP bytes with bounded live owners, oversized=%s',
    async (large) => {
      const facts = await acceptance(large);
      expect(facts.largestRowBytes).toBeGreaterThan(
        large ? 10 * 1024 * 1024 : 500,
      );
      assertAcceptance(facts);
    },
    600000,
  );
  it('trap: rows deliberately held by the test fail the live-row gate', async () => {
    const facts = await acceptance(false, true);
    expect(() => assertAcceptance(facts)).toThrow('expect(received)');
    expect(facts.livePreparedRows).toBeGreaterThan(0);
  }, 600000);
});
