/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: child-process probe that sends histories through a real
 * provider send path and measures memory while each request goes out.
 *
 * Usage: `bun send-peak-probe.ts <routeId> <rootDirectory>`
 *
 * `<rootDirectory>/plan.json` names the row source, the number of measured
 * rounds and, for each shape, its small and large row counts. `<rootDirectory>/<shape>/small` and `.../large` hold one
 * v8-serialized row per file (`<index>.row`), read back one at a time, so the
 * probe never holds a history. The transport is a stub at the global `fetch`
 * seam: it hashes the request body as it streams and keeps nothing. While a
 * send is running the probe samples the settled heap, the ArrayBuffer total
 * and the resident set size, at every 2048th row read, at the first body byte,
 * at every MiB of body streamed and at the end of the body. The baseline of
 * each send is the quiet reading after the previous one.
 *
 * Per shape, one unmeasured send of the small size warms the code paths once
 * the runtime has aged out its cold code. Then the small and the large size
 * are measured alternately for the planned rounds, each send after the heap has
 * gone quiet. Retention is measured apart from that: the large history is sent
 * again and again in this process, with a settled reading after each send, so
 * the judgment can compare the last send with the first (a leak adds up with
 * every send; the one-time offset of a settled reading does not). The result
 * is written to `<rootDirectory>/measured.json`.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { openSendPeakSampleLog } from './send-peak-sample-log.js';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeProjection,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import type { GenerateChatOptions, IProvider } from '../../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  SETTLED_WINDOW_BYTES,
  median,
  settledHeap,
} from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  WIRE_ROUTES,
  buildRouteCallOptions,
  type WireRoute,
} from './wireBodyCapture.js';
import { SEND_PEAK_REQUEST_SHAPE } from './sendPeakShapes.js';
import { nativeProbeCost } from './native-probe-cost.js';
import type { NativeRouteCounts } from './native-route-observer.js';
import { observeNativeRoute } from './native-route-observer.js';
import { prepareNativeProbeSources } from './native-probe-source.js';
import { isolatedWireHashSink } from './isolated-wire-hash-sink.js';
import {
  SEND_TRAP_ENV,
  armSendTrap,
  parseSendTrap,
  type SendTrap,
  type TrapHold,
} from './sendPeakTraps.js';
import {
  SEND_PEAK_ACCUMULATION_SENDS,
  isSendPeakPlan,
  type AccumulationReading,
  type SendPeakMeasurement,
  type SendPeakPlan,
  type SendPeakSeries,
  type SendPeakSource,
  type ShapeCounts,
} from './sendPeakMeasurement.js';

const sampleLog = openSendPeakSampleLog(process.env.SEND_PEAK_LOG);
if (sampleLog !== undefined) process.once('exit', () => sampleLog.close());

/** Rows whose liveness is watched; only the newest are still expected alive. */
const RECENT_ROW_WINDOW = 64;
/**
 * JSC can leave a dead multi-megabyte string counted after one collection and
 * reclaim it on the next, so one reading can overstate by a dead string.
 * Retention shows in every round, hence the minimum over a few rounds.
 */
const SETTLE_ROUNDS = 3;

/**
 * The runtime ages out cold code on its own timers: in a bare probe process
 * the settled heap fell by about 7 MiB at 5-7 s and by another 1.7 MiB at
 * about 17 s, with no send running, and was flat after that. A baseline taken
 * earlier sits that far too high and hides that much real growth, and code
 * that aged out before a measured send comes back as growth during it. So the
 * warm-up send waits until the process is past those drops, and each baseline
 * is taken only after the heap has stayed put over consecutive readings.
 */
const CODE_AGING_DONE_SECONDS = 20;
const QUIET_READINGS = 3;
const QUIET_INTERVAL_MS = 500;
const QUIET_MAX_READINGS = 30;
/** Settled readings behind each accumulation reading, and the pause between them. */
const ACCUMULATION_READINGS = 3;
const ACCUMULATION_PAUSE_MS = 100;

