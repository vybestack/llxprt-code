/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadBootstrapFromEnv,
  createObservationProducer,
  createTodoObservationSubscription,
  type ObservationSessionContext,
} from './jspWiring.js';
import { todoEvents } from '@vybestack/llxprt-code-core';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const validBootstrapJson = {
  schema: 1,
  protocol: 'jsp/1',
  endpoint: 'http://127.0.0.1:9123/jsp/1',
  registration_id: 'reg-abc',
  publisher_credential: 'pub-secret-xyz',
  agent_id: 'agent-alex',
  lifecycle_generation: 7,
};

const sessionContext: ObservationSessionContext = {
  repository: 'vybestack/llxprt-code',
  path: '/Users/dev/src/llxprt-code',
  agentKind: 'llxprt',
  displayName: 'main-worker',
};

const tempDirs: string[] = [];

async function writeTempFile(name: string, content: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `jsp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const filePath = join(dir, name);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

describe('loadBootstrapFromEnv', () => {
  afterEach(async () => {
    // Each helper call creates a directory; without this they accumulate in
    // the system temp directory on every run.
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns null when env is absent (observation disabled)', () => {
    expect(loadBootstrapFromEnv()).toBeNull();
  });

  it('returns parsed bootstrap when env points to a valid file', async () => {
    const file = await writeTempFile(
      'bootstrap.json',
      JSON.stringify(validBootstrapJson),
    );
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = file;
    const result = loadBootstrapFromEnv();
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent-alex');
  });

  it('throws on malformed bootstrap (fail fast)', async () => {
    const file = await writeTempFile('bad.json', '{ not json');
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = file;
    expect(() => loadBootstrapFromEnv()).toThrow(
      'JSP bootstrap file is malformed JSON',
    );
  });

  it('throws on non-loopback endpoint (insecure)', async () => {
    const file = await writeTempFile(
      'insecure.json',
      JSON.stringify({
        ...validBootstrapJson,
        endpoint: 'http://10.0.0.5:9123',
      }),
    );
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = file;
    expect(() => loadBootstrapFromEnv()).toThrow('JSP bootstrap rejected');
  });

  it('throws on wrong protocol version', async () => {
    const file = await writeTempFile(
      'wrong.json',
      JSON.stringify({ ...validBootstrapJson, protocol: 'jsp/2' }),
    );
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = file;
    expect(() => loadBootstrapFromEnv()).toThrow('JSP bootstrap rejected');
  });
});

describe('createTodoObservationSubscription', () => {
  it('observes canonical todo replacements before UI providers mount', () => {
    const observer = vi.fn();
    const unsubscribe = createTodoObservationSubscription(observer);
    const todos = [
      {
        id: 'todo-1',
        content: 'Native todo',
        status: 'completed' as const,
      },
    ];

    todoEvents.emitTodoUpdated({
      sessionId: 'session-1',
      agentId: 'default',
      todos,
      timestamp: new Date(1000),
    });
    unsubscribe();

    expect(observer).toHaveBeenCalledWith('session-1', 'default', todos);

    // A stale listener on the global emitter would keep publishing after the
    // session is gone, so prove the unsubscribe actually detaches it.
    observer.mockClear();
    todoEvents.emitTodoUpdated({
      sessionId: 'session-1',
      agentId: 'default',
      todos,
      timestamp: new Date(2000),
    });
    expect(observer).not.toHaveBeenCalled();
  });
});

describe('createObservationProducer', () => {
  it('returns null when bootstrap is null (disabled)', () => {
    const producer = createObservationProducer(null, sessionContext, {
      now: () => 1,
      createIdentity: vi.fn(),
      register: vi.fn(),
      publish: vi.fn(),
      heartbeat: vi.fn(),
    });
    expect(producer).toBeNull();
  });

  it('returns a started producer when bootstrap is valid', () => {
    const producer = createObservationProducer(
      {
        schema: 1,
        protocol: 'jsp/1',
        endpoint: 'http://127.0.0.1:9123/jsp/1',
        registrationId: 'reg-abc',
        publisherCredential: 'pub-secret-xyz',
        agentId: 'agent-alex',
        lifecycleGeneration: 7,
      },
      sessionContext,
      {
        now: () => 1,
        createIdentity: vi.fn(() => ({
          agentId: 'agent-alex',
          lifecycleGeneration: 7,
          sourceEpoch: 'ep-x',
          startedAtMs: 1,
          pid: 1,
        })),
        register: vi.fn(() => Promise.resolve(true)),
        publish: vi.fn(() => Promise.resolve(true)),
        heartbeat: vi.fn(() => Promise.resolve(true)),
      },
    );
    expect(producer).not.toBeNull();
    producer?.stop();
  });
});
