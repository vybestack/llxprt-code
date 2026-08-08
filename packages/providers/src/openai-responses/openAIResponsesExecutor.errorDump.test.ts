/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the OpenAI Responses error-response dump (issue #3140).
 *
 * AC4: When dumpcontext is 'on' or 'error', a non-2xx Responses reply produces
 *      a response dump containing the HTTP status and the raw error body,
 *      linked to the request dump when one exists.
 *
 * Only the fetch boundary is faked. The real executor, the real SSE parser,
 * and the real dump filesystem writer all run. Dump files are cleaned up after
 * each test.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { Storage } from '@vybestack/llxprt-code-storage';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

// Sandbox the config home before Storage.getGlobalCacheDir() is evaluated, so
// these tests never read, write, or delete inside the real user cache dir.
const TEST_CONFIG_HOME = path.join(
  os.tmpdir(),
  `llxprt-errordump-test-${process.pid}`,
);
const originalConfigHome = process.env['LLXPRT_CONFIG_HOME'];
const originalCacheHome = process.env['LLXPRT_CACHE_HOME'];
delete process.env['LLXPRT_CACHE_HOME'];
process.env['LLXPRT_CONFIG_HOME'] = TEST_CONFIG_HOME;

const DUMP_DIR = path.join(Storage.getGlobalCacheDir(), 'dumps');

afterAll(async () => {
  await fs.rm(TEST_CONFIG_HOME, { recursive: true, force: true });
  if (originalConfigHome === undefined) {
    delete process.env['LLXPRT_CONFIG_HOME'];
  } else {
    process.env['LLXPRT_CONFIG_HOME'] = originalConfigHome;
  }
  if (originalCacheHome !== undefined) {
    process.env['LLXPRT_CACHE_HOME'] = originalCacheHome;
  }
});

interface FetchMock {
  readonly calls: { count: number };
  restore(): void;
}

function installFetch(
  handler: (callIndex: number) => Response | Promise<Response>,
): FetchMock {
  const original = globalThis.fetch;
  const calls = { count: 0 };
  globalThis.fetch = (() => {
    const index = calls.count;
    calls.count += 1;
    return Promise.resolve(handler(index));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function errorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function buildNormalizedOptions(
  ephemerals: Record<string, unknown>,
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'test-runtime',
  });
  const config = createRuntimeConfigStub(settings, {});
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: ephemerals,
    fallbackRuntimeId: 'test-runtime',
  });
  return {
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
    ],
    settings,
    config,
    runtime,
    invocation,
    userMemory: undefined,
    tools: undefined,
    metadata: {},
    resolved: {
      model: 'gpt-5',
      baseURL: 'https://api.openai.com/v1',
      authToken: 'test-token',
    },
  } as unknown as NormalizedGenerateChatOptions;
}

function buildDeps(): ResponsesExecutorDeps {
  return {
    providerName: 'openai-responses',
    logger: {
      debug: () => undefined,
    } as unknown as ResponsesExecutorDeps['logger'],
    getProviderBaseURL: () => 'https://api.openai.com/v1',
    getCustomHeaders: () => undefined,
    isCodexBaseURL: () => false,
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => 'test-token',
    generateSyntheticCallId: () => 'call_synthetic_test',
    shouldRetryOnError: () => false,
    getDefaultModel: () => 'gpt-5',
    getGlobalConfig: () => undefined,
  };
}

async function readJsonDump(
  filename: string,
): Promise<Record<string, unknown>> {
  const content = await fs.readFile(path.join(DUMP_DIR, filename), 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function snapshotFiles(): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(DUMP_DIR));
  } catch {
    return new Set();
  }
}

async function newFilesSince(before: Set<string>): Promise<string[]> {
  const after = await snapshotFiles();
  return [...after].filter((f) => !before.has(f));
}

/**
 * Drains the stream and returns the error it threw. A completed stream is a
 * contract violation for every test in this file (all drive a non-2xx reply),
 * so it fails here with a diagnostic message rather than leaking `undefined`
 * into a downstream assertion.
 */
async function drainExpectingError(
  options: NormalizedGenerateChatOptions,
): Promise<unknown> {
  try {
    for await (const _chunk of executeOpenAIResponsesRequest(
      options,
      buildDeps(),
    )) {
      void _chunk;
    }
  } catch (error) {
    return error;
  }
  throw new Error(
    'Expected the Responses stream to throw on a non-2xx reply, but it completed successfully',
  );
}

