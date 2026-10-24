/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  callerOwnedAnthropicEngine,
  callerOwnedAnthropicCache,
} from './caller-owned-anthropic.js';
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { readAnthropicMediaLedger } from './anthropic-media-ledger.js';
import { unsupportedMediaOfRow } from '../utils/mediaUtils.js';
import { createMediaSupportPredicate } from './AnthropicEndpointUtils.js';
import { measurableAnthropicRow } from './anthropic-measured-media.js';

import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { RepairPolicy } from './anthropic-repair-source.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { ProgressiveJsonBody } from '../utils/progressive-json-body.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import { planAnthropicImageRecovery } from './native-anthropic-recovery.js';
import {
  DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  envelopeTooLargeError,
} from '../utils/boundedJsonBody.js';
import { StreamedSegment, writeEnvelope } from '../utils/envelope-writer.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { wantsRequestDump } from '../utils/dumpContext.js';
import type { StreamedDumpBody } from '../utils/dumpSDKContext.js';
import {
  NativeDumpBody,
  nativeDumpLiteral,
  nativeDumpValue,
  nativeDumpEnvelope,
} from '../utils/native-dump-body.js';
import {
  buildRequestEnvelope,
  planAnthropicRequest,
  requestFactsOf,
  placeSystemInstruction,
  type AnthropicPlanParams,
  type AnthropicRequestPlan,
  type AnthropicRequestFacts,
} from './AnthropicRequestPreparation.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
  type StoredAnthropicRequestPlan,
} from './journal-anthropic-length.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import {
  AnthropicRepairIndex,
  anthropicRepairScope,
} from './anthropic-repair-index.js';
import {
  prepareSpooledAnthropicRequest,
  type SpooledAnthropicRequest,
  type SpooledRequestOptions,
} from './AnthropicSpooledRequest.js';
import type { MediaStage } from './message-table/wire-builder.js';
import { NativeAnthropicEstimateProjection } from './native-anthropic-estimate.js';

import { AnthropicRepairSource } from './anthropic-repair-source.js';
import { AnthropicSpanPlan } from './anthropic-span-plan.js';
import { AnthropicDecisionOverlay } from './anthropic-decision-overlay.js';
import { measureAnthropicSpans } from './anthropic-span-measure.js';

export class NativeAnthropicBody {
  private readonly body: ProgressiveJsonBody;
  constructor(
    bytes: () => AsyncIterable<Uint8Array>,
    readonly byteLength: number,
  ) {
    if (byteLength > DEFAULT_HTTP_JSON_ENVELOPE_BYTES)
      throw envelopeTooLargeError(DEFAULT_HTTP_JSON_ENVELOPE_BYTES, byteLength);
    this.body = new ProgressiveJsonBody(bytes, byteLength);
  }
  openStream(): ReturnType<ProgressiveJsonBody['createStreamHandle']> {
    return this.body.createStreamHandle();
  }
  dispose(): Promise<void> {
    return this.body.dispose();
  }
}

export interface NativeAnthropicRequest {
  readonly facts: AnthropicRequestFacts;
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly spool: NativeAnthropicBody;
  readonly estimate:
    | {
        readonly projection: NativeAnthropicEstimateProjection;
        readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
        discard(): void;
      }
    | undefined;
  readonly dump: StreamedDumpBody | undefined;
  readonly recoveredImages: number;
  release(): Promise<void>;
}
export type PreparedAnthropicRequest =
  | SpooledAnthropicRequest
  | NativeAnthropicRequest;

