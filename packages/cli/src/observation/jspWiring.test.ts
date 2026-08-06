/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  captureBootstrapEnvPath,
  resolveBootstrapSelection,
  loadBootstrap,
  createObservationProducer,
  createTodoObservationSubscription,
  shouldSuppressContent,
  initializeObservationProducer,
  stopObservationProducer,
  type ObservationSessionContext,
  type BootstrapSelection,
} from './jspWiring.js';
import type { JspPostResult } from './jspPublisher.js';
import type { JspSnapshotDocument, JspBoundDocument } from './jspDocuments.js';
import { todoEvents, FatalConfigError } from '@vybestack/llxprt-code-core';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

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

async function cleanupTempDirs(): Promise<void> {
  const dirs = tempDirs.splice(0);
  await Promise.allSettled(
    dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
}

/**
 * Run a load attempt and capture the thrown error, asserting it is a
 * FatalConfigError with exit code 52. Returns the error so the caller can
 * make message assertions without re-deriving the throw.
 */
function expectFatalBootstrap(fn: () => unknown): FatalConfigError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalConfigError);
    expect((error as FatalConfigError).exitCode).toBe(52);
    return error as FatalConfigError;
  }
  throw new Error('expected loadBootstrap to throw');
}

describe('captureBootstrapEnvPath (process-start capture + scrub, AC13)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    await cleanupTempDirs();
  });

  it('captures and scrubs a non-empty value', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/session/per-process.json';
    expect(captureBootstrapEnvPath()).toBe('/session/per-process.json');
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('returns undefined and still scrubs an empty value', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '';
    expect(captureBootstrapEnvPath()).toBeUndefined();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('returns undefined when absent (no-op scrub)', () => {
    expect(captureBootstrapEnvPath()).toBeUndefined();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });
});

