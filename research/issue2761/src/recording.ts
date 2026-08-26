/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire-capture helpers for the baseURL / custom-fetch / dump probe (P12).
 *
 * Two independent mechanisms, because the two adapters expose different
 * interception surfaces:
 *
 *  - a local recording HTTP proxy, which works for BOTH adapters because both
 *    accept a base URL override; and
 *  - a recording `fetch`, which only `@ai-sdk/google` accepts.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

export const UPSTREAM_ORIGIN = 'https://generativelanguage.googleapis.com';

export interface WireRecord {
  readonly method: string;
  readonly url: string;
  readonly requestHeaderNames: string[];
  readonly authCarrier: 'x-goog-api-key-header' | 'key-query-param' | 'none';
  readonly requestBody: unknown;
  readonly status: number;
  readonly responseContentType: string | null;
  readonly responseBodyPreview: string;
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
 * behavior under test is not altered.
 */
export async function startRecordingProxy(): Promise<RecordingProxy> {
  const records: WireRecord[] = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? '/';
      const requestBodyRaw = await readBody(req);
      const headerNames = Object.keys(req.headers);
      const forwardHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (name === 'host' || name === 'connection' || value === undefined) {
          continue;
        }
        forwardHeaders[name] = Array.isArray(value) ? value.join(', ') : value;
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
      if (upstream.body === null) {
        res.end();
      } else {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (responsePreview.length < 4000) {
            responsePreview += Buffer.from(value).toString('utf8');
          }
          res.write(Buffer.from(value));
        }
        res.end();
      }

      records.push({
        method: req.method ?? 'GET',
        url: path,
        requestHeaderNames: headerNames.sort(),
        authCarrier: classifyAuthCarrier(headerNames, path),
        requestBody: parseJsonOrText(requestBodyRaw),
        status: upstream.status,
        responseContentType: contentType,
        responseBodyPreview: responsePreview.slice(0, 4000),
      });
    })().catch((error: unknown) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ proxyError: String(error) }));
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

export interface RecordingFetch {
  readonly fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly records: WireRecord[];
}

/**
 * A `fetch` middleware that records the outbound request and the inbound
 * response without consuming the response stream the caller needs.
 */
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
      const headerNames: string[] = [];
      new Headers(init?.headers ?? {}).forEach((_value, name) => {
        headerNames.push(name);
      });
      const bodyRaw = typeof init?.body === 'string' ? init.body : '';
      const response = await fetch(input as RequestInfo, init);
      const [forCaller, forRecord] =
        response.body === null
          ? [null, null]
          : (response.body.tee() as [ReadableStream, ReadableStream]);

      let preview = '';
      if (forRecord !== null) {
        void (async () => {
          const reader = forRecord.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            if (preview.length < 4000) {
              preview += Buffer.from(value as Uint8Array).toString('utf8');
            }
          }
          records.push({
            method: init?.method ?? 'GET',
            url,
            requestHeaderNames: headerNames.sort(),
            authCarrier: classifyAuthCarrier(headerNames, url),
            requestBody: parseJsonOrText(bodyRaw),
            status: response.status,
            responseContentType: response.headers.get('content-type'),
            responseBodyPreview: preview.slice(0, 4000),
          });
        })();
      }

      return new Response(forCaller, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  };
}
