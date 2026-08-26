/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-transport behavioral tests for DirectWebFetchTool cancellation.
 *
 * This file is intentionally separate from direct-web-fetch.test.ts because
 * that file mocks node-fetch globally via bun:test's vi.mock, which would
 * contaminate this file's real node-fetch usage. Here we exercise the real
 * DirectWebFetchTool against paced local HTTP servers and prove that
 * non-success and oversized responses are cancelled at the transport level
 * before delivery can complete or a retry begins.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, afterEach } from 'bun:test';
import { DirectWebFetchTool } from './direct-web-fetch.js';
import type { IToolHost } from '../index.js';

describe('DirectWebFetchTool real transport', () => {
  const servers: http.Server[] = [];
  const pendingWriters = new Set<Promise<void>>();

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()!;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await Promise.allSettled([...pendingWriters]);
  });

  function trackWriter(writer: Promise<void>): Promise<void> {
    pendingWriters.add(writer);
    void writer.then(
      () => pendingWriters.delete(writer),
      () => pendingWriters.delete(writer),
    );
    return writer;
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function startServer(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  ): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      const onError = (error: Error): void => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError);
        servers.push(server);
        resolve(server);
      });
    });
  }

  function serverUrl(server: http.Server): string {
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/`;
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
      getFileExclusions: () => [],
      getReadManyFilesExclusions: () => [],
      getFileFilteringRespectLlxprtIgnore: () => true,
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
    writerStopped: boolean;
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

  async function pacedWrite(
    res: http.ServerResponse,
    state: ConnectionState,
    chunks: number,
    chunkBytes = 256,
  ): Promise<void> {
    try {
      for (let i = 0; i < chunks; i++) {
        if (
          res.writableEnded ||
          res.destroyed ||
          res.socket?.destroyed === true
        ) {
          return;
        }
        res.write('x'.repeat(chunkBytes));
        await delay(10);
      }
      if (
        !res.writableEnded &&
        !res.destroyed &&
        res.socket?.destroyed !== true
      ) {
        state.completed = true;
        res.end();
      }
    } finally {
      state.writerStopped = true;
    }
  }

  describe('DirectWebFetchTool — real transport cancellation', () => {
    it('cancels a terminal 4xx response instead of allowing delivery to complete', async () => {
      const state: ConnectionState = {
        completed: false,
        canceled: false,
        writerStopped: false,
      };
      let writerDone = Promise.resolve();
      let connectionClosed = Promise.resolve();
      const server = await startServer((_req, res) => {
        connectionClosed = trackConnection(res, state);
        res.writeHead(404, { 'content-type': 'text/plain' });
        writerDone = trackWriter(pacedWrite(res, state, 30));
      });

      const tool = new DirectWebFetchTool(createToolHost());
      const result = await tool
        .build({
          url: serverUrl(server),
          format: 'text',
        })
        .execute(new AbortController().signal);
      await Promise.all([writerDone, connectionClosed]);

      expect(result.error?.message).toContain('404');
      expect(state.completed).toBe(false);
      expect(state.canceled).toBe(true);
      expect(state.writerStopped).toBe(true);
    });

    const observeCancelsARetryable5xxAttemptBeforeTheNextAttemptAndStillReaches2xxAt182 =
      async () => {
        let requestCount = 0;
        let secondStartedAfterCancellation = false;
        const firstState: ConnectionState = {
          completed: false,
          canceled: false,
          writerStopped: false,
        };
        let firstWriterDone = Promise.resolve();
        let firstConnectionClosed = Promise.resolve();
        const server = await startServer((_req, res) => {
          requestCount++;

          if (requestCount === 1) {
            firstConnectionClosed = trackConnection(res, firstState);
            res.writeHead(503, { 'content-type': 'text/plain' });
            firstWriterDone = trackWriter(pacedWrite(res, firstState, 30));
          } else {
            secondStartedAfterCancellation =
              firstState.canceled && firstState.writerStopped;
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('OK after retry');
          }
        });
        const tool = new DirectWebFetchTool(createToolHost());
        const result = await tool
          .build({
            url: serverUrl(server),
            format: 'text',
          })
          .execute(new AbortController().signal);
        await Promise.all([firstWriterDone, firstConnectionClosed]);
        return {
          requestCount,
          secondStartedAfterCancellation,
          firstState,
          result,
        };
      };

    it('cancels a retryable 5xx attempt before the next attempt and still reaches 2xx', async () => {
      const {
        requestCount,
        secondStartedAfterCancellation,
        firstState,
        result,
      } =
        await observeCancelsARetryable5xxAttemptBeforeTheNextAttemptAndStillReaches2xxAt182();
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toBe('OK after retry');
      expect(firstState.completed).toBe(false);
      expect(firstState.canceled).toBe(true);
      expect(firstState.writerStopped).toBe(true);
      expect(secondStartedAfterCancellation).toBe(true);
      expect(requestCount).toBe(2);
    });

    it('cancels an oversized 2xx response before delivery completes', async () => {
      const state: ConnectionState = {
        completed: false,
        canceled: false,
        writerStopped: false,
      };
      let writerDone = Promise.resolve();
      let connectionClosed = Promise.resolve();
      const server = await startServer((_req, res) => {
        connectionClosed = trackConnection(res, state);
        res.writeHead(200, { 'content-type': 'text/plain' });
        writerDone = trackWriter(pacedWrite(res, state, 21, 256 * 1024));
      });

      const tool = new DirectWebFetchTool(createToolHost());
      const result = await tool
        .build({
          url: serverUrl(server),
          format: 'text',
        })
        .execute(new AbortController().signal);
      await Promise.all([writerDone, connectionClosed]);

      expect(result.error?.message).toMatch(/exceeds/i);
      expect(state.completed).toBe(false);
      expect(state.canceled).toBe(true);
      expect(state.writerStopped).toBe(true);
    });
  });
});
