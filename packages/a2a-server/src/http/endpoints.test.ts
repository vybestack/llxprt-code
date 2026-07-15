/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import request from 'supertest';
import express from 'express';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import {
  createApp,
  createCoderAgentCard,
  updateCoderAgentCardUrl,
  type AppAgentExecutor,
} from './app.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Server } from 'node:http';
import type { Task as SDKTask } from '@a2a-js/sdk';
import type { TaskMetadata } from '../types.js';
import type { AddressInfo } from 'node:net';
import type { Config } from '@vybestack/llxprt-code-core';
import { createMockConfig } from '../utils/testing_utils.js';

interface EndpointTask {
  id: string;
  task: {
    getMetadata: () => Promise<TaskMetadata>;
  };
  toSDKTask: () => SDKTask;
}

function createEndpointExecutor(): AppAgentExecutor {
  const tasks = new Map<string, EndpointTask>();
  return {
    execute: vi.fn<AppAgentExecutor['execute']>(),
    cancelTask: vi.fn<AppAgentExecutor['cancelTask']>(),
    createTask: vi.fn(
      (id: string, contextId: string, _agentSettings?: unknown) => {
        const metadata = {
          id,
          contextId,
          taskState: 'submitted',
          model: 'gemini-pro',
          mcpServers: [],
          availableTools: [],
        } as TaskMetadata;
        const wrapper = {
          id,
          task: { getMetadata: async () => metadata },
          toSDKTask: () => ({
            id,
            contextId,
            kind: 'task' as const,
            status: { state: 'submitted' as const },
            metadata: { _contextId: contextId },
            history: [],
            artifacts: [],
          }),
        } as EndpointTask;
        tasks.set(id, wrapper);
        return Promise.resolve(wrapper);
      },
    ),
    getTask: (id: string) => tasks.get(id),
    getAllTasks: () => [...tasks.values()],
    reconstruct: vi.fn<AppAgentExecutor['reconstruct']>(),
  };
}

const testWorkspaces: string[] = [];
const openServers: Server[] = [];

function createTestWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-agent-test-'));
  testWorkspaces.push(dir);
  return dir;
}

interface TestFixture {
  app: express.Express;
  server: Server;
  executor: AppAgentExecutor;
  workspacePath: string;
}

let listenAndTrackServerStartupError: ((error: Error) => void) | undefined;

async function listenAndTrackServer(
  app: express.Express,
  configure: (server: Server) => void,
): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const onStartupError = (error: Error): void => {
      reject(error);
    };
    listenAndTrackServerStartupError = onStartupError;
    const server = app.listen(0, () => {
      try {
        configure(server);
        server.removeListener('error', onStartupError);
        resolve(server);
      } catch (error: unknown) {
        server.removeListener('error', onStartupError);
        reject(error);
      }
    });
    openServers.push(server);
    server.once('error', onStartupError);
  });
}

async function createTestServer(
  useDefaultAgentCard = false,
): Promise<TestFixture> {
  const workspacePath = createTestWorkspace();
  const taskStore = new InMemoryTaskStore();
  const agentExecutor = createEndpointExecutor();
  const config = createMockConfig() as Config;
  const agentCard = createCoderAgentCard();
  const app = await createApp({
    ...(useDefaultAgentCard
      ? { createAgentCard: () => agentCard }
      : { agentCard }),
    createStartupContext: async () => ({
      config,
      git: undefined,
      agentExecutor,
      taskStoreForExecutor: taskStore,
      taskStoreForHandler: taskStore,
    }),
    getGitService: async () => undefined,
  });
  const server = await listenAndTrackServer(app, (listeningServer) => {
    const port = (listeningServer.address() as AddressInfo).port;
    updateCoderAgentCardUrl(port, agentCard);
  });
  return { app, server, executor: agentExecutor, workspacePath };
}

/**
 * Result of a tracked close attempt. On genuine failure, the original error
 * (preserving cause/code/stack) is returned so the caller can surface it.
 */
