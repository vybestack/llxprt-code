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
  shouldSuppressContent,
  type ObservationSessionContext,
} from './jspWiring.js';
import type { JspPostResult } from './jspPublisher.js';
import type { JspSnapshotDocument, JspBoundDocument } from './jspDocuments.js';
import { todoEvents } from '@vybestack/llxprt-code-core';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OK: JspPostResult = { kind: 'ok' };

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
    // the system temp directory on every run. Use allSettled so a single
    // rejection does not abandon cleanup of the remaining directories.
    const dirs = tempDirs.splice(0);
    await Promise.allSettled(
      dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
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
      register: vi.fn(() => Promise.resolve(OK)),
      publish: vi.fn(() => Promise.resolve(OK)),
      heartbeat: vi.fn(() => Promise.resolve(OK)),
    });
    expect(producer).toBeNull();
  });

  it('returns a started producer when bootstrap is valid', async () => {
    const register = vi.fn(
      (_snapshot: JspSnapshotDocument): Promise<JspPostResult> =>
        Promise.resolve(OK),
    );
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
        register,
        publish: vi.fn(
          (_doc: JspBoundDocument): Promise<JspPostResult> =>
            Promise.resolve(OK),
        ),
        heartbeat: vi.fn((): Promise<JspPostResult> => Promise.resolve(OK)),
      },
    );
    expect(producer).not.toBeNull();
    // Settle the pending registration so no dangling promise remains.
    await producer?.flush();
    expect(register).toHaveBeenCalledTimes(1);
    // The register call must carry a snapshot document, not an inert stub.
    const snapshotArg = register.mock.calls[0][0];
    expect(snapshotArg.kind).toBe('snapshot');
    expect(snapshotArg.agent_id).toBe('agent-alex');
    producer?.stop();
  });

  it('suppresses assistant message text when noContent is enabled via env', async () => {
    process.env.LLXPRT_JSP_NO_CONTENT = 'true';
    const published: unknown[] = [];
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
        register: vi.fn(() => Promise.resolve(OK)),
        publish: vi.fn((doc) => {
          published.push(doc);
          return Promise.resolve(OK);
        }),
        heartbeat: vi.fn(() => Promise.resolve(OK)),
      },
    );
    expect(producer).not.toBeNull();
    await producer?.flush();
    producer?.observeAssistantMessageDisplayed('Secret reply', 9999);
    await producer?.flush();
    // With noContent on, the published assistant message event must carry an
    // empty content while the committed_ms timestamp still publishes.
    const messageDoc = published.find(
      (doc) =>
        typeof doc === 'object' &&
        doc !== null &&
        'event' in doc &&
        (doc as { event: { type: string } }).event.type ===
          'assistant_message.displayed',
    );
    expect(messageDoc).toBeDefined();
    expect((messageDoc as { event: { content: string } }).event.content).toBe(
      '',
    );
    expect(
      (messageDoc as { event: { committed_ms: number } }).event.committed_ms,
    ).toBe(9999);
    producer?.stop();
    delete process.env.LLXPRT_JSP_NO_CONTENT;
  });
});

describe('shouldSuppressContent', () => {
  it('returns false when the env var is absent', () => {
    delete process.env.LLXPRT_JSP_NO_CONTENT;
    expect(shouldSuppressContent()).toBe(false);
  });

  it('returns true when the env var is "true" or "1"', () => {
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: 'true' })).toBe(true);
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: '1' })).toBe(true);
  });

  it('returns false for any other value', () => {
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: 'false' })).toBe(
      false,
    );
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: '0' })).toBe(false);
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: 'yes' })).toBe(false);
  });
});
