/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { readInvocationPolicyValue } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
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
import { createChatContinuation } from './OpenAIChatContinuation.js';
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

async function prepareNativeChatBody(
  envelope: Readonly<Record<string, unknown>>,
  rows: ProviderRequestRows,
  options: NormalizedGenerateChatOptions,
  settings: RowFormatSettings,
  rowInput: ChatRowInput,
): Promise<{
  spool: NativeChatBody;
  messageCount: number;
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
  if (strip !== 'none' && strip !== 'all')
    throw new JournalFormatError(
      'Native plain Chat last-thinking planning is not installed',
    );
  const system = options.systemInstruction ?? '';
  const plan = await native.withFormat(
    plainChatLengthRegistration(settings),
    (snapshot) =>
      planRequestChatMessages(
        snapshot,
        native.indexed,
        settings,
        strip === 'all' ? 1 : 0,
        system,
      ),
  );
  const { head, tail } = await envelopeParts(envelope);
  const signal = getRequestSignal(options);
  const spool = new NativeChatBody(
    async function* () {
      yield head;
      yield Buffer.from('[');
      yield* nativeChatValue({ role: 'system', content: system });
      const source = rows.openReader(signal);
      yield* nativeChatMessages(
        rowInput.mediaStage?.(source) ?? source,
        settings,
        strip,
        -1,
      );
      yield Buffer.from(']');
      yield tail;
    },
    head.byteLength + plan.bytes + tail.byteLength,
  );
  return { spool, messageCount: plan.items, release: () => spool.dispose() };
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
  if (use.estimate || use.dump)
    throw new Error(
      'Native plain Chat estimate and dump projections are not installed',
    );
  const body = await prepareNativeChatBody(
    envelope,
    rows,
    options,
    {
      formatId: 'openai-chat:plain',
      formatRev: 1,
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
    },
    rowInput,
  );
  return {
    ...body,
    estimate: undefined,
    dump: undefined,
    continuation: createChatContinuation({
      envelope,
      systemInstruction: options.systemInstruction,
      signal: getRequestSignal(options),
      source: { rows: () => rows.openReader(getRequestSignal(options)) },
      body: {
        reasoning: options,
        toolFormat: 'openai',
        config: parseOutputLimits(options.invocation.ephemerals),
        ...(rowInput.mediaStage === undefined
          ? {}
          : { mediaStage: rowInput.mediaStage }),
      },
    }),
  };
}
