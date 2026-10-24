/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  requestFormatSlot,
  type NativeProviderFormat,
} from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import { callerOwnedChatIds } from './caller-owned-chat-ids.js';
import { mistralRowIds } from './native-mistral-row.js';
import type { NativeMistralResolver } from './native-mistral-row.js';
import { nativeKimiRowIds } from './native-kimi-row.js';
import type { NativeRowIds } from './native-row-ids.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  rowFormatKey,
  type RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { readInvocationPolicyValue } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
  PLAIN_CHAT_FORMAT_REV,
  appendStoredChatTail,
  chatPlanOf,
  foldChatUnits,
  type ChatFold,
  type StoredChatMessagePlan,
} from './journal-chat-length.js';
import { ProgressiveJsonBody } from '../utils/progressive-json-body.js';
import {
  DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  envelopeTooLargeError,
} from '../utils/boundedJsonBody.js';
import { StreamedSegment, writeEnvelope } from '../utils/envelope-writer.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { nativeChatPieces } from './native-chat-messages.js';
import {
  NativeDumpBody,
  nativeDumpLiteral,
  nativeDumpValue,
  nativeDumpEnvelope,
  type NativeDumpPiece,
} from '../utils/native-dump-body.js';
import type { StreamedDumpBody } from '../utils/dumpSDKContext.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { ChatContinuation } from './OpenAIChatContinuation.js';
import { buildContinuationTail } from './OpenAIRequestBuilder.js';
import {
  NativeChatEstimateProjection,
  chatTokenRegistration,
  type StreamedChatPlan,
} from './native-chat-estimate.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { PROJECTION_REVISION } from '../runtime/promptEnvelopeProjections.js';
import type { RowFormatRegistration } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { ChatUnitTokenMeasurer } from './journal-chat-length.js';
import type {
  ChatRowInput,
  RequestContext,
} from './OpenAIRequestPreparation.js';

