/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mock } from 'bun:test';
import { scryptSync } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type * as undici from 'undici';
import { createRequire } from 'node:module';
import { z } from 'zod';

const dir = process.env.PROFILE_PARITY_DIR;
if (!dir) throw new Error('PROFILE_PARITY_DIR is required');
const keyringPath = join(dir, 'keyring.json');
const eventsPath = join(dir, 'boundary-events.jsonl');
const requestsPath = join(dir, 'requests.jsonl');
// Lets the parent date the end of Bun boot and preload when a launch hangs.
writeFileSync(join(dir, 'preload-loaded'), '');
const keyringSchema = z.record(z.string());
const requestSchema = z.object({ model: z.string() }).passthrough();
const localFetch = globalThis.fetch;
const httpEndpoints = [
  'https://api.anthropic.com/v1/messages',
  'https://api.openai.com/v1/chat/completions',
  'https://chatgpt.com/backend-api/codex/responses',
];

function observeUnexpectedNetwork(
  url: URL,
  transport: 'http' | 'websocket',
  method: string,
): void {
  appendFileSync(
    eventsPath,
    JSON.stringify({
      operation: 'unexpected-network',
      transport,
      method,
      endpoint: `${url.protocol}//${url.host}${url.pathname}`,
    }) + '\n',
  );
}

function readKeyring(): Record<string, string> {
  return keyringSchema.parse(JSON.parse(readFileSync(keyringPath, 'utf8')));
}

class IsolatedKeyringEntry {
  private readonly key: string;

  constructor(service: string, account: string) {
    this.key = `${service}/${account}`;
  }

  async getPassword(): Promise<string | null> {
    return readKeyring()[this.key] ?? null;
  }

  async setPassword(password: string): Promise<void> {
    appendFileSync(
      eventsPath,
      JSON.stringify({ operation: 'credential-write' }) + '\n',
    );
    writeFileSync(
      keyringPath,
      JSON.stringify({ ...readKeyring(), [this.key]: password }),
    );
  }

  async deleteCredential(): Promise<boolean> {
    appendFileSync(
      eventsPath,
      JSON.stringify({ operation: 'credential-delete' }) + '\n',
    );
    const entries = readKeyring();
    const present = this.key in entries;
    writeFileSync(
      keyringPath,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(entries).filter(([key]) => key !== this.key),
        ),
      ),
    );
    return present;
  }
}

await mock.module('@napi-rs/keyring', () => ({
  AsyncEntry: IsolatedKeyringEntry,
  findCredentials: async (
    service: string,
  ): Promise<Array<{ account: string; password: string }>> =>
    Object.entries(readKeyring())
      .filter(([key]) => key.startsWith(`${service}/`))
      .map(([key, password]) => ({
        account: key.slice(service.length + 1),
        password,
      })),
}));

await mock.module('open', () => ({
  default: async (): Promise<never> => {
    appendFileSync(eventsPath, JSON.stringify({ operation: 'browser' }) + '\n');
    throw new Error(
      'Browser authentication is forbidden in profile parity tests',
    );
  },
}));

function observe(url: string, headers: Headers, body: string): void {
  const payload = requestSchema.parse(JSON.parse(body));
  const authorization = headers.get('authorization');
  const presentAuthorizationKind = (authorization ?? '').startsWith('Bearer ')
    ? 'bearer'
    : 'other';
  const credential =
    headers.get('authorization')?.replace(/^Bearer /, '') ??
    headers.get('x-api-key') ??
    '';
  appendFileSync(
    requestsPath,
    JSON.stringify({
      url,
      model: payload.model,
      credentialHash: scryptSync(
        credential,
        'synthetic-profile-parity-3448',
        32,
      ).toString('hex'),
      accountId: headers.get('chatgpt-account-id'),
      authorizationKind:
        authorization === null ? 'absent' : presentAuthorizationKind,
      apiKeyPresent: headers.has('x-api-key'),
      oauthBeta: (headers.get('anthropic-beta') ?? '')
        .split(',')
        .some((beta) => beta.trim() === 'oauth-2025-04-20'),
      promptPresent: body.includes('Reply with exactly: PROFILE_PARITY_OK'),
    }) + '\n',
  );
}

function responseEvents(): ReadonlyArray<Record<string, unknown>> {
  return [
    {
      type: 'response.created',
      response: { id: 'resp_parity', status: 'in_progress' },
    },
    {
      type: 'response.output_text.delta',
      item_id: 'msg_parity',
      output_index: 0,
      content_index: 0,
      delta: 'PROFILE_PARITY_OK',
    },
    {
      type: 'response.completed',
      response: {
        id: 'resp_parity',
        status: 'completed',
        output: [],
        usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
      },
    },
  ];
}

class IsolatedWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readyState = 0;
  private readonly url: string;
  private readonly headers: Headers;
  private readonly fragments: Uint8Array[] = [];

  constructor(url: string, options: { headers: Record<string, string> }) {
    super();
    if (url !== 'wss://chatgpt.com/backend-api/codex/responses') {
      const endpoint = new URL(url);
      observeUnexpectedNetwork(endpoint, 'websocket', 'CONNECT');
      throw new Error(
        `Unexpected network endpoint: ${endpoint.hostname}${endpoint.pathname}`,
      );
    }
    this.url = url;
    this.headers = new Headers(options.headers);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open');
    });
  }

  send(
    data: Uint8Array,
    options: { fin: boolean },
    callback: (error?: Error) => void,
  ): void {
    this.fragments.push(data);
    if (!options.fin) {
      callback();
      return;
    }
    const body = Buffer.concat(this.fragments).toString('utf8');
    this.fragments.splice(0);
    observe(this.url, this.headers, body);
    callback();
    queueMicrotask(() => {
      for (const event of responseEvents())
        this.emit('message', Buffer.from(JSON.stringify(event)), false);
    });
  }

  close(): void {
    this.readyState = 3;
  }

  terminate(): void {
    this.close();
  }
}

await mock.module(
  '../../../../providers/src/openai-responses/responses-ws-module.js',
  () => ({ default: IsolatedWebSocket }),
);

function anthropicStream(model: string): string {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_parity',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'PROFILE_PARITY_OK' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 3 },
    },
    { type: 'message_stop' },
  ];
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}

async function interceptedFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.protocol === 'data:') return localFetch(request);
  if (request.method !== 'POST') {
    observeUnexpectedNetwork(url, 'http', request.method);
    throw new Error(
      `Unexpected network request: ${request.method} ${url.hostname}${url.pathname}`,
    );
  }
  if (!httpEndpoints.includes(request.url)) {
    observeUnexpectedNetwork(url, 'http', request.method);
    throw new Error(
      `Unexpected network endpoint: ${url.hostname}${url.pathname}`,
    );
  }
  const body = await request.text();
  observe(request.url, request.headers, body);
  let stream: string;
  if (url.hostname === 'api.anthropic.com' && url.pathname === '/v1/messages') {
    stream = anthropicStream(requestSchema.parse(JSON.parse(body)).model);
  } else if (
    url.hostname === 'api.openai.com' &&
    url.pathname === '/v1/chat/completions'
  ) {
    const chunk = {
      id: 'chatcmpl_parity',
      object: 'chat.completion.chunk',
      created: 1,
      model: requestSchema.parse(JSON.parse(body)).model,
    };
    stream =
      [
        {
          ...chunk,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'PROFILE_PARITY_OK' },
              finish_reason: null,
            },
          ],
        },
        {
          ...chunk,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join('') + 'data: [DONE]\n\n';
  } else {
    stream = responseEvents()
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('');
  }
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

globalThis.fetch = Object.assign(interceptedFetch, {
  preconnect: (): void => undefined,
});

function isAsyncBody(body: unknown): body is AsyncIterable<unknown> {
  return (
    typeof body === 'object' && body !== null && Symbol.asyncIterator in body
  );
}

async function readDispatchBody(body: unknown): Promise<string> {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (!isAsyncBody(body)) throw new Error('Unexpected fixture upload body');
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(chunk);
    else throw new Error('Unexpected fixture upload chunk');
  }
  return Buffer.concat(chunks).toString('utf8');
}

const packageRequire = createRequire(
  createRequire(import.meta.url).resolve('undici/package.json'),
);
const nativeUndici: typeof undici = packageRequire('./');
const nativeDispatch = nativeUndici.Agent.prototype.dispatch;
const mockTransport = new nativeUndici.Agent();
mockTransport.dispatch = nativeDispatch;
const network = new nativeUndici.MockAgent({ agent: mockTransport });
network.disableNetConnect();
for (const endpoint of httpEndpoints) {
  const url = new URL(endpoint);
  network
    .get(url.origin)
    .intercept({ path: url.pathname, method: 'POST' })
    .reply(
      200,
      async (options) => {
        const response = await interceptedFetch(endpoint, {
          method: 'POST',
          headers:
            options.headers === undefined
              ? undefined
              : Object.fromEntries(new nativeUndici.Headers(options.headers)),
          body: await readDispatchBody(options.body),
        });
        return response.text();
      },
      { headers: { 'content-type': 'text/event-stream' } },
    )
    .persist();
}
nativeUndici.Agent.prototype.dispatch = function (options, handler): boolean {
  const url = new URL(options.path, options.origin);
  if (options.method !== 'POST' || !httpEndpoints.includes(url.href)) {
    observeUnexpectedNetwork(url, 'http', options.method);
    throw new Error(
      `Unexpected network endpoint: ${url.hostname}${url.pathname}`,
    );
  }
  return network.dispatch(options, handler);
};
