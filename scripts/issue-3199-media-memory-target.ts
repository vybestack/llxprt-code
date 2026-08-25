/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { Storage } from '@vybestack/llxprt-code-settings';
import { SessionRecordingService } from '../packages/core/src/recording/SessionRecordingService.js';
import { HistoryService } from '../packages/core/src/services/history/HistoryService.js';
import type { IContent } from '../packages/core/src/services/history/IContent.js';
import { SessionPersistenceService } from '../packages/core/src/storage/SessionPersistenceService.js';
import { HistoryMediaOwnership } from '../packages/core/src/storage/history-media-ownership.js';
import { LocalMediaStore } from '../packages/core/src/storage/local-media-store.js';
import { MediaAdmissionService } from '../packages/core/src/storage/media-admission-service.js';
import { MediaLifecycleMetrics } from '../packages/core/src/storage/media-lifecycle-metrics.js';
import { RequestMediaResolver } from '../packages/core/src/storage/request-media-resolver.js';
import { ProviderFileLifecycle } from '../packages/providers/src/providerFilePolicy.js';
import { BoundedJsonBody } from '../packages/providers/src/utils/boundedJsonBody.js';
import {
  evaluateMediaProbePlateaus,
  mediaProbeImageBytes,
  MIN_MEDIA_PROBE_TURNS,
  type MediaProbeBounds,
  type MediaProbeTurnSample,
} from './issue-3199-media-memory-benchmark.js';
import {
  admittedMediaContentId,
  cleanupMediaProbeResources,
  completeTurnResources,
  type MediaProbeResources,
  settleOperation,
} from './issue-3199-media-memory-lifecycle.js';

const IMAGE_BYTES = 512 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
const REQUEST_BUDGET_BYTES = 8 * 1024 * 1024;
const ENVELOPE_BUDGET_BYTES = 64 * 1024 * 1024;
const QUEUE_BUDGET_BYTES = 8 * 1024 * 1024;

const [, , outputPath, turnArgument = '6'] = process.argv;
if (outputPath === undefined) {
  throw new Error(
    'Usage: issue-3199-media-memory-target.ts OUTPUT_PATH [turns]',
  );
}
const turns = Number.parseInt(turnArgument, 10);
if (!Number.isInteger(turns) || turns < MIN_MEDIA_PROBE_TURNS) {
  throw new Error(
    `Media memory target needs at least ${MIN_MEDIA_PROBE_TURNS} turns`,
  );
}

// The store retains one unique object per turn, so its quota must hold every turn
// of the probe with one image of headroom. Unique local blobs are expected spool
// growth, never a process-memory leak; the evaluator proves the quota holds.
const storeQuotaBytes = IMAGE_BYTES * (turns + 1);
const probeBounds: MediaProbeBounds = {
  storeQuotaBytes,
  requestBudgetBytes: REQUEST_BUDGET_BYTES,
  recordingQueueBytes: QUEUE_BUDGET_BYTES,
  persistenceQueueBytes: QUEUE_BUDGET_BYTES,
  providerFileMaxFiles: 1,
  providerFileMaxBytes: IMAGE_BYTES,
};

function runtimeName(): 'bun' | 'node' {
  return typeof Bun === 'undefined' ? 'node' : 'bun';
}

function inlineImage(encoded: string, turn: number): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `Equivalent image-heavy probe turn ${turn}` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: encoded,
      },
    ],
    metadata: { turnId: `media-probe-${turn}` },
  };
}