interface Job {
  readonly directory: string;
  readonly count: number;
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  throw new Error('usage: send-peak-probe <routeId> <rootDirectory>');
}
const [routeId, root] = args;
const route = WIRE_ROUTES.find((candidate) => candidate.id === routeId);
if (route === undefined) throw new Error(`unknown wire route ${routeId}`);
const parsedPlan: unknown = JSON.parse(
  readFileSync(join(root, 'plan.json'), 'utf8'),
);
if (!isSendPeakPlan(parsedPlan)) throw new Error('invalid send peak plan');
const plan: SendPeakPlan = parsedPlan;
const source: SendPeakSource = plan.source;
const envTrap = parseSendTrap(process.env[SEND_TRAP_ENV]);
/**
 * `retain` leaks across sends, so it applies to the accumulation run only.
 * `estimate` is armed at the estimate step, not when the rows are opened.
 */
const peakTrap: SendTrap | undefined =
  envTrap === 'retain' || envTrap === 'estimate' ? undefined : envTrap;
const estimateTrap: SendTrap | undefined =
  envTrap === 'estimate' ? envTrap : undefined;
const accumulationTrap: SendTrap | undefined =
  envTrap === 'retain' ? envTrap : undefined;
const deadline = setTimeout(() => {
  throw new Error('Send peak probe did not settle');
}, 600000);

function progress(phase: string, job?: Job): void {
  const path = process.env.SEND_PEAK_LOG;
  if (path !== undefined)
    appendFileSync(
      `${path}.progress.jsonl`,
      `${JSON.stringify({ phase, pid: process.pid, uptime: process.uptime(), job })}
`,
    );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

interface Reading {
  readonly heap: number;
  readonly arrayBuffers: number;
  readonly rss: number;
}

async function settledReading(): Promise<Reading> {
  let heap = Number.POSITIVE_INFINITY;
  let arrayBuffers = Number.POSITIVE_INFINITY;
  let rss = 0;
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    heap = Math.min(heap, await settledHeap());
    const usage = process.memoryUsage();
    arrayBuffers = Math.min(arrayBuffers, usage.arrayBuffers);
    rss = Math.max(rss, usage.rss);
  }
  return { heap, arrayBuffers, rss };
}

class MemorySampler {
  /**
   * Weak references to the most recent rows. The window is bounded so the
   * tracking itself does not grow with the history.
   */
  private readonly recentRows: Array<WeakRef<IContent>> = [];
  private peakHeap = 0;
  private peakArrayBuffers = 0;
  private peakRss = 0;
  private samples = 0;
  private peakLive = 0;

  trackRow(row: IContent): void {
    this.recentRows.push(new WeakRef(row));
    if (this.recentRows.length > RECENT_ROW_WINDOW) this.recentRows.shift();
  }

  constructor(private readonly baseline: Reading) {}

  /** Records one in-flight sample against the baseline. */
  async sample(phase = 'rows'): Promise<void> {
    const now = await settledReading();
    sampleLog?.write({
      phase,
      baseline: this.baseline,
      now,
      heapDelta: now.heap - this.baseline.heap,
    });
    this.samples += 1;
    this.peakHeap = Math.max(this.peakHeap, now.heap - this.baseline.heap);
    this.peakArrayBuffers = Math.max(
      this.peakArrayBuffers,
      now.arrayBuffers - this.baseline.arrayBuffers,
    );
    this.peakRss = Math.max(this.peakRss, now.rss);
    this.peakLive = Math.max(
      this.peakLive,
      this.recentRows.reduce(
        (n, ref) => n + Number(ref.deref() !== undefined),
        0,
      ),
    );
  }

