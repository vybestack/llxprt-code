/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-loopback behavioral tests for DirectWebFetchTool.
 *
 * Every transport test uses a real local HTTP server: the server produces status
 * lines, headers, bodies (whole, chunked, and paced), and observes the exact
 * request URL, headers, and aborted connections. No fetch package is imported and
 * no direct-value Response stub is used.
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import type http from 'node:http';
import { describe, it, expect, beforeEach } from 'bun:test';
import { DirectWebFetchTool } from './direct-web-fetch.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { IToolHost } from '../index.js';
import { createLoopbackHarness } from '../test-utils/loopback-test-helpers.js';

const loopback = createLoopbackHarness();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createToolHost(): IToolHost {
  return {
    getTargetDir: () => '/tmp',
    getWorkspaceRoots: () => ['/tmp'],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths: string[]) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),

    getFileFilteringRespectLlxprtIgnore: () => true,
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
  };
}

interface ConnectionState {
  completed: boolean;
  canceled: boolean;
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

async function pacedWrite(
  res: http.ServerResponse,
  state: ConnectionState,
  chunks: number,
  chunkBytes = 256,
  gapMs = 10,
): Promise<void> {
  for (let i = 0; i < chunks; i++) {
    if (res.writableEnded || res.destroyed || res.socket?.destroyed === true) {
      res.destroy();
      return;
    }
    res.write('x'.repeat(chunkBytes));
    if (i < chunks - 1) {
      await delay(gapMs);
    }
  }
  if (!res.writableEnded && res.socket?.destroyed !== true) {
    state.completed = true;
    res.end();
  }
}

const HTML_FIXTURE =
  '<html><head><style>.x{color:red}</style></head><body>' +
  '<h1>Hello &amp; goodbye</h1><p>World <b>bold</b></p>' +
  '<script>var hidden = 1;</script></body></html>';

describe('DirectWebFetchTool', () => {
  let tool: DirectWebFetchTool;

  beforeEach(() => {
    tool = new DirectWebFetchTool(createToolHost());
  });

  it('returns the complete bounded body for a local 2xx success', async () => {
    const payload = 'x'.repeat(2048);
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(payload);
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe(payload);
  });

  it('sends the exact GET request contract for every format', async () => {
    interface ObservedRequest {
      readonly url: string;
      readonly method: string;
      readonly body: string;
      readonly accept: string;
      readonly userAgent: string;
      readonly language: string;
    }

    const expectedRequests: ReadonlyArray<
      ObservedRequest & {
        readonly format: 'text' | 'markdown' | 'html';
      }
    > = [
      {
        format: 'text',
        url: '/page?format=text',
        method: 'GET',
        body: '',
        accept:
          'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        language: 'en-US,en;q=0.9',
      },
      {
        format: 'markdown',
        url: '/page?format=markdown',
        method: 'GET',
        body: '',
        accept:
          'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        language: 'en-US,en;q=0.9',
      },
      {
        format: 'html',
        url: '/page?format=html',
        method: 'GET',
        body: '',
        accept:
          'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        language: 'en-US,en;q=0.9',
      },
    ];
    const observedRequests: ObservedRequest[] = [];
    const server = await loopback.startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else {
          chunks.push(Buffer.from(String(chunk)));
        }
      }
      observedRequests.push({
        url: req.url ?? '',
        method: req.method ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
        accept: String(req.headers.accept ?? ''),
        userAgent: String(req.headers['user-agent'] ?? ''),
        language: String(req.headers['accept-language'] ?? ''),
      });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    for (const expectedRequest of expectedRequests) {
      const result = await tool
        .build({
          url: loopback.serverUrl(server) + expectedRequest.url.slice(1),
          format: expectedRequest.format,
        })
        .execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
    }

    expect(observedRequests).toStrictEqual(
      expectedRequests.map(({ format: _format, ...request }) => request),
    );
  });

  it('returns the text/html body unchanged for format html', async () => {
    const exact =
      '<div>  a  &lt;b&gt; <span> c </span>  </div>\n  <p> tail </p>';
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(exact);
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'html' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe(exact);
  });

  it('converts HTML to the exact html-to-text default structure', async () => {
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(HTML_FIXTURE);
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe('HELLO & GOODBYE\n\nWorld bold');
  });

  it('preserves the configured Turndown output and removed element list', async () => {
    const html =
      '<meta name="removed"><link rel="removed"><style>.hidden{}</style>' +
      '<script>hidden()</script><h2>Heading</h2><p>Para <em>em</em></p>' +
      '<hr><ul><li>one</li><li>two</li></ul>' +
      '<pre><code>const x = 1;\n</code></pre>';
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'markdown' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe(
      '## Heading\n\nPara *em*\n\n---\n\n-   one\n-   two\n\n```\nconst x = 1;\n```',
    );
  });

  it('returns non-HTML content unchanged for every requested format', async () => {
    const payload = 'plain body 123\nsecond line';
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(payload);
    });

    const formats: Array<'text' | 'markdown' | 'html'> = [
      'text',
      'markdown',
      'html',
    ];
    for (const format of formats) {
      const result = await tool
        .build({ url: loopback.serverUrl(server), format })
        .execute(new AbortController().signal);
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toBe(payload);
    }
  });

  it('returns the empty-body no-content result unchanged', async () => {
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end();
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe('');
  });

  it('rejects an invalid URL protocol before any network call', async () => {
    const result = await tool
      .build({ url: 'ftp://example.com', format: 'text' })
      .execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Invalid URL protocol');
  });

  it('treats a 400 response as terminal and disposes it without returning a partial body', async () => {
    const state: ConnectionState = { completed: false, canceled: false };
    let connectionClosed: Promise<void> | undefined;
    let hits = 0;
    const server = await loopback.startServer((_req, res) => {
      hits++;
      connectionClosed = trackConnection(res, state);
      res.writeHead(400, { 'content-type': 'text/plain' });
      loopback.trackWriter(pacedWrite(res, state, 30));
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);
    if (connectionClosed !== undefined) {
      await connectionClosed;
    }
    await loopback.settleWriters();

    expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
    expect(result.error?.message).toContain('400');
    expect(result.llmContent).not.toContain('xxx');
    expect(hits).toBe(1);
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  for (const status of [401, 403, 429]) {
    it(`treats direct ${status} as terminal, disposes the response, and returns no partial body`, async () => {
      const state: ConnectionState = { completed: false, canceled: false };
      const partialMarker = `partial-${status}-body`;
      let connectionClosed: Promise<void> | undefined;
      let hits = 0;
      const server = await loopback.startServer((_req, res) => {
        hits++;
        connectionClosed = trackConnection(res, state);
        res.writeHead(status, { 'content-type': 'text/plain' });
        res.write(partialMarker);
        loopback.trackWriter(pacedWrite(res, state, 30));
      });

      const result = await tool
        .build({ url: loopback.serverUrl(server), format: 'text' })
        .execute(new AbortController().signal);
      if (connectionClosed !== undefined) {
        await connectionClosed;
      }
      await loopback.settleWriters();

      expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
      expect(result.error?.message).toContain(String(status));
      expect(result.llmContent).not.toContain(partialMarker);
      expect(hits).toBe(1);
      expect(state.canceled).toBe(true);
      expect(state.completed).toBe(false);
    });
  }

  it('uses all three retry attempts and closes each rejected 503 connection before continuing', async () => {
    let hits = 0;
    let closedAttempts = 0;
    const closedBeforeNextRequest: boolean[] = [];
    const rejectedStates: ConnectionState[] = [];
    const server = await loopback.startServer((_req, res) => {
      hits++;
      if (hits > 1) {
        closedBeforeNextRequest.push(closedAttempts === hits - 1);
      }
      if (hits < 3) {
        const state: ConnectionState = { completed: false, canceled: false };
        rejectedStates.push(state);
        loopback.trackWriter(
          (async () => {
            await trackConnection(res, state);
            closedAttempts++;
          })(),
        );
        res.writeHead(503, { 'content-type': 'text/plain' });
        loopback.trackWriter(pacedWrite(res, state, 300));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('recovered');
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);
    await loopback.settleWriters();

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe('recovered');
    expect(hits).toBe(3);
    expect(closedBeforeNextRequest).toStrictEqual([true, true]);
    expect(rejectedStates).toStrictEqual([
      { completed: false, canceled: true },
      { completed: false, canceled: true },
    ]);
  });

  it('aborts before any request when the caller signal is already aborted', async () => {
    let hits = 0;
    const server = await loopback.startServer((_req, res) => {
      hits++;
      res.end('unused');
    });
    const controller = new AbortController();
    controller.abort();

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(controller.signal);

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
    expect(result.error?.message).toMatch(/abort|cancel/i);
    expect(hits).toBe(0);
  });

  it('cancels an in-flight request when the caller aborts', async () => {
    const state: ConnectionState = { completed: false, canceled: false };
    const responseStarted = Promise.withResolvers<void>();
    let connectionClosed: Promise<void> | undefined;
    let hits = 0;
    const server = await loopback.startServer((_req, res) => {
      hits++;
      connectionClosed = trackConnection(res, state);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('started');
      responseStarted.resolve();
      loopback.trackWriter(pacedWrite(res, state, 300, 256, 10));
    });
    const controller = new AbortController();
    const execution = tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(controller.signal);
    await responseStarted.promise;

    controller.abort();
    const result = await execution;
    if (connectionClosed !== undefined) {
      await connectionClosed;
    }
    await loopback.settleWriters();

    expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
    expect(result.error?.message).toMatch(/abort|cancel/i);
    expect(result.llmContent).not.toContain('started');
    expect(hits).toBe(1);
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('enforces the configured timeout and closes the connection without retrying', async () => {
    const state: ConnectionState = { completed: false, canceled: false };
    let connectionClosed: Promise<void> | undefined;
    let hits = 0;
    const server = await loopback.startServer((_req, res) => {
      hits++;
      connectionClosed = trackConnection(res, state);
      res.writeHead(200, { 'content-type': 'text/plain' });
      loopback.trackWriter(pacedWrite(res, state, 200, 4096, 20));
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text', timeout: 1 })
      .execute(new AbortController().signal);
    if (connectionClosed !== undefined) {
      await connectionClosed;
    }
    await loopback.settleWriters();

    expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
    expect(result.error?.message).toMatch(/abort/i);
    expect(result.llmContent).not.toContain('xxx');
    expect(hits).toBe(1);
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('rejects a declared body over 5 MiB, cancels transport, and returns no partial body', async () => {
    const state: ConnectionState = { completed: false, canceled: false };
    let connectionClosed: Promise<void> | undefined;
    const server = await loopback.startServer((_req, res) => {
      connectionClosed = trackConnection(res, state);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': '9999999',
      });
      loopback.trackWriter(pacedWrite(res, state, 200));
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);
    if (connectionClosed !== undefined) {
      await connectionClosed;
    }
    await loopback.settleWriters();

    expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
    expect(result.error?.message).toMatch(/exceeds/i);
    expect(result.llmContent).not.toContain('xxx');
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('succeeds when observed chunked bytes exactly equal the 5 MiB budget', async () => {
    const chunkSize = 64 * 1024;
    const totalChunks = (5 * 1024 * 1024) / chunkSize;
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      for (let i = 0; i < totalChunks; i++) {
        res.write(Buffer.alloc(chunkSize, 0x78));
      }
      res.end();
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent).length).toBe(5 * 1024 * 1024);
  });

  it('cancels observed 5 MiB overflow and returns no partial body', async () => {
    const state: ConnectionState = { completed: false, canceled: false };
    let connectionClosed: Promise<void> | undefined;
    const server = await loopback.startServer((_req, res) => {
      connectionClosed = trackConnection(res, state);
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write('partial-body-marker');
      loopback.trackWriter(pacedWrite(res, state, 21, 256 * 1024, 5));
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);
    if (connectionClosed !== undefined) {
      await connectionClosed;
    }
    await loopback.settleWriters();

    expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
    expect(result.error?.message).toMatch(/exceeds/i);
    expect(result.llmContent).not.toContain('partial-body-marker');
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('retries a connection closed before response headers and returns FETCH_ERROR', async () => {
    let attempts = 0;
    const server = await loopback.startServer((req) => {
      attempts++;
      req.socket.destroy();
    });

    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
    expect(result.error?.message).toMatch(
      /fetch|connection|closed|reset|socket/i,
    );
    expect(attempts).toBe(3);
  });
});
