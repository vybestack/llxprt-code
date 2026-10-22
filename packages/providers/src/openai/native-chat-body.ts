/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { readInvocationPolicyValue } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
  PLAIN_CHAT_FORMAT_REV,
  appendStoredChatTail,
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
  const native = rows.native;
  if (native === undefined)
    throw new Error('Native Chat requires indexed request rows');
  const strip =
    readInvocationPolicyValue(
      options.invocation.ephemerals,
      'reasoning.stripFromContext',
    ) ?? 'none';
  const selected = selectedVariant(strip);
  const system = options.systemInstruction ?? '';
  const { plan, stripped } = await native.withFormat(
    plainChatLengthRegistration(settings),
    async (snapshot) => {
      const plan = await planRequestChatMessages(
        snapshot,
        native.indexed,
        settings,
        selected,
        system,
      );
      const stripped =
        selected === 1
          ? plan
          : await planRequestChatMessages(
              snapshot,
              native.indexed,
              settings,
              1,
              system,
            );
      return { plan, stripped };
    },
  );
  const { head, tail } = await envelopeParts(envelope);
  const continuationEnvelope = await envelopeParts({
    ...envelope,
    stream: true,
  });
  const signal = getRequestSignal(options);
  const continuations = new Set<NativeChatBody>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const spool = new NativeChatBody(
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
      );
      yield Buffer.from(']');
      yield tail;
    },
    head.byteLength + plan.bytes + tail.byteLength,
  );
  return {
    spool,
    messageCount: plan.items,
    continuation: {
      async build(toolCalls) {
        signal?.throwIfAborted();
        if (closed) throw new Error('Native Chat request was released');
        const messages = structuredClone(
          buildContinuationTail(toolCalls, 'openai'),
        );
        const length = appendStoredChatTail(stripped, messages);
        const body = new NativeChatBody(
          async function* () {
            signal?.throwIfAborted();
            yield continuationEnvelope.head;
            yield Buffer.from('[');
            yield* nativeChatValue({ role: 'system', content: system });
            const source = rows.openReader(signal);
            yield* nativeChatMessages(
              rowInput.mediaStage?.(source) ?? source,
              settings,
              'all',
              stripped.lastThinking,
            );
            for (const message of messages) {
              yield Buffer.from(',');
              yield* nativeChatValue(message);
            }
            yield Buffer.from(']');
            yield continuationEnvelope.tail;
          },
          continuationEnvelope.head.byteLength +
            length.bytes +
            continuationEnvelope.tail.byteLength,
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
      closing ??= Promise.all([
        spool.dispose(),
        ...Array.from(continuations, (body) => body.dispose()),
      ]).then(() => {
        continuations.clear();
      });
      return closing;
    },
  };
}

function nativeChatSettings(
  options: NormalizedGenerateChatOptions,
): RowFormatSettings {
  return {
    formatId: 'openai-chat:plain',
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
      toolFormat: 'openai',
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
): Promise<
  Pick<
    RequestContext,
    'spool' | 'messageCount' | 'release' | 'estimate' | 'dump' | 'continuation'
  >
> {
  if (use.dump)
    throw new Error('Native plain Chat dump projection is not installed');
  const settings = nativeChatSettings(options);
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
