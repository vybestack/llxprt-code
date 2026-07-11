/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import request from 'supertest';
import type express from 'express';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import { createApp, updateCoderAgentCardUrl } from './app.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Server } from 'node:http';
import type { Task as SDKTask } from '@a2a-js/sdk';
import type { TaskMetadata } from '../types.js';
import type { AddressInfo } from 'node:net';
import { logger } from '../utils/logger.js';

interface EndpointTask {
  id: string;
  task: {
    getMetadata: () => Promise<TaskMetadata>;
  };
  toSDKTask: () => SDKTask;
}

function createEndpointExecutor() {
  const tasks = new Map<string, EndpointTask>();
  return {
    execute: vi.fn(),
    cancelTask: vi.fn(),
    createTask: vi.fn((id: string, contextId: string) => {
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
          metadata: {},
          history: [],
          artifacts: [],
        }),
      } as EndpointTask;
      tasks.set(id, wrapper);
      return Promise.resolve(wrapper);
    }),
    getTask: (id: string) => tasks.get(id),
    getAllTasks: () => [...tasks.values()],
    reconstruct: vi.fn(),
  };
}

describe('Agent Server Endpoints', () => {
  let app: express.Express;
  let server: Server;
  let testWorkspace: string;

  const createTask = (contextId: string) =>
    request(app)
      .post('/tasks')
      .send({
        contextId,
        agentSettings: {
          kind: 'agent-settings',
          workspacePath: testWorkspace,
        },
      })
      .set('Content-Type', 'application/json');

  beforeAll(async () => {
    // Create a unique temporary directory for the workspace to avoid conflicts
    testWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-agent-test-'),
    );
    const taskStore = new InMemoryTaskStore();
    const agentExecutor = createEndpointExecutor();
    app = await createApp({
      createStartupContext: async () => ({
        config: {} as never,
        git: undefined,
        agentExecutor: agentExecutor as never,
        taskStoreForExecutor: taskStore,
        taskStoreForHandler: taskStore,
      }),
      getGitService: async () => undefined,
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        updateCoderAgentCardUrl(port);
        resolve();
      });
    });

    // On Windows, give the server a moment to fully initialize
    const initDelay = process.platform === 'win32' ? 100 : 0;
    if (initDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, initDelay));
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    // On Windows, give the server a moment to fully close before cleanup
    const closeDelay = process.platform === 'win32' ? 100 : 0;
    if (closeDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, closeDelay));
    }

    if (testWorkspace) {
      try {
        fs.rmSync(testWorkspace, { recursive: true, force: true });
      } catch (e) {
        logger.warn(`Could not remove temp dir '${testWorkspace}':`, e);
      }
    }
  });

  it(
    'should create a new task via POST /tasks',
    async () => {
      const response = await createTask('test-context');
      expect(response.status).toBe(201);
      expect(response.body).toBeTypeOf('string'); // Should return the task ID
    },
    process.platform === 'win32' ? 12000 : 7000,
  );

  it(
    'should get metadata for a specific task via GET /tasks/:taskId/metadata',
    async () => {
      const createResponse = await createTask('test-context-2');
      const taskId = createResponse.body;
      const response = await request(app).get(`/tasks/${taskId}/metadata`);
      expect(response.status).toBe(200);
      expect(response.body.metadata.id).toBe(taskId);
    },
    process.platform === 'win32' ? 10000 : 6000,
  );

  it('should get metadata for all tasks via GET /tasks/metadata', async () => {
    const createResponse = await createTask('test-context-3');
    const taskId = createResponse.body;
    const response = await request(app).get('/tasks/metadata');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    const taskMetadata = response.body.find(
      (m: TaskMetadata) => m.id === taskId,
    );
    expect(taskMetadata).toBeDefined();
  });

  it('should return 404 for a non-existent task', async () => {
    const response = await request(app).get('/tasks/fake-task/metadata');
    expect(response.status).toBe(404);
  });

  it('should return agent metadata via GET /.well-known/agent-card.json', async () => {
    const response = await request(app).get('/.well-known/agent-card.json');
    const port = (server.address() as AddressInfo).port;
    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Gemini SDLC Agent');
    expect(response.body.url).toBe(`http://localhost:${port}/`);
  });
});
