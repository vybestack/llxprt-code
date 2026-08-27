/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire-capture helpers for the baseURL / custom-fetch / dump probe (P12) and
 * for the abort probe (P11).
 *
 * Two independent mechanisms, because the two adapters expose different
 * interception surfaces:
 *
 *  - a local recording HTTP proxy, which works for BOTH adapters because both
 *    accept a base URL override; and
 *  - a recording `fetch`, which only `@ai-sdk/google` accepts.
 *
 * The proxy appends a `WireRecord` even when the downstream client disconnects
 * before the relay finishes, so a stream that was aborted mid-flight still shows
 * up in `records`. `relayCompleted` / `clientDisconnected` /
 * `requestHeaders` are populated only by the proxy path; the recording fetch has
 * no downstream stream to cut short, so those fields stay undefined there.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

export const UPSTREAM_ORIGIN = 'https://generativelanguage.googleapis.com';

export interface WireRecord {
  readonly method: string;
  readonly url: string;
  readonly requestHeaderNames: string[];
  /** Header values as received by the proxy, for value-level checks. */
  readonly requestHeaders?: Record<string, string>;
  readonly authCarrier: 'x-goog-api-key-header' | 'key-query-param' | 'none';
  readonly requestBody: unknown;
  readonly status: number;
  readonly responseContentType: string | null;
  readonly responseBodyPreview: string;
  /**
   * True when the proxy relayed the full upstream response to the client and
   * called `res.end()`. False when the relay was cut short, which is exactly
   * what a mid-stream abort looks like from the wire.
   */
  readonly relayCompleted?: boolean;
  /**
   * True when the downstream client closed the connection before the relay
   * finished. Only the proxy path can observe this.
   */
  readonly clientDisconnected?: boolean;
  /**
   * True when the upstream read loop ended without draining the response body to the
   * end, whether because the client left (and the reader was cancelled) or because
   * the upstream stream itself errored.
   */
  readonly upstreamCutShort?: boolean;
}

function classifyAuthCarrier(
  headerNames: readonly string[],
  url: string,
): WireRecord['authCarrier'] {
  if (headerNames.includes('x-goog-api-key')) {
    return 'x-goog-api-key-header';
  }
  if (/[?&]key=/.test(url)) {
    return 'key-query-param';
  }
  return 'none';
}