export class NativeChatBody {
  private readonly body: ProgressiveJsonBody;
  private readonly capture: NativeDumpBody;
  readonly dump: StreamedDumpBody;
  constructor(
    bytes: () => AsyncIterable<NativeDumpPiece>,
    readonly byteLength: number,
  ) {
    if (byteLength > DEFAULT_HTTP_JSON_ENVELOPE_BYTES)
      throw envelopeTooLargeError(DEFAULT_HTTP_JSON_ENVELOPE_BYTES, byteLength);
    this.capture = new NativeDumpBody(bytes);
    this.dump = this.capture.dump;
    this.body = new ProgressiveJsonBody(
      () => this.capture.stream(),
      byteLength,
    );
  }
  openStream(): ReturnType<ProgressiveJsonBody['createStreamHandle']> {
    return this.body.createStreamHandle();
  }
  async dispose(): Promise<void> {
    try {
      await this.body.dispose();
    } finally {
      await this.capture.dispose();
    }
  }
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

function selectedVariant(strip: unknown): 0 | 1 | 2 {
  if (strip === 'none' || strip === undefined) return 0;
  if (strip === 'all') return 1;
  if (strip === 'allButLast') return 2;
  throw new JournalFormatError(
    `Invalid reasoning.stripFromContext: ${String(strip)}`,
  );
}
function initialNativeChatBody(
  rows: ProviderRequestRows,
  rowInput: ChatRowInput,
  settings: RowFormatSettings,
  captured: CapturedNativeChatPlan,
): NativeChatBody {
  const { signal, head, system, strip, plan, tail } = captured;
  return new NativeChatBody(
    async function* () {
      signal?.throwIfAborted();
      yield nativeDumpLiteral(head, captured.diagnostic.head);
      yield nativeDumpLiteral('[');
      yield* nativeDumpValue({ role: 'system', content: system });
      const source = rows.openReader(signal);
      yield* nativeChatPieces(
        rowInput.mediaStage?.(source) ?? source,
        settings,
        strip,
        plan.lastThinking,
        captured.rowIds,
        captured.allowOrphans,
      );
      yield nativeDumpLiteral(']');
      yield nativeDumpLiteral(tail, captured.diagnostic.tail);
    },
    head.byteLength + plan.bytes + tail.byteLength,
  );
}

interface CapturedNativeChatPlan {
  readonly allowOrphans?: boolean;
  readonly rowIds?: NativeRowIds;
  readonly releaseMapping?: () => void | Promise<void>;
  readonly plan: StoredChatMessagePlan;
  readonly stripped: StoredChatMessagePlan;
  readonly continuationSettings: RowFormatSettings;
  readonly system: string;
  readonly strip: unknown;
  readonly head: Buffer;
  readonly tail: Buffer;
  readonly continuationEnvelope: { head: Buffer; tail: Buffer };
  readonly diagnostic: { head: Buffer; tail: Buffer };
  readonly signal: AbortSignal | undefined;
}

function reasoningStrip(options: NormalizedGenerateChatOptions): unknown {
  return (
    readInvocationPolicyValue(
      options.invocation.ephemerals,
      'reasoning.stripFromContext',
    ) ?? 'none'
  );
}

/** What a request's chat plan is made from, and what keeps its ids readable. */
interface PlannedNativeChat {
  readonly plan: StoredChatMessagePlan;
  readonly allowOrphans?: boolean;
  readonly rowIds?: NativeRowIds;
  readonly releaseMapping?: () => void | Promise<void>;
}

type ChatPlanner = (
  selected: 0 | 1 | 2,
  system: string,
) => Promise<PlannedNativeChat>;

/** The plan from the lengths stored in the request's format slot. */
function storedChatPlanner(
  native: NativeProviderFormat,
  registration: RowFormatRegistration,
  count?: ChatUnitTokenMeasurer,
): ChatPlanner {
  const settings = registration.settings;
  return async (selected, system) => {
    const mapping: {
      resolver?: NativeMistralResolver;
      release?: () => void | Promise<void>;
    } = {};
    try {
      const plan = await native.withFormat(registration, async (snapshot) => {
        if (settings.chat?.toolFormat === 'mistral') {
          mapping.resolver = await native.indexed.mistralForSnapshot(
            snapshot,
            requestFormatSlot(snapshot, settings),
          );
        }
        const result = await planRequestChatMessages(
          snapshot,
          native.indexed,
          settings,
          selected,
          system,
          count,
        );
        if (mapping.resolver !== undefined) mapping.release = snapshot.hold();
        return result;
      });
      return {
        plan,
        rowIds:
          mapping.resolver === undefined
            ? undefined
            : mistralRowIds(mapping.resolver),
        releaseMapping: mapping.release,
      };
    } catch (error) {
      await mapping.release?.();
      throw error;
    }
  };
}

function kimiChatPlan(
  fold: ChatFold,
  settings: RowFormatSettings,
  selected: 0 | 1 | 2,
  system: string,
): StoredChatMessagePlan {
  const format = { key: rowFormatKey(settings), generation: 0 };
  const { summary } = fold;
  if (summary.kind !== 'chat') throw new Error('Kimi fold has no chat summary');
  if (selected !== 2)
    return chatPlanOf(summary, settings, selected, system, format);
  const lastThinking = (summary.thinkingRank?.last ?? 0) - 1;
  if (lastThinking < 0) return chatPlanOf(summary, settings, 1, system, format);
  if (fold.lastThinkingOnly === undefined)
    throw new Error('Kimi fold lacks the last-thinking variant');
  return {
    ...chatPlanOf(fold.lastThinkingOnly, settings, 0, system, format),
    lastThinking,
  };
}

/**
 * The Kimi ids of the request, read from a filled pin. The pin stays held
 * until `release`, because the body is written long after the plan is made.
 */
async function acquireKimiRowIds(
  native: NativeProviderFormat,
): Promise<{ rowIds: NativeRowIds; release: () => void | Promise<void> }> {
  return native.withKimi(async (snapshot) => {
    const release = snapshot.hold();
    try {
      return {
        rowIds: nativeKimiRowIds(
          await native.indexed.kimiForSnapshot(snapshot),
        ),
        release,
      };
    } catch (error) {
      await release();
      throw error;
    }
  });
}

/**
 * Kimi writes each id as `functions.<name>:<ordinal>` from facts that move
 * with the whole history, so no stored per-unit length stays right. The plan
 * is folded from the request's units with the ids the journal's Kimi facts
 * give, one unit at a time, and the body is then written from the same units.
 */
async function planStreamedChat(
  rows: ProviderRequestRows,
  settings: RowFormatSettings,
  selected: 0 | 1 | 2,
  system: string,
  signal: AbortSignal | undefined,
  rowIds: NativeRowIds | undefined,
  rowInput: ChatRowInput,
  count?: ChatUnitTokenMeasurer,
  allowOrphans = false,
): Promise<StoredChatMessagePlan> {
  const source = rows.openReader(signal);
  const fold = await foldChatUnits(
    rowInput.mediaStage?.(source) ?? source,
    settings,
    {
      rowIds,
      count,
      allowOrphans,
      lastThinkingOnly: selected === 2,
    },
  );
  return kimiChatPlan(fold, settings, selected, system);
}

function kimiChatPlanner(
  native: NativeProviderFormat,
  rows: ProviderRequestRows,
  settings: RowFormatSettings,
  signal: AbortSignal | undefined,
  rowInput: ChatRowInput,
): ChatPlanner {
  return async (selected, system) => {
    const { rowIds, release } = await acquireKimiRowIds(native);
    try {
      return {
        plan: await planStreamedChat(
          rows,
          settings,
          selected,
          system,
          signal,
          rowIds,
          rowInput,
        ),
        rowIds,
        releaseMapping: release,
      };
    } catch (error) {
      await release();
      throw error;
    }
  };
}

function kimiStreamedPlan(
  native: NativeProviderFormat,
  rows: ProviderRequestRows,
  selected: 0 | 1 | 2,
  system: string,
  signal: AbortSignal | undefined,
  rowInput: ChatRowInput,
): StreamedChatPlan {
  return async (settings, count) => {
    const { rowIds, release } = await acquireKimiRowIds(native);
    try {
      return await planStreamedChat(
        rows,
        settings,
        selected,
        system,
        signal,
        rowIds,
        rowInput,
        count,
      );
    } finally {
      await release();
    }
  };
}

function withoutReasoning(plan: StoredChatMessagePlan): StoredChatMessagePlan {
  return {
    ...plan,
    bytes: plan.bytes - plan.omittedReasoningBytes,
    root: {
      ...plan.root,
      bytes: plan.root.bytes.map((bytes) => bytes - plan.omittedReasoningBytes),
    },
  };
}

async function captureChatPlan(
  envelope: Readonly<Record<string, unknown>>,
  options: NormalizedGenerateChatOptions,
  settings: RowFormatSettings,
  planner: ChatPlanner,
): Promise<CapturedNativeChatPlan> {
  const strip = reasoningStrip(options);
  const system = options.systemInstruction ?? '';
  const planned = await planner(selectedVariant(strip), system);
  try {
    const continuationSettings: RowFormatSettings = {
      ...settings,
      chat: { ...settings.chat, includeInContext: false },
    };
    const { head, tail } = await envelopeParts(envelope);
    const continuationEnvelope = await envelopeParts({
      ...envelope,
      stream: true,
    });
    return {
      ...planned,
      stripped: withoutReasoning(planned.plan),
      continuationSettings,
      system,
      strip,
      head,
      tail,
      continuationEnvelope,
      diagnostic: await envelopeParts(nativeDumpEnvelope(envelope)),
      signal: getRequestSignal(options),
    };
  } catch (error) {
    await planned.releaseMapping?.();
    throw error;
  }
}

function continuationNativeChatBody(
  rows: ProviderRequestRows,
  rowInput: ChatRowInput,
  captured: CapturedNativeChatPlan,
  continuationSettings: RowFormatSettings,
  messages: ReturnType<typeof buildContinuationTail>,
  bytes: number,
): NativeChatBody {
  const { signal, system, strip, stripped, continuationEnvelope } = captured;
  return new NativeChatBody(
    async function* () {
      signal?.throwIfAborted();
      yield nativeDumpLiteral(continuationEnvelope.head);
      yield nativeDumpLiteral('[');
      yield* nativeDumpValue({ role: 'system', content: system });
      const source = rows.openReader(signal);
      yield* nativeChatPieces(
        rowInput.mediaStage?.(source) ?? source,
        continuationSettings,
        strip,
        stripped.lastThinking,
        captured.rowIds,
        captured.allowOrphans,
      );
      for (const message of messages) {
        yield nativeDumpLiteral(',');
        yield* nativeDumpValue(message);
      }
      yield nativeDumpLiteral(']');
      yield nativeDumpLiteral(continuationEnvelope.tail);
    },
    continuationEnvelope.head.byteLength +
      bytes +
      continuationEnvelope.tail.byteLength,
  );
}

async function retireNativeBodies(
  bodies: readonly NativeChatBody[],
  releaseMapping: CapturedNativeChatPlan['releaseMapping'],
): Promise<void> {
  const settled = await Promise.allSettled(
    bodies.map((body) => body.dispose()),
  );
  const failures = settled.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  try {
    await releaseMapping?.();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Native Chat retirement failed');
}

async function prepareNativeChatBody(
  envelope: Readonly<Record<string, unknown>>,
  rows: ProviderRequestRows,
  options: NormalizedGenerateChatOptions,
  settings: RowFormatSettings,
  planner: ChatPlanner,
  rowInput: ChatRowInput,
): Promise<{
  spool: NativeChatBody;
  messageCount: number;
  continuation: ChatContinuation;
  release: () => Promise<void>;
}> {
  const captured = await captureChatPlan(envelope, options, settings, planner);
  const { plan, signal } = captured;
  const { stripped, continuationSettings } = captured;
  const continuations = new Set<NativeChatBody>();
  let closed = false;
  let closing: Promise<void> | undefined;
  let spool: NativeChatBody;
  try {
    spool = initialNativeChatBody(rows, rowInput, settings, captured);
  } catch (error) {
    await captured.releaseMapping?.();
    throw error;
  }
  return {
    spool,
    messageCount: plan.items,
    continuation: {
      async build(toolCalls) {
        signal?.throwIfAborted();
        if (closed) throw new Error('Native Chat request was released');
        const messages = structuredClone(
          buildContinuationTail(
            toolCalls,
            settings.chat?.toolFormat ?? 'openai',
          ),
        );
        const length = appendStoredChatTail(stripped, messages);
        const body = continuationNativeChatBody(
          rows,
          rowInput,
          captured,
          continuationSettings,
          messages,
          length.bytes,
        );
        continuations.add(body);
        return {
          spool: body,
          async release() {
            await body.dispose();
            continuations.delete(body);
          },
        };
      },
    },
    release() {
      closed = true;
      closing ??= retireNativeBodies(
        [spool, ...continuations],
        captured.releaseMapping,
      ).then(() => {
        continuations.clear();
      });
      return closing;
    },
  };
}

function nativeChatSettings(
  options: NormalizedGenerateChatOptions,
  toolFormat: ToolFormat,
): RowFormatSettings {
  return {
    formatId: `openai-chat:${toolFormat === 'mistral' || toolFormat === 'kimi' ? toolFormat : 'plain'}`,
    formatRev: PLAIN_CHAT_FORMAT_REV,
    model: options.resolved.model,
    endpoint: options.resolved.baseURL ?? '',
    isOAuth: false,
    toolNameTransform: 'none',
    supportsUrlImages: true,
    reasoningEnabled: false,
    reasoningFieldName: 'reasoning_content',
    mediaPdfEnabled: false,
    unsupportedMedia: 'notice',
    outputLimits: parseOutputLimits(options.invocation.ephemerals),
    chat: {
      toolFormat:
        toolFormat === 'mistral' || toolFormat === 'kimi'
          ? toolFormat
          : 'openai',
      ...(toolFormat === 'mistral'
        ? { mistralRevision: 'sha256-base62-salt-v1-normalizer-v1' }
        : {}),
      includeInContext: Boolean(
        readInvocationPolicyValue(
          options.invocation.ephemerals,
          'reasoning.includeInContext',
        ),
      ),
    },
  };
}

interface ChatPlanning {
  readonly planner: ChatPlanner;
  readonly bodySettings: RowFormatSettings;
  readonly streamedPlan: StreamedChatPlan | undefined;
}

async function callerOwnedPlanning(
  rows: ProviderRequestRows,
  options: NormalizedGenerateChatOptions,
  settings: RowFormatSettings,
  rowInput: ChatRowInput,
  signal: AbortSignal | undefined,
): Promise<ChatPlanning> {
  const rowIds = await callerOwnedChatIds(
    rows,
    settings.chat?.toolFormat ?? 'openai',
  );
  let allowOrphans = true;
  for await (const row of rows.openReader(signal)) {
    if (
      row.speaker === 'ai' &&
      row.blocks.some((block) => block.type === 'tool_call')
    ) {
      allowOrphans = false;
      break;
    }
  }
  const plan = (
    captured: RowFormatSettings,
    selected: 0 | 1 | 2,
    system: string,
    count?: ChatUnitTokenMeasurer,
  ) =>
    planStreamedChat(
      rows,
      captured,
      selected,
      system,
      signal,
      rowIds,
      rowInput,
      count,
      allowOrphans,
    );
  return {
    planner: async (selected, system) => ({
      plan: await plan(settings, selected, system),
      rowIds,
      allowOrphans,
    }),
    bodySettings: settings,
    streamedPlan: (captured, count) =>
      plan(
        captured,
        selectedVariant(reasoningStrip(options)),
        options.systemInstruction ?? '',
        count,
      ),
  };
}

async function chatPlanning(
  native: NativeProviderFormat | undefined,
  rows: ProviderRequestRows,
  options: NormalizedGenerateChatOptions,
  settings: RowFormatSettings,
  rowInput: ChatRowInput,
  request: {
    readonly activeProvider: string;
    readonly signal: AbortSignal | undefined;
  },
): Promise<ChatPlanning> {
  const toolFormat = settings.chat?.toolFormat;
  if (rows.callerOwned === true)
    return callerOwnedPlanning(
      rows,
      options,
      settings,
      rowInput,
      request.signal,
    );
  if (native === undefined)
    throw new Error('Native Chat requires indexed request rows');
  if (toolFormat === 'kimi')
    return {
      planner: kimiChatPlanner(
        native,
        rows,
        settings,
        request.signal,
        rowInput,
      ),
      bodySettings: settings,
      streamedPlan: kimiStreamedPlan(
        native,
        rows,
        selectedVariant(reasoningStrip(options)),
        options.systemInstruction ?? '',
        request.signal,
        rowInput,
      ),
    };
  const measured =
    toolFormat === 'mistral'
      ? await chatTokenRegistration(
          settings,
          {
            activeProvider: request.activeProvider,
            canonicalModel: settings.model,
            protocol: 'openai-chat',
            wireMethod: 'chat/completions/v1',
            projectionRevision: PROJECTION_REVISION,
          },
          createRuntimeTokenizerFactory(),
        )
      : {
          registration: plainChatLengthRegistration(settings),
          count: undefined,
        };
  return {
    planner: storedChatPlanner(native, measured.registration, measured.count),
    bodySettings: measured.registration.settings,
    streamedPlan: undefined,
  };
}

export async function prepareNativePlainRequest(
  envelope: Readonly<Record<string, unknown>>,
  rows: ProviderRequestRows,
  options: NormalizedGenerateChatOptions,
  use: { readonly estimate: boolean; readonly dump: boolean },
  rowInput: ChatRowInput,
  toolFormat: ToolFormat = 'openai',
  providerName = 'openai',
): Promise<
  Pick<
    RequestContext,
    'spool' | 'messageCount' | 'release' | 'estimate' | 'dump' | 'continuation'
  >
> {
  const native = rows.native;
  const settings = nativeChatSettings(options, toolFormat);
  const signal = getRequestSignal(options);
  const system = options.systemInstruction ?? '';
  const { planner, bodySettings, streamedPlan } = await chatPlanning(
    native,
    rows,
    options,
    settings,
    rowInput,
    { activeProvider: providerName, signal },
  );
  const body = await prepareNativeChatBody(
    envelope,
    rows,
    options,
    bodySettings,
    planner,
    rowInput,
  );
  const selected = selectedVariant(reasoningStrip(options));
  const projection = use.estimate
    ? new NativeChatEstimateProjection(
        native,
        settings,
        selected,
        system,
        envelope.tools,
        signal,
        streamedPlan,
      )
    : undefined;
  return {
    ...body,
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
    dump: use.dump ? body.spool.dump : undefined,
  };
}