describe('OpenAI Responses error-response dump @issue:3140', () => {
  let fetchMock: FetchMock | undefined;
  const createdFiles: string[] = [];

  beforeEach(() => {
    fetchMock = undefined;
  });

  afterEach(async () => {
    fetchMock?.restore();
    for (const file of createdFiles.splice(0)) {
      await fs.rm(path.join(DUMP_DIR, file), { force: true });
    }
  });

  it("AC4: dumpcontext 'on' writes a linked error-response dump with status and body", async () => {
    const before = await snapshotFiles();
    fetchMock = installFetch(() =>
      errorResponse(
        429,
        { error: { code: 'insufficient_quota', message: 'exhausted' } },
        {
          'Set-Cookie': 'session=secret',
          Authorization: 'Bearer sk-leaked',
          'Retry-After': '1',
        },
      ),
    );
    const options = buildNormalizedOptions({
      dumpcontext: 'on',
      retries: 1,
      retrywait: 0,
    });

    const caught = await drainExpectingError(options);

    expect(caught).toBeInstanceOf(Error);
    expect(fetchMock.calls.count).toBe(1);

    const fresh = await newFilesSince(before);
    createdFiles.push(...fresh);

    const requestFile = fresh.find((f) => f.endsWith('-request.json'));
    const responseFile = fresh.find((f) => f.endsWith('-response.json'));
    expect(requestFile).toBeDefined();
    expect(responseFile).toBeDefined();

    const responseDump = await readJsonDump(responseFile!);
    expect(responseDump['relatedRequestFile']).toBe(requestFile);

    const responseBody = responseDump['response'] as {
      body?: {
        status?: number;
        headers?: Record<string, string>;
        body?: string;
      };
    };
    expect(responseBody.body?.status).toBe(429);
    expect(responseBody.body?.body).toContain('insufficient_quota');

    // Redaction: credential-bearing values must not leak, but the header
    // names must survive and diagnostic headers must be readable — capturing
    // Retry-After is a core reason the dump exists.
    const dumpedHeaders = responseBody.body?.headers ?? {};
    expect(dumpedHeaders['set-cookie']).toBe('[REDACTED]');
    expect(dumpedHeaders['authorization']).toBe('[REDACTED]');
    expect(JSON.stringify(dumpedHeaders)).not.toContain('secret');
    expect(JSON.stringify(dumpedHeaders)).not.toContain('sk-leaked');
    expect(dumpedHeaders['retry-after']).toBe('1');
  });

  it("AC4: dumpcontext 'error' writes both request and linked error-response dump", async () => {
    const before = await snapshotFiles();
    fetchMock = installFetch(() =>
      errorResponse(500, { error: { message: 'Internal error' } }),
    );
    const options = buildNormalizedOptions({
      dumpcontext: 'error',
      retries: 1,
      retrywait: 0,
    });

    const caught = await drainExpectingError(options);

    expect(caught).toBeInstanceOf(Error);

    const fresh = await newFilesSince(before);
    createdFiles.push(...fresh);

    const requestFile = fresh.find((f) => f.endsWith('-request.json'));
    const responseFile = fresh.find((f) => f.endsWith('-response.json'));
    expect(requestFile).toBeDefined();
    expect(responseFile).toBeDefined();

    const responseDump = await readJsonDump(responseFile!);
    expect(responseDump['relatedRequestFile']).toBe(requestFile);
    const responseBody = responseDump['response'] as {
      body?: { status?: number; body?: string };
    };
    expect(responseBody.body?.status).toBe(500);
    expect(responseBody.body?.body).toContain('Internal error');
  });

  it("AC4: dumpcontext 'off' writes NO dump", async () => {
    const before = await snapshotFiles();
    fetchMock = installFetch(() =>
      errorResponse(429, { error: { code: 'insufficient_quota' } }),
    );
    const options = buildNormalizedOptions({
      dumpcontext: 'off',
      retries: 1,
      retrywait: 0,
    });

    await drainExpectingError(options);

    const fresh = await newFilesSince(before);
    createdFiles.push(...fresh);
    expect(fresh).toHaveLength(0);
  });

  it('a FAILING dump does not mask or alter the original API error', async () => {
    // Make every dump write fail for real: replacing the dumps directory with
    // a regular file makes fs.mkdir(dumpDir, { recursive: true }) reject.
    await fs.rm(DUMP_DIR, { recursive: true, force: true });
    await fs.mkdir(path.dirname(DUMP_DIR), { recursive: true });
    await fs.writeFile(DUMP_DIR, 'not a directory', 'utf-8');

    try {
      fetchMock = installFetch(() =>
        errorResponse(429, {
          error: { code: 'insufficient_quota', message: 'exhausted' },
        }),
      );
      const options = buildNormalizedOptions({
        dumpcontext: 'on',
        retries: 1,
        retrywait: 0,
      });

      const caught = await drainExpectingError(options);

      // The caller still receives the original API error verbatim.
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(
        'Quota or billing limit exhausted: exhausted. Retrying will not help — resolve your quota or billing limits',
      );
      expect(await fs.stat(DUMP_DIR).then((s) => s.isFile())).toBe(true);
    } finally {
      await fs.rm(DUMP_DIR, { force: true });
    }
  });
});