async function consumeTransport(body: BoundedJsonBody): Promise<number> {
  const reader = body.createStream().getReader();
  let consumed = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    consumed += next.value.byteLength;
  }
  if (consumed !== body.byteLength) {
    throw new Error(
      `Transport consumed ${consumed} bytes but planned ${body.byteLength}`,
    );
  }
  const accounting = body.accounting();
  if (
    accounting.activeStreamCount !== 0 ||
    accounting.activeChunkBytes !== 0 ||
    accounting.highWaterChunkBytes > STREAM_CHUNK_BYTES
  ) {
    throw new Error(
      'Transport-like consumption did not release bounded chunks',
    );
  }
  return consumed;
}
async function forceFullGc(): Promise<void> {
  if (typeof Bun !== 'undefined') {
    Bun.gc(true);
  } else {
    if (typeof global.gc !== 'function') {
      throw new Error('Node media memory target requires --expose-gc');
    }
    global.gc();
  }
  await delay(0);
  if (typeof Bun !== 'undefined') Bun.gc(true);
  else global.gc?.();
}

interface MediaProbeRuntime {
  readonly admission: MediaAdmissionService;
  readonly store: LocalMediaStore;
  readonly history: HistoryService;
  readonly providerRetention: ProviderFileLifecycle;
  readonly resolver: RequestMediaResolver;
  readonly recording: SessionRecordingService;
  readonly persistence: SessionPersistenceService;
  readonly metrics: MediaLifecycleMetrics;
}

interface ActiveTurnMeasurements {
  readonly active: MediaProbeTurnSample['active'];
  readonly transportBytes: number;
}

async function measureActiveTurn(
  runtime: MediaProbeRuntime,
  admitted: IContent,
  resolved: Awaited<ReturnType<RequestMediaResolver['resolve']>>,
): Promise<ActiveTurnMeasurements> {
  let turnFailure: unknown;
  let active: MediaProbeTurnSample['active'] | undefined;
  let transportBytes: number | undefined;
  const persistenceSave = settleOperation(() =>
    runtime.persistence.save(runtime.history.getAll()),
  );
  try {
    runtime.recording.recordContent(admitted);
    active = await runtime.metrics.snapshot();
    const body = resolved.withContents(
      (contents) =>
        new BoundedJsonBody(
          { model: 'probe', messages: contents, stream: true },
          {
            maxChunkBytes: STREAM_CHUNK_BYTES,
            maxEnvelopeBytes: ENVELOPE_BUDGET_BYTES,
          },
        ),
    );
    transportBytes = await consumeTransport(body);
  } catch (error) {
    turnFailure = error;
  } finally {
    turnFailure = await completeTurnResources(
      persistenceSave,
      resolved.release,
      turnFailure,
    );
  }
  if (turnFailure !== undefined) throw turnFailure;
  if (active === undefined || transportBytes === undefined) {
    throw new Error('Media probe turn completed without measurements');
  }
  return { active, transportBytes };
}

async function collectTurnSample(
  runtime: MediaProbeRuntime,
  turn: number,
  priorSamples: readonly MediaProbeTurnSample[],
): Promise<MediaProbeTurnSample> {
  const encoded = Buffer.from(mediaProbeImageBytes(turn, IMAGE_BYTES)).toString(
    'base64',
  );
  const admitted = await runtime.admission.admitContent(
    inlineImage(encoded, turn),
    {
      turnId: `media-probe-${turn}`,
      source: 'media-memory-probe',
    },
  );
  await runtime.history.replaceAll([admitted]);
  const contentId = admittedMediaContentId(admitted, turn);
  const resolved = await runtime.resolver.resolve({
    contents: runtime.history.getRawHistory(),
    requestId: `media-probe-request-${turn}`,
    turnId: `media-probe-${turn}`,
    aggregateBudgetBytes: REQUEST_BUDGET_BYTES,
  });
  const measured = await measureActiveTurn(runtime, admitted, resolved);
  await runtime.recording.flush();
  await forceFullGc();
  const settled = await runtime.metrics.snapshot();
  const resolution = runtime.resolver.accounting();
  const supersededReservationStates = await Promise.all(
    priorSamples.map((sample) =>
      runtime.store.hasReservations(sample.contentId),
    ),
  );
  return {
    turn,
    contentId,
    uniqueContentCount: priorSamples.length + 1,
    ...measured,
    settled,
    settledActiveRequestCount: resolution.activeRequestCount,
    settledReservedContentCount: resolution.reservedContentCount,
    settledPendingReleaseCount: runtime.resolver.pendingReleaseCount(),
    settledStoreReadCount: resolution.storeReadCount,
    settledProviderFileCount:
      runtime.providerRetention.snapshot().retainedFiles,
    settledHistoryContentCount: runtime.history.getAll().length,
    settledSupersededHistoryOwnerCount:
      supersededReservationStates.filter(Boolean).length,
    bounds: probeBounds,
  };
}

