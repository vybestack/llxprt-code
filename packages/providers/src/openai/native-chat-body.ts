/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeMistralResolver } from './native-mistral-row.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { readInvocationPolicyValue } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
  PLAIN_CHAT_FORMAT_REV,
  appendStoredChatTail,
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
import { nativeChatMessages, nativeChatValue } from './native-chat-messages.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { ChatContinuation } from './OpenAIChatContinuation.js';
import { buildContinuationTail } from './OpenAIRequestBuilder.js';
import { NativeChatEstimateProjection } from './native-chat-estimate.js';
import type {
  ChatRowInput,
  RequestContext,
} from './OpenAIRequestPreparation.js';

export class NativeChatBody {
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
      yield head;
      yield Buffer.from('[');
      yield* nativeChatValue({ role: 'system', content: system });
      const source = rows.openReader(signal);
      yield* nativeChatMessages(
        rowInput.mediaStage?.(source) ?? source,
        settings,
        strip,
        plan.lastThinking,
        captured.resolver,
      );
      yield Buffer.from(']');
      yield tail;
    },
    head.byteLength + plan.bytes + tail.byteLength,
  );
}

interface CapturedNativeChatPlan {
  readonly resolver?: NativeMistralResolver;
  readonly releaseMapping?: () => void | Promise<void>;
  readonly plan: StoredChatMessagePlan;
  readonly stripped: StoredChatMessagePlan;
  readonly continuationSettings: RowFormatSettings;
  readonly system: string;
  readonly strip: unknown;
  readonly head: Buffer;
  readonly tail: Buffer;
  readonly continuationEnvelope: { head: Buffer; tail: Buffer };
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

async function captureChatPlan(
  envelope: Readonly<Record<string, unknown>>,
  rows: ProviderRequestRows,
  options: NormalizedGenerateChatOptions,
  settings: RowFormatSettings,
): Promise<CapturedNativeChatPlan> {
  const native = rows.native;
  if (native === undefined)
    throw new Error('Native Chat requires indexed request rows');
  const strip = reasoningStrip(options);
  const selected = selectedVariant(strip);
  const system = options.systemInstruction ?? '';
  const mapping: {
    resolver?: NativeMistralResolver;
    release?: () => void | Promise<void>;
  } = {};
  try {
    const plan = await native.withFormat(
      plainChatLengthRegistration(settings),
      async (snapshot) => {
        if (settings.chat?.toolFormat === 'mistral') {
          mapping.resolver = await native.indexed.mistralForSnapshot(
            snapshot,
            2,
          );
        }
        const result = await planRequestChatMessages(
          snapshot,
          native.indexed,
          settings,
          selected,
          system,
        );
        if (mapping.resolver !== undefined) mapping.release = snapshot.hold();
        return result;
      },
    );
    const continuationSettings: RowFormatSettings = {
      ...settings,
      chat: { ...settings.chat, includeInContext: false },
    };
    const stripped =
      selected === 1 || settings.chat?.includeInContext === false
        ? plan
        : await native.withFormat(
            plainChatLengthRegistration(continuationSettings),
            (snapshot) =>
              planRequestChatMessages(
                snapshot,
                native.indexed,
                continuationSettings,
                selected,
                system,
              ),
          );
    const { head, tail } = await envelopeParts(envelope);
    const continuationEnvelope = await envelopeParts({
      ...envelope,
      stream: true,
    });
    const signal = getRequestSignal(options);
    return {
      resolver: mapping.resolver,
      releaseMapping: mapping.release,
      plan,
      stripped,
      continuationSettings,
      system,
      strip,
      head,
      tail,
      continuationEnvelope,
      signal,
    };
  } catch (error) {
    await mapping.release?.();
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
      yield continuationEnvelope.head;
      yield Buffer.from('[');
      yield* nativeChatValue({ role: 'system', content: system });
      const source = rows.openReader(signal);
      yield* nativeChatMessages(
        rowInput.mediaStage?.(source) ?? source,
        continuationSettings,
        strip,
        stripped.lastThinking,
        captured.resolver,
      );
      for (const message of messages) {
        yield Buffer.from(',');
        yield* nativeChatValue(message);
      }
      yield Buffer.from(']');
      yield continuationEnvelope.tail;
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
  rowInput: ChatRowInput,
): Promise<{
  spool: NativeChatBody;
  messageCount: number;
  continuation: ChatContinuation;
  release: () => Promise<void>;
}> {
  const captured = await captureChatPlan(envelope, rows, options, settings);
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
    formatId:
      toolFormat === 'mistral' ? 'openai-chat:mistral' : 'openai-chat:plain',
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
      toolFormat: toolFormat === 'mistral' ? 'mistral' : 'openai',
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

export async function prepareNativePlainRequest(
  envelope: Readonly<Record<string, unknown>>,
  rows: ProviderRequestRows,
  options: NormalizedGenerateChatOptions,
  use: { readonly estimate: boolean; readonly dump: boolean },
  rowInput: ChatRowInput,
  toolFormat: ToolFormat = 'openai',
): Promise<
  Pick<
    RequestContext,
    'spool' | 'messageCount' | 'release' | 'estimate' | 'dump' | 'continuation'
  >
> {
  if (use.dump)
    throw new Error('Native plain Chat dump projection is not installed');
  const settings = nativeChatSettings(options, toolFormat);
  const body = await prepareNativeChatBody(
    envelope,
    rows,
    options,
    settings,
    rowInput,
  );
  const native = rows.native;
  if (native === undefined)
    throw new Error('Native Chat requires indexed request rows');
  const strip = readInvocationPolicyValue(
    options.invocation.ephemerals,
    'reasoning.stripFromContext',
  );
  const selected = selectedVariant(strip);
  const projection = use.estimate
    ? new NativeChatEstimateProjection(
        native,
        settings,
        selected,
        options.systemInstruction ?? '',
        envelope.tools,
        getRequestSignal(options),
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
    dump: undefined,
  };
}
