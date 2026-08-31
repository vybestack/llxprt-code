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

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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

const originalConfigHome = process.env['LLXPRT_CONFIG_HOME'];
const originalCacheHome = process.env['LLXPRT_CACHE_HOME'];

/**
 * Per-test sandbox for the dump directory. Each test gets a fresh empty temp
 * config home, so these tests never read, write, or delete inside the real user
 * cache directory, and the env override is scoped to the test rather than to
 * the whole module import (which would leak into anything else resolving cache
 * paths in the same process).
 */
let tempConfigHome: string;

function dumpDir(): string {
  return path.join(Storage.getGlobalCacheDir(), 'dumps');
}

async function listDumpFiles(): Promise<string[]> {
  try {
    return await fs.readdir(dumpDir());
  } catch {
    return [];
  }
}

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
    // Issue #3136: the agent layer owns system-prompt assembly and providers
    // transport it verbatim, so a real chat completion requires this. These
    // cases exercise error dumping, not prompt content.
    systemInstruction: 'test system prompt',
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
    isWebSocketTransportActive: () => false,
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
  const content = await fs.readFile(path.join(dumpDir(), filename), 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

function responseHeaders(response: {
  readonly body?: { readonly headers?: Record<string, string> };
}): Record<string, string> {
  return response.body?.headers ?? {};
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

  beforeEach(async () => {
    fetchMock = undefined;
    tempConfigHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'responses-errordump-'),
    );
    delete process.env['LLXPRT_CACHE_HOME'];
    process.env['LLXPRT_CONFIG_HOME'] = tempConfigHome;
  });

  afterEach(async () => {
    fetchMock?.restore();
    if (originalConfigHome === undefined) {
      delete process.env['LLXPRT_CONFIG_HOME'];
    } else {
      process.env['LLXPRT_CONFIG_HOME'] = originalConfigHome;
    }
    if (originalCacheHome !== undefined) {
      process.env['LLXPRT_CACHE_HOME'] = originalCacheHome;
    }
    await fs.rm(tempConfigHome, { recursive: true, force: true });
  });

  it("AC4: dumpcontext 'on' writes a linked error-response dump with status and body", async () => {
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

    const written = await listDumpFiles();
    const requestFile = written.find((f) => f.endsWith('-request.json'));
    const responseFile = written.find((f) => f.endsWith('-response.json'));
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
    const dumpedHeaders = responseHeaders(responseBody);
    expect(dumpedHeaders['set-cookie']).toBe('[REDACTED]');
    expect(dumpedHeaders['authorization']).toBe('[REDACTED]');
    expect(JSON.stringify(dumpedHeaders)).not.toContain('secret');
    expect(JSON.stringify(dumpedHeaders)).not.toContain('sk-leaked');
    expect(dumpedHeaders['retry-after']).toBe('1');
  });

  it("AC4: dumpcontext 'error' writes both request and linked error-response dump", async () => {
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

    const written = await listDumpFiles();
    const requestFiles = written.filter((f) => f.endsWith('-request.json'));
    const responseFile = written.find((f) => f.endsWith('-response.json'));
    if (requestFiles.length === 0) {
      throw new Error(
        `No -request.json dump written; dump dir contents: ${JSON.stringify(written)}`,
      );
    }
    expect(responseFile).toBeDefined();

    // `retries: 1` means two attempts, each dumping its own request/response
    // pair, and the dump filenames differ only by a random suffix. Pair them by
    // the recorded link rather than by list order, which is not attempt order.
    const responseDump = await readJsonDump(responseFile!);
    expect(requestFiles).toContain(responseDump['relatedRequestFile']);
    const responseBody = responseDump['response'] as {
      body?: { status?: number; body?: string };
    };
    expect(responseBody.body?.status).toBe(500);
    expect(responseBody.body?.body).toContain('Internal error');
  });

  it("AC4: dumpcontext 'off' writes NO dump", async () => {
    fetchMock = installFetch(() =>
      errorResponse(429, { error: { code: 'insufficient_quota' } }),
    );
    const options = buildNormalizedOptions({
      dumpcontext: 'off',
      retries: 1,
      retrywait: 0,
    });

    await drainExpectingError(options);

    expect(await listDumpFiles()).toHaveLength(0);
  });

  it('a FAILING dump does not mask or alter the original API error', async () => {
    // Make every dump write fail for real: replacing the dumps directory with
    // a regular file makes fs.mkdir(dumpDir, { recursive: true }) reject.
    const dumps = dumpDir();
    await fs.mkdir(path.dirname(dumps), { recursive: true });
    await fs.writeFile(dumps, 'not a directory', 'utf-8');

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
    expect(await fs.stat(dumps).then((s) => s.isFile())).toBe(true);
  });
});