function nativeSettings(
  params: AnthropicPlanParams,
  plan: AnthropicRequestPlan,
): RowFormatSettings {
  return {
    formatId: 'anthropic',
    formatRev: 1,
    model: plan.requestSettings.currentModel,
    endpoint: plan.conversion.currentBaseURL ?? '',
    isOAuth: params.isOAuth,
    toolNameTransform: params.isOAuth ? 'oauth' : 'none',
    supportsUrlImages: plan.conversion.supportsUrlImages ?? true,
    reasoningEnabled: plan.conversion.reasoningEnabled,
    reasoningFieldName: 'reasoning_content',
    mediaPdfEnabled: true,
    unsupportedMedia: 'notice',
    outputLimits: plan.conversion.config ?? null,
    anthropic: {
      cache: 'off',
      cacheFacts: true,
      imageBudget:
        plan.imageBudget === undefined
          ? null
          : {
              ...(plan.imageBudget.maxDimension === undefined
                ? {}
                : { maxDimension: plan.imageBudget.maxDimension }),
              ...(plan.imageBudget.maxPixels === undefined
                ? {}
                : { maxPixels: plan.imageBudget.maxPixels }),
            },
    },
  };
}

async function envelopeParts(
  envelope: Readonly<Record<string, unknown>>,
): Promise<{ head: Buffer; tail: Buffer }> {
  const head: Uint8Array[] = [];
  const tail: Uint8Array[] = [];
  let after = false;
  await writeEnvelope(
    {
      append(data) {
        (after ? tail : head).push(
          typeof data === 'string' ? Buffer.from(data) : data,
        );
      },
    },
    {
      ...envelope,
      messages: new StreamedSegment(() => {
        after = true;
      }),
    },
  );
  return { head: Buffer.concat(head), tail: Buffer.concat(tail) };
}

async function releaseNativeRequest(
  body: NativeAnthropicBody,
  projection: NativeAnthropicEstimateProjection | undefined,
  query: Pick<IndexedJournalRequestSnapshot, 'close'>,
  capture: NativeDumpBody,
): Promise<void> {
  try {
    await body.dispose();
    await capture.dispose();
  } finally {
    try {
      await projection?.dispose();
    } finally {
      await query.close();
    }
  }
}

async function requestFromEngine(
  params: AnthropicPlanParams,
  plan: AnthropicRequestPlan,
  envelope: Readonly<Record<string, unknown>>,
  query: Pick<IndexedJournalRequestSnapshot, 'close'>,
  engine: Pick<AnthropicStreamRepair, 'serialize' | 'wirePieces'>,
  measured: StoredAnthropicRequestPlan,
  estimate: boolean,
  mediaStage: MediaStage | undefined,
  unsupportedMedia: readonly UnsupportedMediaEntry[],
  recoveryBudget: ImageDimensionBudget | undefined,
  recoveredImages: number,
): Promise<NativeAnthropicRequest> {
  const signal = getRequestSignal(params.options);
  const prefix = placeSystemInstruction({
    placement: params.placement,
    anthropicMessages: [],
    wantCaching: plan.wantCaching,
    ttl: plan.requestSettings.ttl,
    cacheLogger: params.cacheLogger,
    systemInstruction: params.options.systemInstruction,
  }).find((_message, index) => index === 0);
  const prefixBytes =
    prefix === undefined ? 0 : Buffer.byteLength(JSON.stringify(prefix)) + 1;
  const length = measured.contentLength + prefixBytes;
  if (length > DEFAULT_HTTP_JSON_ENVELOPE_BYTES)
    throw envelopeTooLargeError(DEFAULT_HTTP_JSON_ENVELOPE_BYTES, length);
  const parts = await envelopeParts(envelope);
  const dumped = await envelopeParts(nativeDumpEnvelope(envelope));
  const capture = new NativeDumpBody(async function* () {
    signal?.throwIfAborted();
    yield nativeDumpLiteral(parts.head, dumped.head);
    for await (const piece of engine.wirePieces(
      prefix,
      measured.cache,
      mediaStage,
      recoveryBudget,
    )) {
      signal?.throwIfAborted();
      if (typeof piece === 'string') yield nativeDumpLiteral(piece);
      else yield* nativeDumpValue(piece);
    }
    yield nativeDumpLiteral(parts.tail, dumped.tail);
  });
  const body = new NativeAnthropicBody(() => capture.stream(), length);
  const projection = estimate
    ? new NativeAnthropicEstimateProjection(
        engine,
        envelope,
        signal,
        prefix,
        measured.cache,
      )
    : undefined;
  return {
    facts: requestFactsOf(plan, params.cacheLogger, undefined),
    envelope,
    spool: body,
    estimate:
      projection === undefined
        ? undefined
        : {
            projection,
            unsupportedMedia,
            discard: () => {
              void projection.dispose();
            },
          },
    dump: wantsRequestDump(params.options.invocation.ephemerals.dumpcontext)
      ? capture.dump
      : undefined,
    recoveredImages,
    release: () => releaseNativeRequest(body, projection, query, capture),
  };
}

