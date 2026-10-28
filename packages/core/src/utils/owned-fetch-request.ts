/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import type { IncomingHttpHeaders } from 'node:http';
import type { Dispatcher } from 'undici';
import type * as Undici from 'undici';

const packageRequire = createRequire(
  createRequire(import.meta.url).resolve('undici/package.json'),
);
const { interceptors }: typeof Undici = packageRequire('./');

export async function dispatchOwnedFetch(
  dispatcher: Dispatcher,
  request: Request,
  signal: AbortSignal,
  replayableBody: string | Uint8Array | undefined,
  headersTimeoutMs: number | undefined,
): Promise<Response> {
  const transport: ResponseTransport = {
    controller: undefined,
    cancelled: false,
  };
  const { stream, body } = await acquireResponseStream(transport);
  return new Promise<Response>((resolve, reject) => {
    new OwnedFetchRequest({
      request,
      signal,
      replayableBody,
      headersTimeoutMs,
      stream,
      body,
      transport,
      resolve,
      reject,
    }).dispatch(dispatcher);
  });
}

interface ResponseTransport {
  controller: Dispatcher.DispatchController | undefined;
  cancelled: boolean;
}

interface OwnedFetchInput {
  readonly request: Request;
  readonly signal: AbortSignal;
  readonly replayableBody: string | Uint8Array | undefined;
  readonly headersTimeoutMs: number | undefined;
  readonly stream: ReadableStream<Uint8Array>;
  readonly body: ReadableStreamDefaultController<Uint8Array>;
  readonly transport: ResponseTransport;
  readonly resolve: (response: Response) => void;
  readonly reject: (error: unknown) => void;
}

class OwnedFetchRequest implements Dispatcher.DispatchHandler {
  private ended = false;
  private responseUrl: string;
  private redirected = false;

  constructor(private readonly input: OwnedFetchInput) {
    this.responseUrl = input.request.url;
  }

  dispatch(dispatcher: Dispatcher): void {
    if (this.input.signal.aborted) {
      this.fail(this.input.signal.reason);
      return;
    }
    const tracked = dispatcher.compose((dispatch) => (options, handler) => {
      const next = new URL(options.path, options.origin).href;
      this.redirected ||= next !== this.input.request.url;
      this.responseUrl = next;
      return dispatch(options, handler);
    });
    const route = tracked.compose(
      interceptors.redirect({
        maxRedirections: this.input.request.redirect === 'follow' ? 20 : 0,
      }),
      interceptors.decompress({ skipErrorResponses: false }),
    );
    const url = new URL(this.input.request.url);
    this.input.signal.addEventListener('abort', this.abort, { once: true });
    try {
      route.dispatch(
        {
          origin: url.origin,
          path: `${url.pathname}${url.search}`,
          method: this.input.request.method,
          headers: Object.fromEntries(this.input.request.headers),
          headersTimeout: this.input.headersTimeoutMs,
          body:
            this.input.replayableBody ??
            (this.input.request.body === null
              ? null
              : Readable.from(uploadBody(this.input.request.body))),
        },
        this,
      );
    } catch (error) {
      this.fail(error);
    }
    return;
  }

  onRequestStart(controller: Dispatcher.DispatchController): void {
    this.input.transport.controller = controller;
    if (this.input.signal.aborted) this.abort();
  }

  onResponseStart(
    controller: Dispatcher.DispatchController,
    status: number,
    values: IncomingHttpHeaders,
    statusText?: string,
  ): void {
    if (status < 200) return;
    if (
      this.input.request.redirect === 'error' &&
      [301, 302, 303, 307, 308].includes(status) &&
      values.location !== undefined
    ) {
      controller.abort(new TypeError('Fetch redirect is not allowed'));
      return;
    }
    if (
      this.input.request.redirect === 'follow' &&
      [301, 302, 303, 307, 308].includes(status) &&
      values.location !== undefined
    ) {
      controller.abort(new TypeError('Fetch redirect could not be followed'));
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value])
        headers.append(key, entry);
    }
    const response = new Response(
      this.input.request.method === 'HEAD' || [204, 205, 304].includes(status)
        ? null
        : this.input.stream,
      { status, statusText, headers },
    );
    this.input.resolve(
      withResponseMetadata(response, this.responseUrl, this.redirected),
    );
  }

  onResponseData(
    controller: Dispatcher.DispatchController,
    chunk: Buffer,
  ): void {
    if (this.ended || this.input.transport.cancelled) return;
    this.input.body.enqueue(new Uint8Array(chunk));
    if ((this.input.body.desiredSize ?? 0) <= 0) controller.pause();
  }

  onResponseEnd(): void {
    if (this.ended) return;
    this.ended = true;
    this.input.signal.removeEventListener('abort', this.abort);
    if (!this.input.transport.cancelled) this.input.body.close();
  }

  onResponseError(
    _controller: Dispatcher.DispatchController,
    error: Error,
  ): void {
    this.fail(error);
  }

  private readonly abort = (): void => {
    const reason: unknown = this.input.signal.reason;
    this.input.transport.controller?.abort(
      reason instanceof Error
        ? reason
        : new DOMException('Request was aborted', 'AbortError'),
    );
    this.fail(reason);
  };

  private fail(error: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.input.signal.removeEventListener('abort', this.abort);
    if (!this.input.transport.cancelled) this.input.body.error(error);
    this.input.reject(error);
  }
}

function acquireResponseStream(transport: ResponseTransport): Promise<{
  readonly stream: ReadableStream<Uint8Array>;
  readonly body: ReadableStreamDefaultController<Uint8Array>;
}> {
  return new Promise((resolve) => {
    const stream = new ReadableStream<Uint8Array>(
      {
        start: async (body) => {
          // start runs synchronously, before the stream constructor returns.
          await Promise.resolve();
          resolve({ stream, body });
        },
        pull: () => transport.controller?.resume(),
        cancel: () => {
          transport.cancelled = true;
          transport.controller?.abort(
            new DOMException('Response body was cancelled', 'AbortError'),
          );
        },
      },
      { highWaterMark: 65536, size: (chunk) => chunk?.byteLength ?? 0 },
    );
  });
}

function withResponseMetadata(
  response: Response,
  url: string,
  redirected: boolean,
): Response {
  return new Proxy(response, {
    get: (target, property): unknown => {
      if (property === 'url') return url;
      if (property === 'redirected') return redirected;
      if (property === 'type') return 'basic';
      if (property === 'clone')
        return () => withResponseMetadata(target.clone(), url, redirected);
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function* uploadBody(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}
