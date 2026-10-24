/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  SemanticMediaPurgeCacheWriteEvidence,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { inMemoryRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import {
  convertToAnthropicMessages,
  type AnthropicConversationConversionOptions,
} from '../../../AnthropicMessageNormalizer.js';
import { sanitizeAnthropicContentImages } from '../../../AnthropicImageSanitizer.js';
import {
  applyRequestCacheControls,
  placeSystemInstruction,
} from '../../../AnthropicRequestPreparation.js';
import { unprefixAnthropicToolName } from '../../../schemaConverter.js';
import { selectLastCacheableBlockIndex } from '../../../AnthropicRequestBuilder.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { MediaStage } from '../../../native-anthropic-media-stage.js';
import {
  callerOwnedAnthropicEngine,
  callerOwnedAnthropicCache,
  callerOwnedPurgeCache,
} from '../../../caller-owned-anthropic.js';

export type StripPolicy = 'none' | 'all' | 'allButLast';

export interface WireSettings {
  readonly reasoningEnabled: boolean;
  readonly strip?: StripPolicy;
  readonly includeInContext?: boolean;
  readonly currentModel?: string;
  readonly currentBaseURL?: string;
  readonly supportsUrlImages?: boolean;
  readonly isOAuth?: boolean;
  readonly imageBudget?: ImageDimensionBudget;
}

const logger = { debug: (): void => undefined };

export function conversionOptions(
  settings: WireSettings,
): AnthropicConversationConversionOptions {
  return {
    isOAuth: settings.isOAuth ?? false,
    stripFromContext: settings.strip,
    includeInContext: settings.includeInContext,
    reasoningEnabled: settings.reasoningEnabled,
    config: undefined,
    currentModel: settings.currentModel,
    currentBaseURL: settings.currentBaseURL,
    supportsUrlImages: settings.supportsUrlImages,
    unprefixToolName: unprefixAnthropicToolName,
    logger,
  };
}

/**
 * Today's route: the proactive image sanitizer, then `convertToAnthropicMessages`
 * with its validators. The result carries no `cache_control`: the converter
 * only leaves symbol tags on its messages, which JSON does not show.
 */
export function oracleJson(
  rows: readonly IContent[],
  settings: WireSettings,
): string {
  const sanitized = sanitizeAnthropicContentImages(
    structuredClone([...rows]),
    settings.imageBudget,
  ).contents;
  return JSON.stringify(
    convertToAnthropicMessages(sanitized, conversionOptions(settings)),
  );
}

export interface WireExtras {
  readonly mediaStage?: MediaStage;
  readonly signal?: AbortSignal;
}

export function nativeSettings(settings: WireSettings): RowFormatSettings {
  return {
    formatId: 'anthropic',
    formatRev: 1,
    model: settings.currentModel ?? '',
    endpoint: settings.currentBaseURL ?? '',
    isOAuth: settings.isOAuth ?? false,
    toolNameTransform: settings.isOAuth === true ? 'oauth' : 'none',
    supportsUrlImages: settings.supportsUrlImages ?? true,
    reasoningEnabled: settings.reasoningEnabled,
    reasoningFieldName: 'reasoning_content',
    mediaPdfEnabled: true,
    unsupportedMedia: 'notice',
    outputLimits: null,
    anthropic: { cache: 'off', imageBudget: settings.imageBudget ?? null },
  };
}

export async function renderNativeRows(
  rows: ProviderRequestRows,
  settings: WireSettings,
  extra: WireExtras = {},
): Promise<string> {
  extra.signal?.throwIfAborted();
  const engine = await callerOwnedAnthropicEngine(
    { ...rows, callerOwned: true },
    nativeSettings(settings),
    { strip: settings.strip, includeInContext: settings.includeInContext },
    true,
  );
  let json = '';
  for await (const chunk of engine.serialize(
    undefined,
    undefined,
    undefined,
    extra.mediaStage,
    settings.imageBudget,
  )) {
    extra.signal?.throwIfAborted();
    json += chunk;
  }
  return json;
}

/** Prompt caching and system placement, as the request preparation resolves them. */
export interface CacheSettings {
  /** Prompt caching is on when this is set. */
  readonly ttl?: '5m' | '1h';
  /** The semantic media purge mode asks for a boundary breakpoint. */
  readonly mediaPurge?: boolean;
  /** The system instruction, placed at the top of the context when set. */
  readonly contextPrefix?: string;
}

export interface CachedWire {
  readonly json: string;
  readonly evidence: SemanticMediaPurgeCacheWriteEvidence | undefined;
}

/**
 * Today's route end to end: the proactive image sanitizer, then
 * `convertToAnthropicMessages`, then the request preparation's own system
 * placement and cache controls on the message array.
 */
export function cachedOracle(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings,
): CachedWire {
  const sanitized = sanitizeAnthropicContentImages(
    structuredClone([...rows]),
    settings.imageBudget,
  ).contents;
  const converted = convertToAnthropicMessages(
    sanitized,
    conversionOptions(settings),
  );
  const wantCaching = cache.ttl !== undefined;
  const ttl = cache.ttl ?? '5m';
  const messages = placeSystemInstruction({
    placement:
      cache.contextPrefix === undefined ? 'system-field' : 'context-prefix',
    anthropicMessages: converted,
    wantCaching,
    ttl,
    cacheLogger: logger,
    systemInstruction: cache.contextPrefix,
  });
  const evidence = applyRequestCacheControls({
    systemContext: { systemField: undefined, messages },
    requestSettings: {
      streamingEnabled: true,
      currentModel: settings.currentModel ?? '',
      requestOverrides: {},
      configEphemerals: {},
      wantCaching,
      ttl,
    },
    cacheLogger: logger,
    wantCaching,
    wantMediaPurgeCacheAnchor: cache.mediaPurge === true,
  });
  return { json: JSON.stringify(messages), evidence };
}

export async function cachedCandidate(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings,
  extra: WireExtras = {},
): Promise<CachedWire> {
  extra.signal?.throwIfAborted();
  const resolved: IContent[] = [];
  if (extra.mediaStage !== undefined) {
    for await (const row of extra.mediaStage(
      inMemoryRequestSelection(structuredClone([...rows])).openReader(
        extra.signal,
      ),
    ))
      resolved.push(row);
  }
  const format = nativeSettings(settings);
  const engine = await callerOwnedAnthropicEngine(
    {
      ...inMemoryRequestSelection(
        extra.mediaStage === undefined ? structuredClone([...rows]) : resolved,
      ),
      callerOwned: true,
    },
    format,
    { strip: settings.strip, includeInContext: settings.includeInContext },
    true,
  );
  const prefix = placeSystemInstruction({
    placement:
      cache.contextPrefix === undefined ? 'system-field' : 'context-prefix',
    anthropicMessages: [],
    wantCaching: cache.ttl !== undefined,
    ttl: cache.ttl ?? '5m',
    cacheLogger: logger,
    systemInstruction: cache.contextPrefix,
  }).find((_message, at) => at === 0);
  const { plan, evidence } = await nativeCache(
    engine,
    format,
    cache,
    prefix !== undefined,
  );
  let json = '';
  for await (const chunk of engine.serialize(undefined, prefix, plan)) {
    extra.signal?.throwIfAborted();
    json += chunk;
  }
  return { json, evidence };
}

async function nativeCache(
  engine: Awaited<ReturnType<typeof callerOwnedAnthropicEngine>>,
  format: RowFormatSettings,
  cache: CacheSettings,
  prefix: boolean,
): Promise<{
  plan: Awaited<ReturnType<typeof callerOwnedAnthropicCache>> | undefined;
  evidence: SemanticMediaPurgeCacheWriteEvidence | undefined;
}> {
  let plan =
    cache.ttl === undefined
      ? undefined
      : await callerOwnedAnthropicCache(engine, format, cache.ttl);
  let evidence: SemanticMediaPurgeCacheWriteEvidence | undefined;
  if (plan !== undefined && cache.mediaPurge === true) {
    const base = plan;
    plan = await callerOwnedPurgeCache(engine, base, Number(prefix));
    type Target = (typeof base.targets)[number];
    let previous: Target | undefined;
    let expected: Target | undefined;
    let tagged: { target: Target; boundaryId: object } | undefined;
    let tags = 0;
    let image = false;
    const same = (a: Target, b: Target): boolean =>
      a.run === b.run && a.block === b.block;
    for await (const entry of engine.cacheBlocks()) {
      if (
        entry.purge !== undefined &&
        !(
          entry.target.string &&
          base.targets.some((target) => same(target, entry.target))
        )
      ) {
        tags++;
        tagged = { target: entry.target, boundaryId: entry.purge };
      }
      if (!image && entry.block.type === 'image') {
        image = true;
        expected = previous;
      }
      if (selectLastCacheableBlockIndex([entry.block]) === 0)
        previous = entry.target;
    }
    if (
      tags === 1 &&
      tagged !== undefined &&
      expected !== undefined &&
      same(tagged.target, expected)
    ) {
      if (base.targets.some((target) => same(target, tagged.target)))
        evidence = { boundaryId: tagged.boundaryId, preparation: 'reused' };
      else if (plan.targets.length > base.targets.length)
        evidence = { boundaryId: tagged.boundaryId, preparation: 'added' };
    }
  }
  return { plan, evidence };
}

export async function emittedCandidate(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings,
  extra: WireExtras = {},
): Promise<string> {
  return (await cachedCandidate(rows, settings, cache, extra)).json;
}

export async function candidateJson(
  rows: readonly IContent[],
  settings: WireSettings,
  extra: WireExtras = {},
): Promise<string> {
  return emittedCandidate(rows, settings, {}, extra);
}

/** Where two JSON strings first differ, or undefined when they are equal. */
export function describeDifference(
  expected: string,
  actual: string,
): string | undefined {
  if (expected === actual) return undefined;
  let at = 0;
  while (at < expected.length && expected[at] === actual[at]) at++;
  return `first difference at ${at}: expected ...${expected.slice(Math.max(0, at - 60), at + 80)} but got ...${actual.slice(Math.max(0, at - 60), at + 80)}`;
}