async function collectSamples(
  runtime: MediaProbeRuntime,
  turnCount: number,
): Promise<MediaProbeTurnSample[]> {
  const samples: MediaProbeTurnSample[] = [];
  for (let turn = 1; turn <= turnCount; turn += 1) {
    samples.push(await collectTurnSample(runtime, turn, samples));
  }
  return samples;
}

const directory = await mkdtemp(join(tmpdir(), 'llxprt-media-probe-'));
const resources: MediaProbeResources = { directory };
let reportFailure: unknown;

try {
  const store = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: storeQuotaBytes,
  });
  resources.store = store;
  const history = new HistoryService();
  history.registerMediaOwner(new HistoryMediaOwnership(store));
  resources.history = history;
  const admission = new MediaAdmissionService(store);
  const resolver = new RequestMediaResolver(store);
  resources.resolver = resolver;
  const recording = new SessionRecordingService({
    sessionId: `media-probe-${runtimeName()}`,
    projectHash: 'media-probe',
    chatsDir: join(directory, 'recording'),
    workspaceDirs: [directory],
    provider: 'probe',
    model: 'probe',
    maxQueueBytes: QUEUE_BUDGET_BYTES,
    mediaStore: store,
  });
  resources.recording = recording;
  const persistence = new SessionPersistenceService(
    new Storage(directory),
    `media-probe-${runtimeName()}`,
    { mediaStore: store, maxQueueBytes: QUEUE_BUDGET_BYTES },
  );
  resources.persistence = persistence;
  const providerRetention = new ProviderFileLifecycle({
    maxFiles: 1,
    maxBytes: IMAGE_BYTES,
  });
  resources.providerRetention = providerRetention;
  const retainedProviderFile = await providerRetention.retain({
    cacheKey: 'media-probe-cache',
    fileId: 'media-probe-file',
    bytes: IMAGE_BYTES,
    identity: {
      provider: 'probe',
      baseURL: 'https://probe.invalid',
      credentialHash: 'media-probe-credential',
    },
    policy: {
      mode: 'enabled',
      scope: 'session',
      retentionMs: 60_000,
      deletion: 'retain',
      zeroDataRetention: 'incompatible-while-retained',
    },
    scopeId: 'media-probe-session',
    deleteRemote: async () => {},
  });
  await retainedProviderFile.lease.release();
  const metrics = new MediaLifecycleMetrics({
    store,
    history,
    requestResolver: resolver,
    recording,
    persistence,
    providerFileRetention: providerRetention,
  });
  const samples = await collectSamples(
    {
      admission,
      store,
      history,
      providerRetention,
      resolver,
      recording,
      persistence,
      metrics,
    },
    turns,
  );
  const plateau = evaluateMediaProbePlateaus(samples);
  const contentIds = samples.map((sample) => sample.contentId);
  const report = {
    issue: 3199,
    runtime: runtimeName(),
    pid: process.pid,
    warmupExcluded: true,
    uniqueContentCount: new Set(contentIds).size,
    contentIds,
    samples,
    plateau,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!plateau.overallWithinTolerance) {
    const failedMetrics = plateau.metrics
      .filter((metric) => !metric.withinTolerance)
      .map((metric) => metric.name)
      .join(', ');
    throw new Error(`Media memory plateau failed: ${failedMetrics}`);
  }
} catch (error) {
  reportFailure = error;
} finally {
  reportFailure = await cleanupMediaProbeResources(resources, reportFailure);
}

if (reportFailure !== undefined) throw reportFailure;
