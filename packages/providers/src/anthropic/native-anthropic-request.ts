/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { RepairPolicy } from './anthropic-repair-source.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { ProgressiveJsonBody } from '../utils/progressive-json-body.js';
import {
  DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  envelopeTooLargeError,
} from '../utils/boundedJsonBody.js';
import { StreamedSegment, writeEnvelope } from '../utils/envelope-writer.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { wantsRequestDump } from '../utils/dumpContext.js';
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

import {
  anthropicTailIndex,
  planAnthropicTail,
} from './anthropic-tail-plan.js';
import {
  supportsAnthropicPendingTail,
  anthropicPendingPrefix,
} from './anthropic-pending-tail.js';

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
        readonly unsupportedMedia: readonly [];
        discard(): void;
      }
    | undefined;
  readonly dump: undefined;
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
      imageBudget: plan.imageBudget ?? null,
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
  query: IndexedJournalRequestSnapshot,
): Promise<void> {
  try {
    await body.dispose();
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
  query: IndexedJournalRequestSnapshot,
  engine: AnthropicStreamRepair,
  measured: StoredAnthropicRequestPlan,
  estimate: boolean,
  mediaStage: MediaStage | undefined,
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
  const body = new NativeAnthropicBody(async function* () {
    signal?.throwIfAborted();
    yield parts.head;
    for await (const piece of engine.serialize(
      undefined,
      prefix,
      measured.cache,
      mediaStage,
    )) {
      signal?.throwIfAborted();
      yield Buffer.from(piece);
    }
    yield parts.tail;
  }, length);
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
            unsupportedMedia: [],
            discard: () => {
              void projection.dispose();
            },
          },
    dump: undefined,
    recoveredImages: 0,
    release: () => releaseNativeRequest(body, projection, query),
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
}> {
  const engine = await AnthropicStreamRepair.create(
    query,
    settings,
    policy,
    changed
      ? await anthropicTailIndex(snapshot, query, settings)
      : await AnthropicRepairIndex.read(
          await snapshot.nativeFacts(anthropicRepairScope(settings)),
        ),
  );
  if (!changed) return { engine, measured: base };
  const prefix = await anthropicPendingPrefix(
    snapshot,
    query,
    settings,
    policy,
    engine,
  );
  const measured = await planAnthropicTail(
    snapshot,
    query,
    settings,
    policy,
    base,
    prefix,
  );
  return { engine, measured };
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
        if (
          changed &&
          !(await supportsAnthropicPendingTail(snapshot, query, settings))
        ) {
          await query.close();
          return await prepareSpooledAnthropicRequest(
            params,
            rows,
            mediaStage,
            options,
          );
        }
        const { engine, measured } = await nativeEnginePlan(
          snapshot,
          query,
          settings,
          policy,
          base,
          changed,
        );
        return await requestFromEngine(
          params,
          plan,
          envelope,
          query,
          engine,
          measured,
          estimate,
          mediaStage,
        );
      } catch (error) {
        await query.close();
        throw error;
      }
    },
  );
}

async function canUseNativeAnthropic(
  params: AnthropicPlanParams,
  rows: ProviderRequestRows,
  options: SpooledRequestOptions,
): Promise<boolean> {
  const native = rows.native;
  if (native === undefined) return false;
  if (wantsRequestDump(params.options.invocation.ephemerals.dumpcontext))
    return false;
  return (
    (options.recoveryBudget === undefined &&
      options.estimate !== true &&
      planAnthropicRequest(params).imageBudget === undefined) ||
    !(await native.indexed.hasPersistedMedia())
  );
}

export async function prepareAnthropicRequestRows(
  params: AnthropicPlanParams,
  rows: ProviderRequestRows,
  mediaStage: MediaStage | undefined,
  options: SpooledRequestOptions = {},
): Promise<PreparedAnthropicRequest> {
  if (await canUseNativeAnthropic(params, rows, options))
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
