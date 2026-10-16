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
  type AnthropicMessage,
  type AnthropicMessageBlock,
} from '../../../AnthropicMessageNormalizer.js';
import { sanitizeAnthropicContentImages } from '../../../AnthropicImageSanitizer.js';
import {
  applyRequestCacheControls,
  placeSystemInstruction,
} from '../../../AnthropicRequestPreparation.js';
import { formatContextPrefix } from '../../../../utils/systemPromptPlacement.js';
import { writeTableMessages } from '../../emit.js';
import { finishWireRequest, leadsMergedMessage } from '../../finish.js';
import { MessageTable } from '../../message-table.js';
import {
  buildValidatedWireTable,
  type WireBuildOptions,
} from '../../wire-builder.js';

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
    unprefixToolName: (name, oauth) =>
      oauth && name.startsWith('oauth_') ? name.slice('oauth_'.length) : name,
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

function orderedBlocks(
  role: 'user' | 'assistant',
  blocks: AnthropicMessageBlock[],
): AnthropicMessageBlock[] {
  return [
    ...blocks.filter((block) => leadsMergedMessage(block, role)),
    ...blocks.filter((block) => !leadsMergedMessage(block, role)),
  ];
}

/** The table as messages: what the emit walk will write, before the E3 passes. */
export function tableMessages(table: MessageTable): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.text !== undefined) {
      messages.push({ role: message.role, content: message.text });
      continue;
    }
    const blocks = [...table.entries(message)].map((entry) => entry.block);
    messages.push({
      role: message.role,
      content:
        message.ordered === true ? orderedBlocks(message.role, blocks) : blocks,
    });
  }
  return messages;
}

export type WireExtras = Partial<
  Pick<WireBuildOptions, 'mediaStage' | 'signal'>
>;

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

/** Builds and finishes a table for `rows`; the caller closes it. */
async function finishedTable(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings,
  extra: WireExtras,
): Promise<{
  table: MessageTable;
  evidence: SemanticMediaPurgeCacheWriteEvidence | undefined;
}> {
  const table = new MessageTable();
  try {
    await buildValidatedWireTable(
      table,
      inMemoryRequestSelection(structuredClone([...rows])),
      {
        ...conversionOptions(settings),
        imageBudget: settings.imageBudget,
        ...extra,
      },
    );
    const evidence = finishWireRequest(table, {
      reasoningEnabled: settings.reasoningEnabled,
      currentModel: settings.currentModel,
      logger,
      contextPrefix:
        cache.contextPrefix === undefined || cache.contextPrefix === ''
          ? undefined
          : formatContextPrefix(cache.contextPrefix),
      caching:
        cache.ttl === undefined
          ? undefined
          : { ttl: cache.ttl, mediaPurgeBoundary: cache.mediaPurge === true },
    });
    return { table, evidence };
  } catch (error) {
    table.close();
    throw error;
  }
}

/** The same messages from the table builder, the table passes and the table cache controls. */
export async function cachedCandidate(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings,
  extra: WireExtras = {},
): Promise<CachedWire> {
  const { table, evidence } = await finishedTable(rows, settings, cache, extra);
  try {
    return { json: JSON.stringify(tableMessages(table)), evidence };
  } finally {
    table.close();
  }
}

/** The messages as the emit walk writes them into a request body. */
export async function emittedCandidate(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings,
  extra: WireExtras = {},
): Promise<string> {
  const { table } = await finishedTable(rows, settings, cache, extra);
  try {
    const parts: Uint8Array[] = [];
    const encoder = new TextEncoder();
    writeTableMessages(table, {
      append: (data) =>
        parts.push(typeof data === 'string' ? encoder.encode(data) : data),
    });
    return new TextDecoder().decode(Buffer.concat(parts));
  } finally {
    table.close();
  }
}

/** With prompt caching off and no system placement. */
export async function candidateJson(
  rows: readonly IContent[],
  settings: WireSettings,
  extra: WireExtras = {},
): Promise<string> {
  return (await cachedCandidate(rows, settings, {}, extra)).json;
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