async function nativeEnginePlan(
  snapshot: VersionSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  policy: RepairPolicy,
  base: StoredAnthropicRequestPlan,
  changed: boolean,
): Promise<{
  readonly engine: AnthropicStreamRepair;
  readonly measured: StoredAnthropicRequestPlan;
  readonly release?: () => void | Promise<void>;
  readonly spans?: AnthropicSpanPlan;
}> {
  const index = await AnthropicRepairIndex.read(
    await snapshot.nativeFacts(anthropicRepairScope(settings)),
  );
  if (!changed)
    return {
      engine: await AnthropicStreamRepair.create(
        query,
        settings,
        policy,
        index,
      ),
      measured: base,
    };
  const persisted = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    const spans = new AnthropicSpanPlan(
      snapshot,
      query,
      persisted,
      index,
      new AnthropicRepairSource(query, settings),
    );
    await spans.prepare();
    if (base.cache !== undefined) await spans.prepareCache();
    const overlay = new AnthropicDecisionOverlay(spans);
    await overlay.prepare();
    spans.affected = (id, at, kind) => overlay.affected(id, at, kind);
    const engine = await AnthropicStreamRepair.create(
      query,
      settings,
      policy,
      overlay,
    );
    const measured = await measureAnthropicSpans(spans, engine, base);
    return { engine, measured, spans, release: () => persisted.close() };
  } catch (error) {
    await persisted.close();
    throw error;
  }
}

async function requestFromStored(
  params: AnthropicPlanParams,
  plan: AnthropicRequestPlan,
  envelope: Readonly<Record<string, unknown>>,
  snapshot: VersionSnapshot,
  engine: AnthropicStreamRepair,
  measured: StoredAnthropicRequestPlan,
  options: SpooledRequestOptions,
  mediaStage: MediaStage | undefined,
  spans?: AnthropicSpanPlan,
): Promise<NativeAnthropicRequest> {
  const query = engine.source.query;
  const settings = measured.settings;
  const recovery = await planAnthropicImageRecovery(
    snapshot,
    engine,
    measured,
    options.recoveryBudget,
    spans,
  );
  const unsupportedMedia =
    options.estimate === true
      ? await readAnthropicMediaLedger(
          query,
          await snapshot.nativeFacts(anthropicRepairScope(settings)),
          settings,
        )
      : [];
  return requestFromEngine(
    params,
    plan,
    envelope,
    query,
    engine,
    {
      ...measured,
      contentLength: measured.contentLength + recovery.bytes,
      messagesBytes: measured.messagesBytes + recovery.bytes,
    },
    options.estimate === true,
    mediaStage,
    unsupportedMedia,
    options.recoveryBudget,
    recovery.replaced,
  );
}