interface TrackedCloseResult {
  readonly success: boolean;
  readonly error?: Error;
}

/**
 * Closes a server and removes it from tracking ONLY on success or when the
 * server was already closed (ERR_SERVER_NOT_RUNNING). If close fails with a
 * genuine error, the server remains tracked so a subsequent cleanup retry
 * can attempt again — preventing silent resource leaks. The genuine error
 * (preserving cause/code/stack) is returned for surfacing.
 */
async function trackedCloseServer(server: Server): Promise<TrackedCloseResult> {
  return new Promise<TrackedCloseResult>((resolve) => {
    server.close((err) => {
      if (err) {
        // ERR_SERVER_NOT_RUNNING means the server was never started or was
        // already closed — this is not a genuine error, so untrack it.
        const code = (err as { code?: string }).code;
        if (code === 'ERR_SERVER_NOT_RUNNING') {
          const index = openServers.indexOf(server);
          if (index >= 0) {
            openServers.splice(index, 1);
          }
          resolve({ success: true });
          return;
        }
        // Genuine close error — preserve the original error (cause/code/stack)
        // by retaining the server in tracking for a retry attempt.
        resolve({ success: false, error: err });
        return;
      }
      const index = openServers.indexOf(server);
      if (index >= 0) {
        openServers.splice(index, 1);
      }
      resolve({ success: true });
    });
  });
}

/**
 * Closes a server immediately (for the try/finally pattern in individual
 * tests). Throws on genuine failure so the test fails rather than silently
 * leaking. ERR_SERVER_NOT_RUNNING is treated as success.
 */
async function closeServer(server: Server): Promise<void> {
  const result = await trackedCloseServer(server);
  if (!result.success) {
    throw result.error ?? new Error('Failed to close test server');
  }
}

function makeCreateTask(app: express.Express, workspacePath: string) {
  return (contextId: string) =>
    request(app)
      .post('/tasks')
      .send({
        contextId,
        agentSettings: {
          kind: 'agent-settings',
          workspacePath,
        },
      })
      .set('Content-Type', 'application/json');
}

afterEach(async () => {
  // Close any servers that were registered but not closed by the test
  // (e.g. when setup failed partway or the test threw before the finally block).
  //
  // Safe contract:
  // - Server tracking is retained until close SUCCEEDS, so a failed server
  //   remains tracked and retryable rather than silently leaked.
  // - All cleanup errors are collected while continuing to process remaining
  //   resources, so one failure does not mask others.
  // - Workspaces belonging to a server that could not be closed are NOT
  //   removed, because a live server may still be reading/writing them.
  // - After cleanup, if any errors occurred, an ordered AggregateError is
  //   thrown so leaks fail the test.
  const errors: unknown[] = [];

  const liveServerCount = openServers.length;
  for (const server of [...openServers]) {
    const result = await trackedCloseServer(server);
    if (!result.success) {
      // Preserve the genuine error (cause/code/stack) for the AggregateError.
      errors.push(
        result.error ?? new Error('Failed to close server (still tracked)'),
      );
    }
  }

  // Only remove workspaces when all servers closed successfully. If any
  // server is still live, its workspace may be in active use; removing it
  // could corrupt in-flight operations or mask the real failure.
  const allServersClosed = openServers.length === 0;
  if (allServersClosed) {
    const failedWorkspaces: string[] = [];
    for (const dir of testWorkspaces) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        errors.push(e);
        failedWorkspaces.push(dir);
      }
    }
    // Retain only the workspaces that failed to delete so a subsequent
    // afterEach retry can attempt them again.
    testWorkspaces.length = 0;
    testWorkspaces.push(...failedWorkspaces);
  } else {
    errors.push(
      new Error(
        `Skipped workspace cleanup: ${openServers.length} server(s) still live ` +
          `(of ${liveServerCount} tracked)`,
      ),
    );
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `${errors.length} cleanup error(s) after test; ${openServers.length} server(s) still tracked`,
    );
  }
});