function collectHeaderValues(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    out[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

function parseJsonOrText(raw: string): unknown {
  if (raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw.slice(0, 4000);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface RecordingProxy {
  /** Base URL to hand to an adapter, e.g. `http://127.0.0.1:1234`. */
  readonly origin: string;
  readonly records: WireRecord[];
  close(): Promise<void>;
}

/**
 * Starts a local proxy that forwards to the real Gemini endpoint and records
 * both directions. Streaming responses are relayed chunk-by-chunk so the SSE
 * behavior under test is not altered. A record is appended even if the relay was
 * cut short, so a downstream abort shows up with `relayCompleted: false` and
 * `clientDisconnected: true` instead of silently vanishing.
 */
export async function startRecordingProxy(): Promise<RecordingProxy> {
  const records: WireRecord[] = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? '/';
      const requestBodyRaw = await readBody(req);
      const requestHeaders = collectHeaderValues(req);
      const headerNames = Object.keys(requestHeaders);
      const forwardHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(requestHeaders)) {
        if (name === 'host' || name === 'connection' || value === undefined) {
          continue;
        }
        forwardHeaders[name] = value;
      }

      const upstream = await fetch(`${UPSTREAM_ORIGIN}${path}`, {
        method: req.method ?? 'GET',
        headers: forwardHeaders,
        ...(requestBodyRaw.length > 0 ? { body: requestBodyRaw } : {}),
      });

      const contentType = upstream.headers.get('content-type');
      res.writeHead(upstream.status, {
        ...(contentType !== null ? { 'content-type': contentType } : {}),
      });

      let responsePreview = '';
      let relayCompleted = false;
      let clientDisconnected = false;
      let upstreamDrained = false;

      const finalize = (): void => {
        records.push({
          method: req.method ?? 'GET',
          url: path,
          requestHeaderNames: headerNames.sort(),
          requestHeaders,
          authCarrier: classifyAuthCarrier(headerNames, path),
          requestBody: parseJsonOrText(requestBodyRaw),
          status: upstream.status,
          responseContentType: contentType,
          responseBodyPreview: responsePreview.slice(0, 4000),
          relayCompleted,
          clientDisconnected,
          upstreamCutShort: !upstreamDrained,
        });
      };

      if (upstream.body === null) {
        relayCompleted = true;
        upstreamDrained = true;
        if (!res.destroyed) {
          res.end();
        }
        finalize();
        return;
      }

      res.on('close', () => {
        // Emitted on normal completion too (after res.end), so only a close
        // that happens before the relay finished counts as a disconnect.
        if (!relayCompleted) {
          clientDisconnected = true;
        }
      });

      const reader = upstream.body.getReader();
      try {
        for (;;) {
          if (clientDisconnected || res.destroyed) {
            // The downstream client went away before the relay finished. The
            // reader.cancel() is what actually tells Google the request is being
            // dropped; without it this read loop would keep pulling chunks.
            void reader.cancel().catch(() => undefined);
            break;
          }
          const { done, value } = await reader.read();
          if (done) {
            // A cancelled read also resolves as done; only a done that arrives
            // while the client is still connected means the relay truly drained.
            if (clientDisconnected) {
              void reader.cancel().catch(() => undefined);
              break;
            }
            upstreamDrained = true;
            break;
          }
          if (clientDisconnected || res.destroyed) {
            void reader.cancel().catch(() => undefined);
            break;
          }
          if (responsePreview.length < 4000) {
            responsePreview += Buffer.from(value).toString('utf8');
          }
          res.write(Buffer.from(value));
        }
        if (upstreamDrained && !res.destroyed) {
          // The ordinary path: upstream finished and the client is still
          // attached, so the relay is complete and the response must be closed.
          // Forgetting this leaves every proxied call hanging.
          relayCompleted = true;
          res.end();
        } else if (!res.destroyed) {
          res.end();
        }
      } catch {
        clientDisconnected = clientDisconnected || res.destroyed;
        void reader.cancel().catch(() => undefined);
        if (!res.destroyed) {
          res.end();
        }
      }
      finalize();
    })().catch((error: unknown) => {
      if (!res.destroyed) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ proxyError: String(error) }));
      }
    });
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${address.port}`,
    records,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

/**
 * A proxy record is appended only after the relay loop unwinds, which for an
 * aborted stream happens a beat after the client stops reading. Callers that
 * abort mid-stream must wait for the record rather than sampling the array
 * immediately, or they see `undefined` and conclude nothing was observed.
 */
export async function waitForRecord(
  proxy: RecordingProxy,
  index: number,
  timeoutMs = 5000,
): Promise<WireRecord | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = proxy.records[index];
    if (record !== undefined) {
      return record;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  return proxy.records[index];
}

/**
 * Everything about a call that is known before the response body is read. The
 * response-side fields are filled in once the body has drained, or on failure
 * with whatever was collected.
 */
type WireRecordRequestSide = Pick<
  WireRecord,
  | 'method'
  | 'url'
  | 'requestHeaderNames'
  | 'requestHeaders'
  | 'authCarrier'
  | 'requestBody'
  | 'status'
>;

export interface RecordingFetch {
  readonly fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  /**
   * A record is pushed before the corresponding `fetch` promise resolves, so a
   * caller may read this immediately after awaiting the call.
   */
  readonly records: WireRecord[];
}

/**
 * A `fetch` middleware that records the outbound request and the inbound
 * response without consuming the response stream the caller needs. The returned
 * `Response` is what the caller consumes; a tee'd copy is drained in the
 * background and, once drained, becomes the `WireRecord`. A reader failure is
 * caught, so it cannot become an unhandled rejection and the record is still
 * pushed with whatever preview was collected.
 *//** Synthetic status recorded when the request never reached the server. */
const TRANSPORT_FAILURE_STATUS = 0;

export function makeRecordingFetch(): RecordingFetch {
  const records: WireRecord[] = [];

  return {
    records,
    fetch: async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const requestHeaders: Record<string, string> = {};
      new Headers(init?.headers ?? {}).forEach((value, name) => {
        requestHeaders[name] = value;
      });
      const headerNames = Object.keys(requestHeaders);
      const bodyRaw = typeof init?.body === 'string' ? init.body : '';
      const requestSide = (status: number): WireRecordRequestSide => ({
        method: init?.method ?? 'GET',
        url,
        requestHeaderNames: [...headerNames].sort(),
        requestHeaders,
        authCarrier: classifyAuthCarrier(headerNames, url),
        requestBody: parseJsonOrText(bodyRaw),
        status,
      });

      let response: Response;
      try {
        response = await fetch(input as RequestInfo, init);
      } catch (error) {
        // A transport failure still gets a record: the request side was fully
        // known, and a caller waiting on the record must be able to tell a
        // failed call apart from a call that never happened.
        records.push({
          ...requestSide(TRANSPORT_FAILURE_STATUS),
          responseContentType: null,
          responseBodyPreview: String(error).slice(0, 4000),
          relayCompleted: false,
        });
        throw error;
      }

      if (response.body === null) {
        records.push({
          ...requestSide(response.status),
          responseContentType: response.headers.get('content-type'),
          responseBodyPreview: '',
          relayCompleted: true,
        });
        return response;
      }

      // Tee once, drain the record copy to completion BEFORE returning, so a
      // caller that reads `records` straight after awaiting this fetch always
      // sees the record. Tee'd branches buffer independently, so the caller
      // copy is untouched.
      const [forCaller, forRecord] = response.body.tee() as [
        ReadableStream<Uint8Array>,
        ReadableStream<Uint8Array>,
      ];

      let preview = '';
      let relayCompleted = false;
      const reader = forRecord.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            relayCompleted = true;
            break;
          }
          if (preview.length < 4000) {
            preview += Buffer.from(value).toString('utf8');
          }
        }
      } catch {
        // Reader cancelled or errored: record what was collected rather than
        // dropping the observation entirely.
      } finally {
        reader.releaseLock();
      }

      records.push({
        ...requestSide(response.status),
        responseContentType: response.headers.get('content-type'),
        responseBodyPreview: preview.slice(0, 4000),
        relayCompleted,
      });

      return new Response(forCaller, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  };
}
