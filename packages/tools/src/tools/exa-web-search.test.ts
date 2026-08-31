/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-loopback behavioral tests for ExaWebSearchTool.
 *
 * The tool posts to the fixed production https://mcp.exa.ai/mcp origin. A
 * temporary URL router in front of the saved real native fetch rewrites only that
 * origin to a real local server; the server observes and produces all network data.
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import type http from 'node:http';
import { describe, it, expect, beforeEach } from 'bun:test';
import { ExaWebSearchTool } from './exa-web-search.js';
import { ToolErrorType } from '../types/tool-error.js';
import {
  collectRequestBody,
  createKeyStorage,
  createLoopbackHarness,
} from '../test-utils/loopback-test-helpers.js';

const EXA_ORIGIN = 'https://mcp.exa.ai';
const TRANSPORT_SETTLEMENT_TIMEOUT_MS = 5000;
const loopback = createLoopbackHarness(EXA_ORIGIN);

interface ConnectionState {
  completed: boolean;
  canceled: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Settlement<T> =
  | { readonly settled: true; readonly value: T }
  | { readonly settled: false };

async function settleWithin<T>(
  promise: Promise<T>,
  behavior: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutOutcome = new Promise<Settlement<T>>((resolve) => {
    timeout = setTimeout(
      () => resolve({ settled: false }),
      TRANSPORT_SETTLEMENT_TIMEOUT_MS,
    );
  });

  try {
    const outcome: Settlement<T> = await Promise.race([
      promise.then((value): Settlement<T> => ({ settled: true, value })),
      timeoutOutcome,
    ]);
    if (!outcome.settled) {
      throw new Error(
        `${behavior} did not settle after transport cancellation`,
      );
    }
    return outcome.value;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function trackConnection(
  res: http.ServerResponse,
  state: ConnectionState,
): Promise<void> {
  const socket = res.socket;
  assertNotNull(socket, 'Expected a response socket');
  return new Promise((resolve) => {
    socket.once('close', () => {
      state.canceled = !state.completed;
      resolve();
    });
  });
}

async function writePacedBody(
  res: http.ServerResponse,
  state: ConnectionState,
  totalBytes: number,
): Promise<void> {
  const chunk = Buffer.alloc(64 * 1024, 0x78);
  let written = 0;
  while (written < totalBytes) {
    if (res.destroyed || res.socket?.destroyed === true) {
      return;
    }
    const bytes = Math.min(chunk.byteLength, totalBytes - written);
    res.write(chunk.subarray(0, bytes));
    written += bytes;
    await delay(5);
  }
  if (!res.destroyed && res.socket?.destroyed !== true) {
    state.completed = true;
    res.end();
  }
}

type SearchRpcBody = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: {
    name?: string;
    arguments?: SearchArgs;
  };
};

interface SearchArgs {
  [key: string]: unknown;
}

function parseSearchBody(raw: string): SearchRpcBody {
  const parsed: unknown = JSON.parse(raw);
  if (!isSearchRpcBody(parsed)) {
    throw new Error(
      'Expected the recorded JSON-RPC body to be an object with params',
    );
  }
  return parsed;
}

function isSearchRpcBody(value: unknown): value is SearchRpcBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'params' in value &&
    typeof value.params === 'object'
  );
}

function searchSse(toolName: string, query: string): string {
  return `data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"search for ${toolName}: ${query}"}]}}\n`;
}

