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

export function dispatchOwnedFetch(
  dispatcher: Dispatcher,
  request: Request,
  signal: AbortSignal,
  replayableBody: string | Uint8Array | undefined,
): Promise<Response> {
  return new OwnedFetchRequest(request, signal, replayableBody).dispatch(
    dispatcher,
  );
}

class OwnedFetchRequest implements Dispatcher.DispatchHandler {
  private resolveResponse!: (response: Response) => void;
  private rejectResponse!: (error: unknown) => void;
  private readonly result = new Promise<Response>((resolve, reject) => {
    this.resolveResponse = resolve;
    this.rejectResponse = reject;
  });
  private controller: Dispatcher.DispatchController | undefined;
  private body!: ReadableStreamDefaultController<Uint8Array>;
  private ended = false;
  private cancelled = false;
  private responseUrl: string;
  private redirected = false;
  private readonly stream = new ReadableStream<Uint8Array>(
    {
      start: (controller) => {
        this.body = controller;
      },
      pull: () => {
        this.controller?.resume();
      },
      cancel: () => {
        this.cancelled = true;
        this.controller?.abort(
          new DOMException('Response body was cancelled', 'AbortError'),
        );
      },
    },
    { highWaterMark: 65536, size: (chunk) => chunk?.byteLength ?? 0 },
  );

  constructor(
    private readonly request: Request,
    private readonly signal: AbortSignal,
    private readonly replayableBody: string | Uint8Array | undefined,
  ) {
    this.responseUrl = request.url;
  }

  dispatch(dispatcher: Dispatcher): Promise<Response> {
    if (this.signal.aborted) {
      this.fail(this.signal.reason);
      return this.result;
    }
    const tracked = dispatcher.compose((dispatch) => (options, handler) => {
      const next = new URL(options.path, options.origin).href;
      this.redirected ||= next !== this.request.url;
      this.responseUrl = next;
      return dispatch(options, handler);
    });
    const route = tracked.compose(
      interceptors.redirect({
        maxRedirections: this.request.redirect === 'follow' ? 20 : 0,
      }),
      interceptors.decompress({ skipErrorResponses: false }),
    );
    const url = new URL(this.request.url);
    this.signal.addEventListener('abort', this.abort, { once: true });
    try {
      route.dispatch(
        {
          origin: url.origin,
          path: `${url.pathname}${url.search}`,
          method: this.request.method,
          headers: Object.fromEntries(this.request.headers),
          body:
            this.replayableBody ??
            (this.request.body === null
              ? null
              : Readable.from(uploadBody(this.request.body))),
        },
        this,
      );
    } catch (error) {
      this.fail(error);
    }
    return this.result;
  }

  onRequestStart(controller: Dispatcher.DispatchController): void {
    this.controller = controller;
    if (this.signal.aborted) this.abort();
  }

  onResponseStart(
    controller: Dispatcher.DispatchController,
    status: number,
    values: IncomingHttpHeaders,
    statusText?: string,
  ): void {
    if (status < 200) return;
    if (
      this.request.redirect === 'error' &&
      [301, 302, 303, 307, 308].includes(status) &&
      values.location !== undefined
    ) {
      controller.abort(new TypeError('Fetch redirect is not allowed'));
      return;
    }
    if (
      this.request.redirect === 'follow' &&
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
      this.request.method === 'HEAD' || [204, 205, 304].includes(status)
        ? null
        : this.stream,
      { status, statusText, headers },
    );
    this.resolveResponse(
      withResponseMetadata(response, this.responseUrl, this.redirected),
    );
  }

  onResponseData(
    controller: Dispatcher.DispatchController,
    chunk: Buffer,
  ): void {
    if (this.ended || this.cancelled) return;
    this.body.enqueue(new Uint8Array(chunk));
    if ((this.body.desiredSize ?? 0) <= 0) controller.pause();
  }

  onResponseEnd(): void {
    if (this.ended) return;
    this.ended = true;
    this.signal.removeEventListener('abort', this.abort);
    if (!this.cancelled) this.body.close();
  }

  onResponseError(
    _controller: Dispatcher.DispatchController,
    error: Error,
  ): void {
    this.fail(error);
  }

  private readonly abort = (): void => {
    const reason: unknown = this.signal.reason;
    this.controller?.abort(
      reason instanceof Error
        ? reason
        : new DOMException('Request was aborted', 'AbortError'),
    );
    this.fail(reason);
  };

  private fail(error: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.signal.removeEventListener('abort', this.abort);
    if (!this.cancelled) this.body.error(error);
    this.rejectResponse(error);
  }
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
