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
  const initialBody = response.body;
  if (!initialBody) return response;
  // Body content is served through bodySource so clone() can swap it without
  // disturbing immutable metadata, which stays delegated to the original.
  let bodySource = response;
  let currentBody = initialBody;
  let wrappedBody = createReaderIteratedBody(currentBody);
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
      return bodySource.bodyUsed;
    },
    // Re-read bodySource.body at access time and re-wrap when the underlying
    // stream reference changed, memoizing per reference so wrapper identity
    // stays stable while the underlying body is unchanged.
    get body() {
      const body = bodySource.body;
      if (body === null) return null;
      if (body !== currentBody) {
        currentBody = body;
        wrappedBody = createReaderIteratedBody(body);
      }
      return wrappedBody;
    },
    // Delegating to response.clone() lets the runtime strand the original's
    // materialized stream (observed on Bun: string-backed bodies keep the
    // same reference but are closed, stream-backed ones get replaced), so
    // tee our current body instead and serve each side from its own branch.
    clone: () => {
      const [originalBranch, cloneBranch] = currentBody.tee();
      const responseInit = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };
      bodySource = new Response(originalBranch, responseInit);
      currentBody = originalBranch;
      wrappedBody = createReaderIteratedBody(originalBranch);
      return wrapResponseWithReaderIteratedBody(
        new Response(cloneBranch, responseInit),
      );
    },
    text: () => bodySource.text(),
    json: () => bodySource.json(),
    arrayBuffer: () => bodySource.arrayBuffer(),
    bytes: () => bodySource.bytes(),
    blob: () => bodySource.blob(),
    formData: () => bodySource.formData(),
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