describe('Agent Server Endpoints', () => {
  it('removes its startup error listener after successful configuration', async () => {
    const server = await listenAndTrackServer(express(), () => {});
    try {
      expect(server.listeners('error')).not.toContain(
        listenAndTrackServerStartupError,
      );
    } finally {
      await closeServer(server);
    }
  });

  it('tracks a listening server before later setup can fail', async () => {
    const app = express();

    let caught: unknown;
    try {
      await listenAndTrackServer(app, () => {
        throw new Error('partial setup failure');
      });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('partial setup failure');
    expect(openServers).toHaveLength(1);
    expect(openServers[0]?.listening).toBe(true);
  });

  it('should start with an empty task list on a fresh app', async () => {
    const { app, server } = await createTestServer();
    try {
      const response = await request(app).get('/tasks/metadata');
      expect(response.status).toBe(204);
    } finally {
      await closeServer(server);
    }
  });

  it('should create a new task via POST /tasks', async () => {
    const { app, server, executor, workspacePath } = await createTestServer();
    try {
      const createTask = makeCreateTask(app, workspacePath);
      const response = await createTask('test-context');
      expect(response.status).toBe(201);
      expect(response.body).toBeTypeOf('string');
      expect(executor.getTask(response.body)).toBeDefined();
    } finally {
      await closeServer(server);
    }
  });

  it('should yield exactly one task after a single POST', async () => {
    const { app, server, workspacePath } = await createTestServer();
    try {
      const createTask = makeCreateTask(app, workspacePath);
      await createTask('single-context');
      const response = await request(app).get('/tasks/metadata');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it('should get metadata for a specific task via GET /tasks/:taskId/metadata', async () => {
    const { app, server, workspacePath } = await createTestServer();
    try {
      const createTask = makeCreateTask(app, workspacePath);
      const createResponse = await createTask('test-context-2');
      const taskId = createResponse.body;
      const response = await request(app).get(`/tasks/${taskId}/metadata`);
      expect(response.status).toBe(200);
      expect(response.body.metadata.id).toBe(taskId);
    } finally {
      await closeServer(server);
    }
  });

  it('should get metadata for all tasks via GET /tasks/metadata', async () => {
    const { app, server, workspacePath } = await createTestServer();
    try {
      const createTask = makeCreateTask(app, workspacePath);
      const createResponse = await createTask('test-context-3');
      const taskId = createResponse.body;
      const response = await request(app).get('/tasks/metadata');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      const taskMetadata = response.body.find(
        (m: TaskMetadata) => m.id === taskId,
      );
      expect(taskMetadata).toBeDefined();
    } finally {
      await closeServer(server);
    }
  });

  it('should return 404 for a non-existent task', async () => {
    const { app, server } = await createTestServer();
    try {
      const response = await request(app).get('/tasks/fake-task/metadata');
      expect(response.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });

  it('should return agent metadata via GET /.well-known/agent-card.json with the current port', async () => {
    const { app, server } = await createTestServer();
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await request(app).get('/.well-known/agent-card.json');
      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Gemini SDLC Agent');
      expect(response.body.url).toBe(`http://localhost:${port}/`);
    } finally {
      await closeServer(server);
    }
  });

  it('keeps overlapping default-path app agent cards isolated', async () => {
    const first = await createTestServer(true);
    const second = await createTestServer(true);
    try {
      const firstPort = (first.server.address() as AddressInfo).port;
      const secondPort = (second.server.address() as AddressInfo).port;
      const [firstResponse, secondResponse] = await Promise.all([
        request(first.app).get('/.well-known/agent-card.json'),
        request(second.app).get('/.well-known/agent-card.json'),
      ]);

      expect(firstResponse.body.url).toBe(`http://localhost:${firstPort}/`);
      expect(secondResponse.body.url).toBe(`http://localhost:${secondPort}/`);
    } finally {
      await Promise.all([
        closeServer(first.server),
        closeServer(second.server),
      ]);
    }
  });
});