async function prepareNativeAnthropicRequest(
  params: AnthropicPlanParams,
  rows: ProviderRequestRows,
  estimate: boolean,
  mediaStage: MediaStage | undefined,
  options: SpooledRequestOptions,
): Promise<PreparedAnthropicRequest> {
  const native = rows.native;
  if (native === undefined)
    throw new Error('Native Anthropic requires journal rows');
  const plan = planAnthropicRequest(params);
  const settings = nativeSettings(params, plan);
  const envelope = buildRequestEnvelope(plan, params);
  const { messages: _messages, ...small } = envelope;
  const policy = {
    strip: plan.reasoningSettings.stripFromContext,
    includeInContext: plan.reasoningSettings.includeInContext,
  };
  return native.withFormat(
    anthropicLengthRegistration(settings),
    async (snapshot) => {
      const changed = native.indexed.viewPlan.changedSources.length !== 0;
      const query = native.indexed.retain(snapshot);
      try {
        const base = await planStoredAnthropicRequest(
          snapshot,
          settings,
          policy,
          { ...small, model: settings.model },
          { cache: plan.wantCaching ? plan.requestSettings.ttl : undefined },
        );
        const { engine, measured, release, spans } = await nativeEnginePlan(
          snapshot,
          query,
          settings,
          policy,
          base,
          changed,
        );
        try {
          const request = await requestFromStored(
            params,
            plan,
            envelope,
            snapshot,
            engine,
            measured,
            { ...options, estimate },
            mediaStage,
            spans,
          );
          return {
            ...request,
            async release() {
              try {
                await request.release();
              } finally {
                await release?.();
              }
            },
          };
        } catch (error) {
          await release?.();
          throw error;
        }
      } catch (error) {
        await query.close();
        throw error;
      }
    },
  );
}

async function prepareCallerOwnedAnthropic(
  params: AnthropicPlanParams,
  rows: ProviderRequestRows,
  mediaStage: MediaStage | undefined,
  options: SpooledRequestOptions,
): Promise<NativeAnthropicRequest> {
  const plan = planAnthropicRequest(params);
  const settings = nativeSettings(params, plan);
  const envelope = buildRequestEnvelope(plan, params);
  const engine = await callerOwnedAnthropicEngine(rows, settings, {
    strip: plan.reasoningSettings.stripFromContext,
    includeInContext: plan.reasoningSettings.includeInContext,
  });
  const cache = plan.wantCaching
    ? await callerOwnedAnthropicCache(
        engine,
        settings,
        plan.requestSettings.ttl,
      )
    : undefined;
  let bytes = 0;
  for await (const piece of engine.serialize(
    (value) => value,
    undefined,
    cache,
    mediaStage,
    options.recoveryBudget,
  ))
    bytes += Buffer.byteLength(piece);
  const parts = await envelopeParts(envelope);
  const unsupportedMedia: UnsupportedMediaEntry[] = [];
  if (options.estimate === true) {
    const supports = createMediaSupportPredicate(settings.endpoint);
    for await (const row of rows.openReader(getRequestSignal(params.options)))
      unsupportedMedia.push(
        ...unsupportedMediaOfRow(measurableAnthropicRow(row), supports),
      );
  }
  return requestFromEngine(
    params,
    plan,
    envelope,
    { close: () => undefined },
    engine,
    {
      contentLength: parts.head.length + bytes + parts.tail.length,
      messagesBytes: bytes,
      messages: 0,
      key: 0n,
      generation: 0,
      settings,
      cache,
    },
    options.estimate === true,
    mediaStage,
    unsupportedMedia,
    options.recoveryBudget,
    0,
  );
}

export async function prepareAnthropicRequestRows(
  params: AnthropicPlanParams,
  rows: ProviderRequestRows,
  mediaStage: MediaStage | undefined,
  options: SpooledRequestOptions = {},
): Promise<PreparedAnthropicRequest> {
  if (rows.callerOwned === true)
    return prepareCallerOwnedAnthropic(params, rows, mediaStage, options);
  if (rows.native !== undefined)
    return prepareNativeAnthropicRequest(
      params,
      rows,
      options.estimate === true,
      mediaStage,
      options,
    );
  return prepareSpooledAnthropicRequest(params, rows, mediaStage, options);
}

export async function registerAnthropicRequestCleanup(
  media: ResolvedMediaRequest,
  request: PreparedAnthropicRequest,
): Promise<void> {
  try {
    media.registerCleanup(() => request.release());
    const projection = request.estimate?.projection;
    if (projection !== undefined)
      media.registerCleanup(() => projection.dispose());
  } catch (error) {
    await request.release();
    throw error;
  }
}
