/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  median,
  settledHeap,
} from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { appendFileSync, readdirSync } from 'node:fs';
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
  projectionEndpoint,
  projectionInstructions,
  projectionModel,
  projectionRuntime,
  rowCount,
} from './__tests__/support/projection-ownership-fixture.js';
import {
  diskTextFixture as projectionDiskRows,
  diskTextRow,
  distributedTextRows,
  type DiskTextShape,
  diskTextWireOracle as projectionWireOracle,
} from './__tests__/support/disk-text-fixture.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { applicationRetention } from '../__tests__/support/application-retention.js';

// Real sends hand the provider a request selection (requestRows), which takes
// the source projection. Plain rows select the legacy collecting projection,
// which product sends no longer use; it remains here only as the independent
// estimate oracle (`independentActualEstimate`), never as the subject.

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
  readonly large: DiskTextShape;
  readonly retain: boolean;
  readonly expected: { bytes: number; sha256: string };
  readonly estimate: PromptEnvelopeEstimate;
  /** Application-memory growth per checkpoint; empty when not measured. */
  readonly heap: LifecycleHeap;
  readonly retainedCodeUnits: number;
  readonly sourceRowsRead: number;
  readonly retainedRows: number;
  readonly sourceLiveRows: number;
  readonly sourceLiveBytes: number;
  readonly largestRowBytes: number;
  readonly largestRowTextUnits: number;
  readonly payloadBytes: number;
}

type LifecycleCheckpoint =
  | 'prepared'
  | 'pausedUpload'
  | 'uploaded'
  | 'response';
const lifecycleCheckpoints: readonly LifecycleCheckpoint[] = [
  'prepared',
  'pausedUpload',
  'uploaded',
  'response',
];
type LifecycleHeap = Partial<Record<LifecycleCheckpoint, number>>;

// Application memory of a settled heap: JSC compiler and code-block cells are
// excluded because their churn moved raw heapSize by more than one row between
// otherwise identical runs, and they hold no request data. A snapshot counts
// live cells only, so allocator jitter does not enter the reading; the gate
// takes the median over runs. Snapshots are slow, so only gate scenarios read.
async function applicationHeap(): Promise<number> {
  await settledHeap();
  return applicationRetention(Bun.generateHeapSnapshot()).heap;
}

