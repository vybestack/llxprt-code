/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-loopback behavioral tests for CodeSearchTool.
 *
 * The tool posts to the fixed production https://mcp.exa.ai/mcp origin. A
 * temporary URL router in front of the saved real native fetch rewrites only that
 * origin to a real local loopback server; the server observes and produces all
 * network data.
 */

import type http from 'node:http';
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  CodeSearchTool,
  type CodeSearchToolDependencies,
  type CodeSearchToolParams,
} from './codesearch.js';
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
  if (socket === null) {
    throw new Error('Expected a response socket');
  }
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

type SearchBody = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: {
    name?: string;
    arguments?: {
      query?: string;
      tokensNum?: number;
    };
  };
};

function parseSearchBody(raw: string): SearchBody {
  const parsed: unknown = JSON.parse(raw);
  if (!isSearchBody(parsed)) {
    throw new Error(
      'Expected the recorded JSON-RPC body to be an object with params',
    );
  }
  return parsed;
}

function isSearchBody(value: unknown): value is SearchBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'params' in value &&
    typeof value.params === 'object'
  );
}

function searchSse(text: string): string {
  return `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"${text}"}]}}\n\n`;
}

describe('CodeSearchTool', () => {
  let tool: CodeSearchTool;

  beforeEach(() => {
    tool = new CodeSearchTool({ keyStorage: createKeyStorage() });
  });

  it('accepts a query with the default token setting', () => {
    const params: CodeSearchToolParams = { query: 'test query' };

    const validationError = tool.validateToolParams(params);

    expect(validationError).toBeNull();
  });

  it('returns the code result content from a local search response', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        'data: malformed-json\n' +
          searchSse('Here is some React hooks documentation.'),
      );
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'react hooks' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe('Here is some React hooks documentation.');
  });

  it('sends only the tools query parameter when no API key is available', async () => {
    let observedUrl = '';
    let method = '';
    let contentType = '';
    let accept = '';
    const captured: {
      body: SearchBody | null;
      listenerCounts: Readonly<Record<string, number>> | null;
    } = { body: null, listenerCounts: null };
    const server = await loopback.startServer(async (req, res) => {
      observedUrl = req.url ?? '';
      method = req.method ?? '';
      contentType = String(req.headers['content-type'] ?? '');
      accept = String(req.headers.accept ?? '');
      const raw = await collectRequestBody(req);
      const parsedBody: SearchBody = parseSearchBody(raw);
      captured.body = parsedBody;
      captured.listenerCounts = {
        data: req.listenerCount('data'),
        end: req.listenerCount('end'),
        error: req.listenerCount('error'),
        aborted: req.listenerCount('aborted'),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(searchSse('snippet'));
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'react hooks' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(method).toBe('POST');
    expect(contentType).toBe('application/json');
    expect(accept).toBe('application/json, text/event-stream');
    const url = new URL(`${EXA_ORIGIN}${observedUrl}`);
    expect(url.pathname).toBe('/mcp');
    expect(url.searchParams.size).toBe(1);
    expect(url.searchParams.get('tools')).toBe('get_code_context_exa');
    expect(url.searchParams.has('exaApiKey')).toBe(false);
    expect(captured.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_code_context_exa',
        arguments: { query: 'react hooks', tokensNum: 5000 },
      },
    });
    expect(captured.listenerCounts).toEqual({
      data: 0,
      end: 0,
      error: 0,
      aborted: 0,
    });
  });

  it('observes the encoded exaApiKey in the request URL', async () => {
    let observedUrl = '';
    const server = await loopback.startServer((req, res) => {
      observedUrl = req.url ?? '';
      void collectRequestBody(req);
      res.end(searchSse('ok'));
    });
    tool = new CodeSearchTool({
      keyStorage: createKeyStorage(async () => 'key+with/special chars&'),
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'query' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    const url = new URL(`${EXA_ORIGIN}${observedUrl}`);
    expect(url.searchParams.get('tools')).toBe('get_code_context_exa');
    expect(url.searchParams.get('exaApiKey')).toBe('key+with/special chars&');
  });

  it('caps tokensNum with the settings value when params exceed it', async () => {
    const captured: { body: SearchBody | null } = { body: null };
    const server = await loopback.startServer(async (req, res) => {
      const rawBody = await collectRequestBody(req);
      captured.body = parseSearchBody(rawBody);
      res.end(searchSse('capped'));
    });
    loopback.installFetchRouter(server);
    const settingsService: NonNullable<
      CodeSearchToolDependencies['settingsService']
    > = {
      getSetting: (key: string): unknown => {
        if (key === 'tool-output-max-tokens') {
          return 2000;
        }
        return undefined;
      },
      getSettingsService: () => ({}),
    };
    tool = new CodeSearchTool({
      keyStorage: createKeyStorage(),
      settingsService,
    });

    const result = await tool
      .build({ query: 'test', tokensNum: 4000 })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(captured.body?.params?.arguments?.tokensNum).toBe(2000);
  });

  it('returns WEB_SEARCH-like error content when the local server fails the search', async () => {
    const server = await loopback.startServer((req, res) => {
      void collectRequestBody(req);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
    });
    loopback.installFetchRouter(server);

    const result = await tool
      .build({ query: 'error' })
      .execute(new AbortController().signal);
    const message = String(result.error?.message);

    expect(message).toContain('Internal Server Error');
    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
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
      'No code snippets or documentation found. Please try a different query.',
    );
  });

  it('does not send a request when the caller signal is already aborted', async () => {
    let hits = 0;
    const server = await loopback.startServer((_req, res) => {
      hits++;
      res.end(searchSse('unused'));
    });
    loopback.installFetchRouter(server);
    const controller = new AbortController();
    controller.abort();

    const result = await tool
      .build({ query: 'pre-aborted' })
      .execute(controller.signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
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

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    expect(result.error?.message).toMatch(/abort/i);
    expect(result.llmContent).not.toContain('in-flight-partial-marker');
    expect(hits).toBe(1);
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('parses a chunked success body exactly at the 4 MiB search budget', async () => {
    const limit = 4 * 1024 * 1024;
    const prefix = searchSse('exact-limit-result');
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
    expect(result.llmContent).toBe('exact-limit-result');
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

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
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

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
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

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    expect(result.error?.message).toMatch(/exceeds/i);
    expect(result.error?.message).toContain('500');
  });
});