describe('resolveBootstrapSelection (post-parse resolution, AC10–AC14)', () => {
  afterEach(async () => {
    await cleanupTempDirs();
  });

  it('returns null when all sources absent (AC12)', () => {
    expect(
      resolveBootstrapSelection(undefined, undefined, undefined),
    ).toBeNull();
  });

  it('AC10: flag path wins over captured env path', () => {
    const sel = resolveBootstrapSelection(
      '/flag/path.json',
      undefined,
      '/env/named.json',
    );
    expect(sel?.path).toBe('/flag/path.json');
    expect(sel?.source).toBe('--jsp-bootstrap');
  });

  it('AC11: captured env path used when flag absent', () => {
    const sel = resolveBootstrapSelection(
      undefined,
      undefined,
      '/env/path.json',
    );
    expect(sel?.path).toBe('/env/path.json');
    expect(sel?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
  });

  it('transported internal env path wins over captured env path', () => {
    const sel = resolveBootstrapSelection(
      undefined,
      '/transported.json',
      '/captured.json',
    );
    expect(sel?.path).toBe('/transported.json');
    expect(sel?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
  });

  it('empty strings treated as absent', () => {
    expect(resolveBootstrapSelection('', '', '')).toBeNull();
  });
});

describe('loadBootstrap (validation, AC10–AC14)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    await cleanupTempDirs();
  });

  it('returns null for a null selection (AC12)', () => {
    expect(loadBootstrap(null)).toBeNull();
  });

  it('returns parsed bootstrap for a valid env-origin selection', async () => {
    const file = await writeTempFile(
      'bootstrap.json',
      JSON.stringify(validBootstrapJson),
    );
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = file;
    const capturedEnvPath = captureBootstrapEnvPath();
    const selection = resolveBootstrapSelection(
      undefined,
      undefined,
      capturedEnvPath,
    );
    const result = loadBootstrap(selection);
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent-alex');
  });

  it('throws on unreadable bootstrap file (fail fast, exit 52)', () => {
    const missing =
      join(
        tmpdir(),
        'jsp-no-such-file-' + Math.random().toString(36).slice(2),
      ) + '.json';
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = missing;
    const capturedEnvPath = captureBootstrapEnvPath();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
    const selection = resolveBootstrapSelection(
      undefined,
      undefined,
      capturedEnvPath,
    );
    const error = expectFatalBootstrap(() => loadBootstrap(selection));
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(error.message).toContain('could not be read');
  });

  it('throws on malformed bootstrap (fail fast, exit 52)', async () => {
    const file = await writeTempFile('bad.json', '{ not json');
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = file;
    const capturedEnvPath = captureBootstrapEnvPath();
    const selection = resolveBootstrapSelection(
      undefined,
      undefined,
      capturedEnvPath,
    );
    const error = expectFatalBootstrap(() => loadBootstrap(selection));
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(error.message).toContain('malformed JSON');
  });

  it('throws on non-loopback endpoint (insecure, exit 52)', async () => {
    const file = await writeTempFile(
      'insecure.json',
      JSON.stringify({
        ...validBootstrapJson,
        endpoint: 'http://10.0.0.5:9123',
      }),
    );
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = file;
    const capturedEnvPath = captureBootstrapEnvPath();
    const selection = resolveBootstrapSelection(
      undefined,
      undefined,
      capturedEnvPath,
    );
    const error = expectFatalBootstrap(() => loadBootstrap(selection));
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(error.message).toContain('rejected (JSP-E004)');
    // A credential-bearing file's secrets must not leak into the diagnostic.
    expect(error.message).not.toContain('pub-secret-xyz');
    expect(error.message).not.toContain('reg-abc');
  });

  it('throws on wrong protocol version (exit 52)', async () => {
    const file = await writeTempFile(
      'wrong.json',
      JSON.stringify({ ...validBootstrapJson, protocol: 'jsp/2' }),
    );
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = file;
    const capturedEnvPath = captureBootstrapEnvPath();
    const selection = resolveBootstrapSelection(
      undefined,
      undefined,
      capturedEnvPath,
    );
    const error = expectFatalBootstrap(() => loadBootstrap(selection));
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(error.message).toContain('rejected (JSP-E003)');
  });

  it('AC13: scrubbed env stays absent after a failed load', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE =
      join(tmpdir(), 'jsp-missing-' + Math.random().toString(36).slice(2)) +
      '.json';
    const capturedEnvPath = captureBootstrapEnvPath();
    const selection = resolveBootstrapSelection(
      undefined,
      undefined,
      capturedEnvPath,
    );
    expectFatalBootstrap(() => loadBootstrap(selection));
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('AC14: error names --jsp-bootstrap for a flag-origin selection', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/also/not/real.json';
    const capturedEnvPath = captureBootstrapEnvPath();
    const selection = resolveBootstrapSelection(
      '/flag/also-missing.json',
      undefined,
      capturedEnvPath,
    );
    expect(selection?.source).toBe('--jsp-bootstrap');
    const error = expectFatalBootstrap(() => loadBootstrap(selection));
    expect(error.message).toContain('--jsp-bootstrap');
    expect(error.message).not.toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('AC14: rejection error names --jsp-bootstrap for a flag-supplied invalid file', async () => {
    const flagFile = await writeTempFile(
      'flag-bad.json',
      JSON.stringify({ ...validBootstrapJson, protocol: 'jsp/2' }),
    );
    const selection = resolveBootstrapSelection(flagFile, undefined, undefined);
    const error = expectFatalBootstrap(() => loadBootstrap(selection));
    expect(error.message).toContain('--jsp-bootstrap');
    expect(error.message).toContain('rejected (JSP-E003)');
  });

  it('AC14: env-origin error names LLXPRT_JSP_BOOTSTRAP_FILE for internal-env-path transport', () => {
    // Simulate a memory/sandbox-hopped env-origin path: arrived via the hidden
    // internal env-path option, so the resolver marks its source as env.
    const selection = resolveBootstrapSelection(
      undefined,
      '/transported/missing.json',
      undefined,
    );
    expect(selection?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
    const error = expectFatalBootstrap(() => loadBootstrap(selection));
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(error.message).not.toContain('--jsp-bootstrap');
  });

  it('loadBootstrap never touches process.env (pure function)', () => {
    const selection: BootstrapSelection = {
      path: '/does-not-exist.json',
      source: 'LLXPRT_JSP_BOOTSTRAP_FILE',
    };
    expectFatalBootstrap(() => loadBootstrap(selection));
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
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

    expect(observer).toHaveBeenCalledWith('default', todos);

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

describe('initializeObservationProducer (AC15)', () => {
  const origEnv = { ...process.env };
  let captureServer: http.Server | null = null;
  let losingTimeout: ReturnType<typeof setTimeout> | null = null;

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
    delete process.env.LLXPRT_JSP_NO_CONTENT;
  });

  afterEach(async () => {
    await stopObservationProducer();
    if (losingTimeout !== null) {
      clearTimeout(losingTimeout);
      losingTimeout = null;
    }
    await new Promise<void>((resolve) => {
      if (captureServer === null) {
        resolve();
        return;
      }
      captureServer.close(() => resolve());
      captureServer = null;
    });
    process.env = { ...origEnv };
    await cleanupTempDirs();
  });

  it('honours an explicit flag path with no env var set (real producer)', async () => {
    // Spin up a real loopback HTTP capture server. The only way to observe
    // that initializeObservationProducer actually constructed a producer from
    // the flag path — without spying on internal module state — is to see the
    // real registration POST land on the broker endpoint named by the file.
    let resolveRequest!: (req: http.IncomingMessage) => void;
    const firstRequest = new Promise<http.IncomingMessage>((resolve) => {
      resolveRequest = resolve;
    });
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      resolveRequest(req);
    });
    captureServer = server;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;

    const file = await writeTempFile(
      'explicit.json',
      JSON.stringify({
        ...validBootstrapJson,
        endpoint: `http://127.0.0.1:${port}`,
      }),
    );

    const selection = resolveBootstrapSelection(file, undefined, undefined);
    initializeObservationProducer(sessionContext, selection);
    // No env var was ever set, and the loader must not introduce one.
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();

    const timeoutPromise = new Promise<never>((_, reject) => {
      losingTimeout = setTimeout(
        () => reject(new Error('registration POST did not arrive')),
        5_000,
      );
    });
    const received = await Promise.race([firstRequest, timeoutPromise]);
    expect(received.method).toBe('POST');
    expect(received.url).toContain('/register');
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
