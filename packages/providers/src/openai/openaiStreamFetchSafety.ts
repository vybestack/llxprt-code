/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Avoid runtime-native stream iteration in the OpenAI SDK's SSE reader. */
export function createReaderBasedStreamFetch(
  innerFetch?: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const response = await (innerFetch ?? globalThis.fetch)(input, init);
    return response.ok &&
      response.body &&
      Boolean(Reflect.get(response.body, Symbol.asyncIterator))
      ? wrapResponseWithReaderIteratedBody(response)
      : response;
  };
}

/** Delegate Response methods to their original internal slots. */
export function wrapResponseWithReaderIteratedBody(
  response: Response,
): Response {
  if (!response.body) return response;
  return {
    get status() {
      return response.status;
    },
    get statusText() {
      return response.statusText;
    },
    get ok() {
      return response.ok;
    },
    get url() {
      return response.url;
    },
    get type() {
      return response.type;
    },
    get redirected() {
      return response.redirected;
    },
    get headers() {
      return response.headers;
    },
    get bodyUsed() {
      return response.bodyUsed;
    },
    body: createReaderIteratedBody(response.body),
    clone: () => wrapResponseWithReaderIteratedBody(response.clone()),
    text: () => response.text(),
    json: () => response.json(),
    arrayBuffer: () => response.arrayBuffer(),
    bytes: () => response.bytes(),
    blob: () => response.blob(),
    formData: () => response.formData(),
  };
}

type ReaderIteratedBody<T extends Uint8Array> = ReadableStream<T> & {
  [Symbol.asyncIterator](): AsyncIterator<T, undefined> & {
    return(): Promise<IteratorResult<T, undefined>>;
  };
};

/** Keep reads incremental without entering the runtime's native async iterator. */
export function createReaderIteratedBody<T extends Uint8Array>(
  body: ReadableStream<T>,
): ReaderIteratedBody<T> {
  return {
    get locked() {
      return body.locked;
    },
    getReader: body.getReader.bind(body),
    cancel: (reason?: unknown) => body.cancel(reason),
    pipeThrough: body.pipeThrough.bind(body),
    pipeTo: body.pipeTo.bind(body),
    tee: body.tee.bind(body),
    [Symbol.asyncIterator]() {
      const reader = body.getReader();
      let finished = false;
      return {
        async next(): Promise<IteratorResult<T, undefined>> {
          if (finished) return { done: true, value: undefined };
          try {
            const result = await reader.read();
            if (result.done) {
              finished = true;
              reader.releaseLock();
            }
            return result.done
              ? { done: true, value: undefined }
              : { done: false, value: result.value };
          } catch (error) {
            finished = true;
            reader.releaseLock();
            throw error;
          }
        },
        async return(): Promise<IteratorResult<T, undefined>> {
          if (!finished) {
            finished = true;
            const cancellation = reader.cancel();
            reader.releaseLock();
            await cancellation;
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}