describe('ExaWebSearchTool', () => {
  let tool: ExaWebSearchTool;

  beforeEach(() => {
    tool = new ExaWebSearchTool({ keyStorage: createKeyStorage() });
  });

  it('retains its public tool name', () => {
    expect(ExaWebSearchTool.Name).toBe('exa_web_search');
    expect(tool.name).toBe('exa_web_search');
  });

  it('returns the search result content from a local server', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        'data: malformed-json\n' +
          searchSse('web_search_exa', 'successful query'),
      );
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'successful query' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe(
      'search for web_search_exa: successful query',
    );
  });

  it('sends the JSON-RPC method, tool name, query, defaults, and observed headers', async () => {
    let observedUrl = '';
    let method = '';
    let contentType = '';
    let accept = '';
    const captured: { body: SearchRpcBody | null } = { body: null };
    const server = await loopback.startServer(async (req, res) => {
      observedUrl = req.url ?? '';
      method = req.method ?? '';
      contentType = String(req.headers['content-type'] ?? '');
      accept = String(req.headers.accept ?? '');
      const rawBody = await collectRequestBody(req);
      captured.body = parseSearchBody(rawBody);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(searchSse('web_search_exa', 'query'));
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'query' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(method).toBe('POST');
    expect(contentType).toBe('application/json');
    expect(accept).toBe('application/json, text/event-stream');
    const url = new URL(`${EXA_ORIGIN}${observedUrl}`);
    expect(url.pathname).toBe('/mcp');
    expect(url.search).toBe('');
    expect(captured.body).toStrictEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query: 'query',
          type: 'auto',
          numResults: 8,
          livecrawl: 'fallback',
          contextMaxCharacters: 10000,
        },
      },
    });
  });

  it('observes the explicit limits and encoded exaApiKey the server sees', async () => {
    let observedUrl = '';
    const captured: { args: SearchArgs | undefined } = { args: undefined };
    const server = await loopback.startServer(async (req, res) => {
      observedUrl = req.url ?? '';
      const rawBody = await collectRequestBody(req);
      captured.args = parseSearchBody(rawBody).params?.arguments;
      res.end(
        'data: {"result":{"content":[{"type":"text","text":"structured"}]}}\n',
      );
    });
    tool = new ExaWebSearchTool({
      keyStorage: createKeyStorage(async () => 'a+b&c=d'),
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({
        query: 'structured query',
        numResults: 12,
        type: 'deep',
        livecrawl: 'preferred',
        contextMaxCharacters: 2000,
      })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    const url = new URL(`${EXA_ORIGIN}${observedUrl}`);
    expect(url.searchParams.get('exaApiKey')).toBe('a+b&c=d');
    const args = captured.args;
    expect(args?.numResults).toBe(12);
    expect(args?.type).toBe('deep');
    expect(args?.livecrawl).toBe('preferred');
    expect(args?.contextMaxCharacters).toBe(2000);
  });

  it('returns WEB_SEARCH_FAILED with the observed status and message on failure', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('API Failure');
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'error query' })
      .execute(new AbortController().signal);

    expect(result.error?.message).toContain('API Failure');
    expect(result.error?.message).toContain('500');
    expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
  });

  it('resolves the key fresh on each invocation', async () => {
    const capturedUrls: string[] = [];
    const server = await loopback.startServer((req, res) => {
      capturedUrls.push(req.url ?? '');
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('data: {"result":{"content":[{"type":"text","text":""}]}}\n');
    });
    const keyStorage = createKeyStorage(async () => null);
    tool = new ExaWebSearchTool({ keyStorage });
    loopback.installFetchRouter(server);

    await tool
      .build({ query: 'first query' })
      .execute(new AbortController().signal);
    keyStorage.resolveKey = async () => 'new-key';
    await tool
      .build({ query: 'second query' })
      .execute(new AbortController().signal);

    expect(capturedUrls[0]).not.toContain('exaApiKey');
    expect(capturedUrls[1]).toContain('exaApiKey=new-key');
  });

  it('returns the no-results behavior for an empty body', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('');
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'nothing' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe(
      'No search results found. Please try a different query.',
    );
  });

  it('does not send a request when the caller signal is already aborted', async () => {
    let hits = 0;
    const server = await loopback.startServer((_req, res) => {
      hits++;
      res.end(searchSse('web_search_exa', 'unused'));
    });
    loopback.installFetchRouter(server);
    const controller = new AbortController();
    controller.abort();

    const result = await tool
      .build({ query: 'pre-aborted' })
      .execute(controller.signal);

    expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
    expect(result.error?.message).toMatch(/abort/i);
    expect(hits).toBe(0);
  });

  it('cancels an in-flight request when the caller signal aborts', async () => {
    const state: ConnectionState = { completed: false, canceled: false };
    const responseStarted = Promise.withResolvers<void>();
    let connectionClosed: Promise<void> | undefined;
    let hits = 0;
    const server = await loopback.startServer((_req, res) => {
      hits++;
      connectionClosed = trackConnection(res, state);
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write('in-flight-partial-marker');
      responseStarted.resolve();
      loopback.trackWriter(writePacedBody(res, state, 4 * 1024 * 1024));
    });
    loopback.installFetchRouter(server);
    const controller = new AbortController();
    const execution = tool
      .build({ query: 'in-flight abort' })
      .execute(controller.signal);
    await responseStarted.promise;

    controller.abort();
    const result = await settleWithin(execution, 'in-flight caller abort');
    if (connectionClosed !== undefined) {
      await settleWithin(connectionClosed, 'server response cancellation');
    }
    await loopback.settleWriters();

    expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
    expect(result.error?.message).toMatch(/abort/i);
    expect(result.llmContent).not.toContain('in-flight-partial-marker');
    expect(hits).toBe(1);
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('parses a chunked success body exactly at the 4 MiB search budget', async () => {
    const limit = 4 * 1024 * 1024;
    const prefix = searchSse('web_search_exa', 'exact-limit-result');
    const payload = prefix + ' '.repeat(limit - Buffer.byteLength(prefix));
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      for (let offset = 0; offset < payload.length; offset += 64 * 1024) {
        res.write(payload.slice(offset, offset + 64 * 1024));
      }
      res.end();
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'exact limit' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe(
      'search for web_search_exa: exact-limit-result',
    );
  });

  it('rejects a declared body over 4 MiB, cancels transport, and returns no partial body', async () => {
    const state: ConnectionState = { completed: false, canceled: false };
    let connectionClosed: Promise<void> | undefined;
    const server = await loopback.startServer((_req, res) => {
      connectionClosed = trackConnection(res, state);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(4 * 1024 * 1024 + 1),
      });
      const marker = 'declared-partial-marker';
      res.write(marker);
      loopback.trackWriter(
        writePacedBody(
          res,
          state,
          4 * 1024 * 1024 + 1 - Buffer.byteLength(marker),
        ),
      );
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'declared overflow' })
      .execute(new AbortController().signal);
    if (connectionClosed !== undefined) {
      await settleWithin(connectionClosed, 'server response cancellation');
    }
    await loopback.settleWriters();

    expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
    expect(result.error?.message).toMatch(/exceeds/i);
    expect(result.llmContent).not.toContain('declared-partial-marker');
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('rejects observed 4 MiB overflow, cancels transport, and returns no partial body', async () => {
    const state: ConnectionState = { completed: false, canceled: false };
    let connectionClosed: Promise<void> | undefined;
    const server = await loopback.startServer((_req, res) => {
      connectionClosed = trackConnection(res, state);
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      const marker = 'observed-partial-marker';
      res.write(marker);
      loopback.trackWriter(
        writePacedBody(res, state, 5 * 1024 * 1024 - Buffer.byteLength(marker)),
      );
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'observed overflow' })
      .execute(new AbortController().signal);
    if (connectionClosed !== undefined) {
      await settleWithin(connectionClosed, 'server response cancellation');
    }
    await loopback.settleWriters();

    expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
    expect(result.error?.message).toMatch(/exceeds/i);
    expect(result.llmContent).not.toContain('observed-partial-marker');
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('fails atomically when a non-success body exceeds the budget and preserves the status', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(500, { 'content-type': 'application/octet-stream' });
      res.write(Buffer.alloc(4 * 1024 * 1024 + 1, 0x78));
      res.end();
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'overflow-error' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
    expect(result.error?.message).toMatch(/exceeds/i);
    expect(result.error?.message).toContain('500');
  });
});
