/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export type TransportKind =
  | 'token'
  | 'metadata'
  | 'sts'
  | 'iam'
  | 'model'
  | 'subject';

export interface RecordedRequest {
  readonly kind: TransportKind;
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface OwnerTransport {
  readonly fetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly requests: readonly RecordedRequest[];
  hold(kind: TransportKind): void;
  release(kind: TransportKind): void;
  waitForRequest(kind: TransportKind): Promise<RecordedRequest>;
  close(): Promise<void>;
}

const FIXED_HOSTS: Readonly<Record<string, TransportKind>> = {
  'www.googleapis.com': 'token',
  'oauth2.googleapis.com': 'token',
  '169.254.169.254': 'metadata',
  'metadata.google.internal.': 'metadata',
  'sts.googleapis.com': 'sts',
  'iamcredentials.googleapis.com': 'iam',
};

/**
 * Regional Vertex model hosts the tests actually request. Exact names only: a
 * suffix test would also route `evil-us-central1-aiplatform.googleapis.com`.
 * Add a region here when a test starts using it.
 */
const MODEL_HOSTS: ReadonlySet<string> = new Set([
  'us-central1-aiplatform.googleapis.com',
  'europe-west4-aiplatform.googleapis.com',
]);

function kindForHost(hostname: string, root: string): TransportKind {
  const fixed = FIXED_HOSTS[hostname];
  if (fixed !== undefined) {
    return fixed;
  }
  if (MODEL_HOSTS.has(hostname)) {
    return 'model';
  }
  if (hostname === `metadata-${root}.invalid`) {
    return 'metadata';
  }
  if (hostname === `subject-${root}.invalid`) {
    return 'subject';
  }
  throw new Error(`Owner transport ${root} has no route for ${hostname}`);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function respondJson(
  response: ServerResponse,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(200, {
    'content-type': 'application/json',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function respondFor(
  root: string,
  recorded: RecordedRequest,
  response: ServerResponse,
): void {
  switch (recorded.kind) {
    case 'token':
      respondJson(response, {
        access_token: `tok-${root}`,
        expires_in: 3600,
        token_type: 'Bearer',
      });
      return;
    case 'metadata':
      respondJson(
        response,
        recorded.url.includes('/service-accounts/')
          ? {
              access_token: `meta-${root}`,
              expires_in: 3600,
              token_type: 'Bearer',
            }
          : {},
        { 'metadata-flavor': 'Google' },
      );
      return;
    case 'sts':
      respondJson(response, {
        access_token: `sts-${root}`,
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
      return;
    case 'iam':
      respondJson(response, {
        accessToken: `iam-${root}`,
        expireTime: new Date(Date.now() + 3_600_000).toISOString(),
      });
      return;
    case 'subject':
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(`subject-${root}`);
      return;
    case 'model':
      respondJson(response, {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: `ok-${root}` }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      });
      return;
  }
}

/**
 * One owner's transport for Vertex credential tests: a loopback server behind a
 * fetch that maps the fixed Google hosts (and the test-only `.invalid` hosts)
 * to canned responders. Any other host throws, so nothing leaves the machine.
 */
export async function createOwnerTransport(
  root: string,
): Promise<OwnerTransport> {
  const requests: RecordedRequest[] = [];
  const held = new Set<TransportKind>();
  const pending = new Map<TransportKind, Array<() => void>>();
  const waiters: Array<{
    kind: TransportKind;
    resolve: (request: RecordedRequest) => void;
  }> = [];
  const aborts = new Set<AbortController>();
  let closed = false;

  const server: Server = createServer((incoming, response) => {
    void readBody(incoming).then((body) => {
      const headers = Object.fromEntries(
        Object.entries(incoming.headers).flatMap(([name, value]) =>
          typeof value === 'string' ? [[name, value]] : [],
        ),
      );
      const kind = headers['x-owner-kind'] as TransportKind;
      const recorded: RecordedRequest = {
        kind,
        url: headers['x-original-url'],
        method: incoming.method ?? 'GET',
        headers,
        body,
      };
      requests.push(recorded);
      for (const waiter of waiters.splice(0)) {
        if (waiter.kind === kind) {
          waiter.resolve(recorded);
        } else {
          waiters.push(waiter);
        }
      }
      if (held.has(kind)) {
        held.delete(kind);
        pending.set(kind, [
          ...(pending.get(kind) ?? []),
          () => respondFor(root, recorded, response),
        ]);
        return;
      }
      respondFor(root, recorded, response);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;

  const ownerFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (closed) {
      throw new Error('Owner transport is closed');
    }
    const request = new Request(input, init);
    const original = new URL(request.url);
    const kind = kindForHost(original.hostname, root);
    const body = await request.text();
    const controller = new AbortController();
    aborts.add(controller);
    const callerSignal = request.signal;
    const onCallerAbort = (): void => controller.abort(callerSignal.reason);
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    try {
      const headers = new Headers(request.headers);
      headers.set('x-owner-kind', kind);
      headers.set('x-original-url', request.url);
      return await globalThis.fetch(
        `http://127.0.0.1:${String(port)}${original.pathname}${original.search}`,
        {
          method: request.method,
          headers,
          ...(body === '' ? {} : { body }),
          signal: controller.signal,
        },
      );
    } finally {
      callerSignal.removeEventListener('abort', onCallerAbort);
      aborts.delete(controller);
    }
  };

  return {
    fetch: ownerFetch,
    requests,
    hold(kind) {
      held.add(kind);
    },
    release(kind) {
      for (const respond of pending.get(kind) ?? []) {
        respond();
      }
      pending.delete(kind);
    },
    waitForRequest(kind) {
      const existing = requests.find((entry) => entry.kind === kind);
      if (existing !== undefined) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve) => {
        waiters.push({ kind, resolve });
      });
    },
    async close() {
      closed = true;
      for (const controller of aborts) {
        controller.abort(new Error('Owner transport is closed'));
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
