/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RequestScopedContents } from '../utils/requestScopedBody.js';
import { jsonValueBytes } from '../utils/progressive-json-body.js';
import type {
  OpenAIResponsesRequest,
  ResponsesInputItem,
} from './OpenAIResponsesTypes.js';

export async function* progressiveResponsesInput(
  owner: RequestScopedContents,
  request: OpenAIResponsesRequest,
  buildInput: (rows: IContent[]) => ResponsesInputItem[],
  fill: () => Promise<void>,
  signal: AbortSignal | undefined,
): AsyncIterable<ResponsesInputItem> {
  let emitted = 0;
  for await (const row of owner.stream()) {
    signal?.throwIfAborted();
    if (
      (row.speaker === 'human' || row.speaker === 'ai') &&
      row.blocks.every((block) => block.type === 'text')
    ) {
      for (const item of buildInput([row])) {
        emitted += 1;
        yield item;
      }
    } else {
      // Tool pairing, synthetic responses and aggregate media validation
      // depend on the remaining history. Preserve the finalized suffix.
      await fill();
      yield* request.input.slice(emitted);
      return;
    }
  }
}

async function* valueBytes(
  value: unknown,
  signal: AbortSignal | undefined,
): AsyncIterable<Uint8Array> {
  for await (const chunk of jsonValueBytes(value)) {
    signal?.throwIfAborted();
    yield chunk;
  }
}

async function* inputBytes(
  rows: AsyncIterator<ResponsesInputItem>,
  first: IteratorResult<ResponsesInputItem>,
  signal: AbortSignal | undefined,
): AsyncIterable<Uint8Array> {
  let next = first;
  let separator = '';
  while (next.done !== true) {
    signal?.throwIfAborted();
    if (separator !== '') yield Buffer.from(separator);
    yield* valueBytes(next.value, signal);
    separator = ',';
    next = await rows.next();
  }
  yield Buffer.from(']');
}

export async function* responsesBodyBytes(
  request: OpenAIResponsesRequest,
  input: AsyncIterable<ResponsesInputItem>,
  signal: AbortSignal | undefined,
): AsyncIterable<Uint8Array> {
  const rows = input[Symbol.asyncIterator]();
  try {
    const first = await rows.next();
    signal?.throwIfAborted();
    let prefix = '{';
    for (const key of Object.keys(request)) {
      const value: unknown = Reflect.get(request, key);
      if (value === undefined) continue;
      const opening = key === 'input' ? '[' : '';
      yield Buffer.from(`${prefix}${JSON.stringify(key)}:${opening}`);
      if (key === 'input') yield* inputBytes(rows, first, signal);
      else yield* valueBytes(value, signal);
      prefix = ',';
    }
    yield Buffer.from('}');
  } finally {
    await rows.return?.();
  }
}