  summary(): Pick<
    SendPeakMeasurement,
    'peakHeap' | 'peakArrayBuffers' | 'peakRss' | 'samples' | 'peakLive'
  > {
    return {
      peakHeap: this.peakHeap,
      peakArrayBuffers: this.peakArrayBuffers,
      peakRss: this.peakRss,
      samples: this.samples,
      peakLive: this.peakLive,
    };
  }
}

interface BodyEvidence {
  nativeRoute?: NativeRouteCounts;
  bytes: number;
  sha256: string;
  contentLength: string | null;
  chunks: number;
  modelRequests: number;
}

function emptyEvidence(): BodyEvidence {
  return {
    bytes: 0,
    sha256: '',
    contentLength: null,
    chunks: 0,
    modelRequests: 0,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function redirectToLocalHttp(baseURL: string): () => void {
  const original = globalThis.fetch;
  const destination = new URL(baseURL);
  globalThis.fetch = Object.assign(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = new URL(requestUrl(input));
      url.protocol = destination.protocol;
      url.host = destination.host;
      return original(
        input instanceof Request ? new Request(url, input) : url,
        init,
      );
    },
    { preconnect: original.preconnect },
  );
  return () => {
    globalThis.fetch = original;
  };
}

interface SelectionHandle {
  readonly selection: ProviderRequestSelection;
  arm(): Promise<void>;
  /** The rows again, unsampled, for a trap that holds them. */
  rows(): AsyncIterable<IContent>;
  /** The hold taken by the trap, released by the caller after the send. */
  hold(): TrapHold | undefined;
}

function nativeSelection(
  job: Job,
  sampler: MemorySampler | undefined,
  activeTrap: SendTrap | undefined,
): SelectionHandle {
  return nativeSources.handle(job, sampler, activeTrap);
}

const tokenizerFactory = createRuntimeTokenizerFactory();

/**
 * Estimates the projected prompt while the sampler watches, so a copy of the
 * history made by the estimator (or held by the `estimate` trap) is seen. The
 * trap's copy is dropped as soon as the estimate ends: the send that follows
 * cannot show it.
 */
async function estimateWhileSampling(
  provider: IProvider,
  projection: PromptEnvelopeProjection,
  handle: SelectionHandle,
  sampler: MemorySampler | undefined,
): Promise<void> {
  const hold =
    estimateTrap === undefined
      ? undefined
      : await armSendTrap(estimateTrap, handle.rows());
  try {
    await sampler?.sample('estimate-start');
    const state = { settled: false };
    const estimating = estimatePromptEnvelope(
      provider.name,
      projection,
      tokenizerFactory,
    ).finally(() => {
      state.settled = true;
    });
    if (sampler !== undefined) {
      while (!state.settled) await sampler.sample('estimate');
    }
    await estimating;
    await sampler?.sample('estimate-end');
  } finally {
    hold?.release();
  }
}

/**
 * The projection of the call, estimated inside the measured window. Its
 * transport token makes the send reuse the prepared body, as the agent does.
 */
async function projectAndEstimate(
  wireRoute: WireRoute,
  provider: IProvider,
  options: GenerateChatOptions,
  handle: SelectionHandle,
  sampler: MemorySampler | undefined,
): Promise<object> {
  if (provider.projectPromptEnvelope === undefined) {
    throw new Error(`${provider.name} cannot project a prompt envelope`);
  }
  await tokenizerFactory.prepareTokenizer?.(provider.name, wireRoute.model);
  const projection = await provider.projectPromptEnvelope(options);
  if (projection === undefined) {
    throw new Error(`${provider.name} projected no prompt envelope`);
  }
  try {
    await estimateWhileSampling(provider, projection, handle, sampler);
  } catch (error) {
    await projection.releaseIfUnsent?.();
    throw error;
  }
  return projection.transportToken;
}

async function send(
  wireRoute: WireRoute,
  handle: SelectionHandle,
  sampler: MemorySampler | undefined,
): Promise<BodyEvidence> {
  const evidence = emptyEvidence();
  const local = await isolatedWireHashSink(wireRoute, async () => {
    await sampler?.sample('http');
  });
  const restore = redirectToLocalHttp(local.route.baseURL);
  const observed = observeNativeRoute();
  try {
    await handle.arm();
    const provider = wireRoute.createProvider();
    const contents = {
      [Symbol.asyncIterator]: () => handle.selection.openReader(),
      openProviderRequest: async (): Promise<ProviderRequestSelection> =>
        handle.selection,
    };
    const options = {
      ...buildRouteCallOptions(
        wireRoute,
        SEND_PEAK_REQUEST_SHAPE,
        contents,
        new SettingsService(),
      ),
      ...(source === 'rows'
        ? {
            requestRows: handle.selection,
            contentCount: handle.selection.count,
          }
        : {}),
    };
    const promptEnvelopeTransportToken = plan.estimate
      ? await projectAndEstimate(wireRoute, provider, options, handle, sampler)
      : undefined;
    for await (const chunk of provider.generateChatCompletion({
      ...options,
      ...(promptEnvelopeTransportToken === undefined
        ? {}
        : { promptEnvelopeTransportToken }),
    })) {
      void chunk;
    }
    observed.requireSend(plan.estimate);
    evidence.nativeRoute = observed.counts();
    {
      const seen = await local.body();
      evidence.bytes = seen.bytes;
      evidence.sha256 = seen.sha256;
      evidence.contentLength = seen.contentLength ?? null;
      evidence.chunks = seen.chunks;
      evidence.modelRequests = seen.entries;
    }
  } finally {
    observed.restore();
    restore();
    await local.close();
  }
  if (evidence.modelRequests !== 1) {
    throw new Error(
      `expected one ${wireRoute.endpoint} request, saw ${evidence.modelRequests}`,
    );
  }
  return evidence;
}

async function awaitCodeAging(): Promise<void> {
  while (process.uptime() < CODE_AGING_DONE_SECONDS) await sleep(250);
}

async function awaitQuiescentReading(): Promise<Reading> {
  const readings: Reading[] = [];
  while (readings.length < QUIET_MAX_READINGS) {
    readings.push(await settledReading());
    const recent = readings.slice(-QUIET_READINGS).map((r) => r.heap);
    if (
      recent.length === QUIET_READINGS &&
      Math.max(...recent) - Math.min(...recent) <= SETTLED_WINDOW_BYTES
    ) {
      return readings[readings.length - 1];
    }
    await sleep(QUIET_INTERVAL_MS);
  }
  throw new Error(
    `heap never went quiet: ${readings
      .slice(-QUIET_READINGS)
      .map((r) => r.heap)
      .join(', ')}`,
  );
}

interface Measured {
  readonly measurement: SendPeakMeasurement;
  /** The quiet reading after the send, which is the next send's baseline. */
  readonly after: Reading;
}

async function measure(
  wireRoute: WireRoute,
  job: Job,
  baseline: Reading,
): Promise<Measured> {
  const sampler = new MemorySampler(baseline);
  const handle = nativeSelection(job, sampler, peakTrap);
  const cost = nativeProbeCost(job.directory);
  progress('measured-send-start', job);
  const evidence = await send(wireRoute, handle, sampler);
  const nativeCost = cost();
  progress('measured-send-complete', job);
  handle.hold()?.release();
  const after = await awaitQuiescentReading();
  progress('measured-quiet-complete', job);
  return {
    after,
    measurement: {
      routeId: wireRoute.id,
      trap: envTrap ?? null,
      ...evidence,
      nativeCost,
      ...sampler.summary(),
    },
  };
}

/** Median of a few settled readings, taken once teardown has had a moment. */
async function accumulationReading(): Promise<AccumulationReading> {
  const heaps: number[] = [];
  const arrayBuffers: number[] = [];
  for (let reading = 0; reading < ACCUMULATION_READINGS; reading++) {
    await sleep(ACCUMULATION_PAUSE_MS);
    heaps.push(await settledHeap());
    arrayBuffers.push(process.memoryUsage().arrayBuffers);
  }
  return { heap: median(heaps), arrayBuffers: median(arrayBuffers) };
}

/**
 * Sends the same history repeatedly and reads the settled memory after each
 * send. Every send must put the same bytes on the wire, so the readings
 * compare like with like.
 */
async function accumulate(
  wireRoute: WireRoute,
  job: Job,
): Promise<AccumulationReading[]> {
  const readings: AccumulationReading[] = [];
  let sha256: string | undefined;
  for (let sent = 0; sent < SEND_PEAK_ACCUMULATION_SENDS; sent++) {
    progress('accumulation-send-start', job);
    const evidence = await send(
      wireRoute,
      nativeSelection(job, undefined, accumulationTrap),
      undefined,
    );
    if (process.env.SEND_PEAK_LOG !== undefined)
      appendFileSync(
        `${process.env.SEND_PEAK_LOG}.accumulation.jsonl`,
        `${JSON.stringify({ sent, ...evidence })}\n`,
      );
    sha256 ??= evidence.sha256;
    if (evidence.sha256 !== sha256) {
      throw new Error('accumulation sends put different bytes on the wire');
    }
    readings.push(await accumulationReading());
    progress('accumulation-send-complete', job);
  }
  return readings;
}

function jobFor(shape: string, size: 'small' | 'large', count: number): Job {
  return { directory: join(root, shape, size), count };
}

async function measureShape(
  wireRoute: WireRoute,
  shape: string,
  counts: ShapeCounts,
): Promise<SendPeakSeries> {
  const jobs = {
    small: jobFor(shape, 'small', counts.small),
    large: jobFor(shape, 'large', counts.large),
  };
  if (plan.protocol === 'original-three-pair') {
    await send(
      wireRoute,
      nativeSelection(jobs.small, undefined, undefined),
      undefined,
    );
  } else {
    for (const size of ['small', 'large'] as const) {
      const cost = nativeProbeCost(jobs[size].directory);
      const evidence = await send(
        wireRoute,
        nativeSelection(jobs[size], undefined, undefined),
        undefined,
      );
      const measuredCost = cost();
      if (process.env.SEND_PEAK_LOG !== undefined)
        appendFileSync(
          `${process.env.SEND_PEAK_LOG}.cold.jsonl`,
          `${JSON.stringify({ phase: 'cold-format-estimate-send', shape, size, ...measuredCost, ...evidence })}\n`,
        );
    }
  }
  progress('warmup-complete', jobs.small);
  let baseline = await awaitQuiescentReading();
  progress('initial-baseline-complete', jobs.small);
  const series: { small: SendPeakMeasurement[]; large: SendPeakMeasurement[] } =
    { small: [], large: [] };
  for (let round = 0; round < plan.rounds; round++) {
    for (const size of ['small', 'large'] as const) {
      const { measurement, after } = await measure(
        wireRoute,
        jobs[size],
        baseline,
      );
      series[size].push(measurement);
      if (process.env.SEND_PEAK_LOG !== undefined)
        appendFileSync(
          `${process.env.SEND_PEAK_LOG}.pairs.jsonl`,
          `${JSON.stringify({ shape, round, size, measurement })}
`,
        );
      baseline = after;
    }
  }
  return { ...series, accumulation: await accumulate(wireRoute, jobs.large) };
}

progress('source-preparation-start');
const nativeSources = await prepareNativeProbeSources(root, plan);
progress('source-preparation-complete');
await awaitCodeAging();
const results: Record<string, SendPeakSeries> = {};
for (const [shape, counts] of Object.entries(plan.shapes)) {
  results[shape] = await measureShape(route, shape, counts);
}
writeFileSync(join(root, 'measured.json'), JSON.stringify(results));
await nativeSources.close();
clearTimeout(deadline);
