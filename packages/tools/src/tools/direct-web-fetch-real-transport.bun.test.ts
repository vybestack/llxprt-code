/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-transport cancellation coverage for DirectWebFetchTool.
 *
 * The server paces large bodies and observes whether each connection was cancelled
 * before completion. The tool runs the real global fetch and the real bounded
 * acquisition path; no fetch is imported and nothing is stubbed.
 */

import type http from 'node:http';
import { describe, it, expect } from 'bun:test';
import { DirectWebFetchTool } from './direct-web-fetch.js';
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

describe('DirectWebFetchTool real transport cancellation', () => {
  it('disposes all three retryable 503 responses when retries are exhausted', async () => {
    let hits = 0;
    let closedAttempts = 0;
    const closedBeforeNextRequest: boolean[] = [];
    const states: ConnectionState[] = [];
    const server = await loopback.startServer((_req, res) => {
      hits++;
      if (hits > 1) {
        closedBeforeNextRequest.push(closedAttempts === hits - 1);
      }
      const state: ConnectionState = {
        completed: false,
        canceled: false,
        writerStopped: false,
      };
      states.push(state);
      loopback.trackWriter(
        (async () => {
          await trackConnection(res, state);
          closedAttempts++;
        })(),
      );
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.write('partial-error-body');
      loopback.trackWriter(pacedWrite(res, state, 300));
    });

    const tool = new DirectWebFetchTool(createToolHost());
    const result = await tool
      .build({ url: loopback.serverUrl(server), format: 'text' })
      .execute(new AbortController().signal);
    await loopback.settleWriters();

    expect(result.error?.message).toContain('503');
    expect(result.llmContent).not.toContain('partial-error-body');
    expect(hits).toBe(3);
    expect(closedBeforeNextRequest).toEqual([true, true]);
    expect(states).toEqual([
      { completed: false, canceled: true, writerStopped: true },
      { completed: false, canceled: true, writerStopped: true },
      { completed: false, canceled: true, writerStopped: true },
    ]);
  });
});