async function independentTokenCount(large: DiskTextShape): Promise<number> {
  let input = '[';
  for (let index = 0; index < rowCount; index++) {
    if (index !== 0) input += ',';
    const row = diskTextRow(index, large);
    input += JSON.stringify({
      role: row.speaker === 'human' ? 'user' : 'assistant',
      content: row.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join(row.speaker === 'human' ? '\n' : ''),
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
  large: DiskTextShape,
): Promise<PromptEnvelopeEstimate> {
  const rows = {
    count: rowCount,
    readAt: (index: number) => diskTextRow(index, large),
    async *openReader(): AsyncGenerator<IContent, void> {
      for (let index = 0; index < rowCount; index++)
        yield diskTextRow(index, large);
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
  const options = setup.options(requestSelection(disk.rows), signal);
  expect(options.requestRows).toBeDefined();
  const projection = await setup.provider.projectPromptEnvelope(options);
  const estimate = await estimatePromptEnvelope(
    setup.provider.name,
    projection,
    withGpt56DiskSources(setup.factory, setup.config.scratchRoots.getRoot()),
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
  large: DiskTextShape,
  retain: boolean,
  measureHeap = false,
): Promise<ProjectionFacts> {
  const http = projectionEndpoint(true);
  const setup = await projectionRuntime(
    `http://127.0.0.1:${http.server.port}/v1`,
    process.cwd(),
  );
  const expected = projectionWireOracle(large);
  const disk = projectionDiskRows(large, retain);
  const heap: LifecycleHeap = {};
  const baseline = measureHeap ? await applicationHeap() : undefined;
  // Unmeasured scenarios still settle at each checkpoint so the final
  // source-liveness checks observe collected rows.
  const checkpoint = async (name: LifecycleCheckpoint): Promise<void> => {
    if (baseline === undefined) await settledHeap();
    else heap[name] = (await applicationHeap()) - baseline;
  };
  let stream: AsyncIterableIterator<IContent> | undefined;
  let releaseIfUnsent: (() => Promise<void>) | undefined;
  try {
    const prepared = await prepareMeasuredLease(setup, disk);
    releaseIfUnsent = prepared.releaseIfUnsent;
    expect(prepared.options.metadata?.['_retryRequestContext']).toStrictEqual({
      requestId: 'actual-projection',
    });
    expect(disk.state.active).toBe(0);
    await checkpoint('prepared');
    const retainedCodeUnits = prepared.retainedCodeUnits;
    stream = setup.provider.generateChatCompletion(prepared.options);
    const first = stream.next();
    await http.arrived.wait;
    await checkpoint('pausedUpload');
    http.readBody.release();
    await http.uploaded.wait;
    expect(disk.state.active).toBe(0);
    await checkpoint('uploaded');
    expect(disk.state.closed).toBe(false);
    http.respond.release();
    const firstResult = await first;
    expect(firstResult.done).toBe(false);
    await checkpoint('response');
    await drainProjectionResponse(stream, firstResult.value);
    const expectedEstimate = await independentActualEstimate(setup, large);
    expect(expectedEstimate.estimatedPromptTokens).toBe(
      await independentTokenCount(large),
    );
    expect(expectedEstimate.estimatedPromptTokens).toBeLessThan(1_000_000);
    expect(prepared.estimate).toStrictEqual(expectedEstimate);
    expect(http.bodies).toStrictEqual([expected, expected]);
    expect(disk.state.active).toBe(0);
    expect(activeRequestBodyCount(setup.provider.requestBodyCensus)).toBe(0);
    let largestRowBytes = 0;
    let largestRowTextUnits = 0;
    let payloadBytes = 0;
    for (let index = 0; index < rowCount; index++) {
      const row = diskTextRow(index, large);
      const bytes = Buffer.byteLength(JSON.stringify(row));
      largestRowBytes = Math.max(largestRowBytes, bytes);
      largestRowTextUnits = Math.max(
        largestRowTextUnits,
        row.blocks.reduce(
          (sum, block) => sum + (block.type === 'text' ? block.text.length : 0),
          0,
        ),
      );
      payloadBytes += bytes;
    }
    const sourceLiveBytes = disk.references.reduce((sum, reference) => {
      const row = reference.deref();
      return (
        sum + (row === undefined ? 0 : Buffer.byteLength(JSON.stringify(row)))
      );
    }, 0);
    const facts = {
      large,
      retain,
      largestRowBytes,
      largestRowTextUnits,
      payloadBytes,
      sourceLiveBytes,
      expected,
      estimate: prepared.estimate,
      heap,
      retainedCodeUnits,
      sourceRowsRead: disk.state.pulled,
      retainedRows: disk.retained.length,
      sourceLiveRows: disk.references.filter(
        (reference) => reference.deref() !== undefined,
      ).length,
    };
    const evidence = process.env['H3_ALLOWANCE_EVIDENCE'];
    if (evidence !== undefined)
      appendFileSync(
        evidence,
        `${JSON.stringify({ suite: 'projection-ownership', ...facts })}
`,
      );
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
    expect(activeRequestBodyCount(setup.provider.requestBodyCensus)).toBe(0);
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

function projectionHeap(facts: ProjectionFacts): number {
  return Math.max(
    ...lifecycleCheckpoints.map((name) => {
      const bytes = facts.heap[name];
      if (bytes === undefined)
        throw new Error(`Scenario did not measure the ${name} checkpoint`);
      return bytes;
    }),
  );
}

/**
 * Peak memory of converting one row. While the upload is paused the decoded
 * row's text and the converted input item's content are both live as JS
 * strings, and JSC stores text holding any non-Latin-1 unit at two bytes per
 * UTF-16 code unit. The item's encoded JSON wire bytes may also be in flight.
 */
function oneRowConversionBytes(facts: ProjectionFacts): number {
  return 2 * 2 * facts.largestRowTextUnits + facts.largestRowBytes;
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
      // Exact UTF-8 JSON ownership has zero non-payload overhead. Final-zero
      // liveness stays stricter than the additional one-row byte allowance.
      expect(facts.sourceLiveBytes).toBeLessThanOrEqual(facts.largestRowBytes);
      const distinctPrefixes = new Set<string>();
      for (let index = 0; index < rowCount; index++) {
        const block = diskTextRow(index, false).blocks[0];
        if (block.type !== 'text') throw new Error('Expected a text block');
        distinctPrefixes.add(block.text.slice(0, 40));
      }
      expect(distinctPrefixes.size).toBe(rowCount);
      expect(facts.expected.bytes).toBeGreaterThan(large ? 120_000 : 0);
    },
    120000,
  );

  it('removes its scratch workspaces when an unused actual projection is released', async () => {
    const disk = projectionDiskRows(false, false);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const before = new Set(readdirSync(setup.config.scratchRoots.getRoot()));
    try {
      const prepared = await prepareMeasuredLease(setup, disk);
      await prepared.releaseIfUnsent?.();
      expect(activeRequestBodyCount(setup.provider.requestBodyCensus)).toBe(0);
      const abandoned = readdirSync(setup.config.scratchRoots.getRoot()).filter(
        (name) =>
          (name.startsWith('responses-request-snapshot-') ||
            name.startsWith('responses-prompt-keys-')) &&
          !before.has(name),
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
    // Calibration runs the same scenario and checkpoints with small rows, so
    // fixed lifecycle costs such as the paused server request are measured
    // like-for-like; only the one-row conversion term scales with row size.
    // The warm run is sampled too: the first sampled scenario grows lasting
    // state that later runs, calibration or gate, do not pay again. Both sides
    // take the median of three runs.
    const smallestBackpressuredRows = { rowCodeUnits: 4096 };
    await runProjectionScenario(smallestBackpressuredRows, false, true);
    const calibrations: number[] = [];
    for (let run = 0; run < 3; run++)
      calibrations.push(
        projectionHeap(
          await runProjectionScenario(smallestBackpressuredRows, false, true),
        ),
      );
    const fixedOverhead = median(calibrations);
    await runProjectionScenario(distributedTextRows, false);
    const gates: number[] = [];
    let allowance = 0;
    for (let run = 0; run < 3; run++) {
      const facts = await runProjectionScenario(
        distributedTextRows,
        false,
        true,
      );
      expect(facts.retainedCodeUnits).toBe(0);
      allowance = fixedOverhead + oneRowConversionBytes(facts);
      expect(facts.payloadBytes).toBeGreaterThan(4 * allowance);
      gates.push(projectionHeap(facts));
    }
    expect(median(gates)).toBeLessThanOrEqual(allowance);
    const control = await runProjectionScenario(
      distributedTextRows,
      true,
      true,
    );
    expect(control.sourceLiveRows).toBe(rowCount);
    expect(projectionHeap(control)).toBeGreaterThan(3 * allowance);
    const evidence = process.env['H3_ALLOWANCE_EVIDENCE'];
    if (evidence !== undefined)
      appendFileSync(
        evidence,
        `${JSON.stringify({ suite: 'projection-gate', calibrations, fixedOverhead, oneRow: oneRowConversionBytes(control), allowance, gates, control: projectionHeap(control) })}\n`,
      );
  }, 300000);

  it('cancels a projected actual HTTP request while the receiver is paused without opening a new row reader', async () => {
    expect(await abortPausedProjection()).toBe(
      'cancel paused actual projection',
    );
  }, 60000);

  it('detects a deliberately retaining disk owner even while actual projection estimates and body remain correct', async () => {
    const facts = await runProjectionScenario(false, true);
    expect(facts.retainedRows).toBe(rowCount);
    expect(facts.sourceLiveRows).toBe(rowCount);
    expect(facts.payloadBytes).toBeGreaterThanOrEqual(
      4 * facts.largestRowBytes,
    );
    expect(facts.sourceLiveBytes).toBeGreaterThan(3 * facts.largestRowBytes);
  }, 120000);
});
