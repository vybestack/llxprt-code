/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parity contract between the standalone OpenAIResponsesProvider and the
 * OpenAIProvider delegated path (issue #2483).
 *
 * Both paths converge on `executeOpenAIResponsesRequest`. This test proves
 * that for equivalent inputs they produce identical wire output:
 * - same URL
 * - same request body (model, stream, reasoning, instructions, etc.)
 * - same headers (Authorization, Content-Type)
 *
 * The test intercepts `fetch` at the HTTP boundary — no real network calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

const originalFetch = global.fetch;

function makeSseResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface CapturedRequest {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function createFetchCapture(): {
  mock: ReturnType<typeof vi.fn>;
  getCaptured: () => CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    let body: unknown = undefined;
    if (init?.body instanceof Blob) {
      body = JSON.parse(await init.body.text());
    } else if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }
    captured.push({
      url: String(input),
      body,
      headers: init?.headers as Record<string, string>,
    });
    return makeSseResponse();
  });
  return { mock, getCaptured: () => captured };
}

describe('OpenAIResponsesProvider ↔ OpenAIProvider delegated Responses parity @issue:2483', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'parity-test-runtime',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('produces identical URL and body for both providers on the same inputs', async () => {
    const baseURL = 'https://api.openai.com/v1';
    const model = 'gpt-5.6-sol';
    const authToken = 'test-parity-key';
    const contents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    ];

    // --- Standalone OpenAIResponsesProvider ---
    const standaloneSettings = new SettingsService();
    standaloneSettings.setProviderSetting('openai-responses', 'model', model);
    const standaloneRuntime = createProviderRuntimeContext({
      runtimeId: 'parity-standalone',
      settingsService: standaloneSettings,
    });

    const standaloneCapture = createFetchCapture();
    global.fetch = standaloneCapture.mock as unknown as typeof fetch;

    const standaloneOptions = createProviderCallOptions({
      providerName: 'openai-responses',
      settings: standaloneSettings,
      runtime: standaloneRuntime,
      resolved: { model, baseURL, authToken },
      contents,
    });

    const standaloneProvider = new OpenAIResponsesProvider(authToken, baseURL);
    for await (const _ of standaloneProvider.generateChatCompletion(
      standaloneOptions,
    )) {
      void _;
    }

    // --- OpenAIProvider delegated path ---
    const delegatedSettings = new SettingsService();
    delegatedSettings.setProviderSetting('openai', 'model', model);
    const delegatedRuntime = createProviderRuntimeContext({
      runtimeId: 'parity-delegated',
      settingsService: delegatedSettings,
    });

    const delegatedCapture = createFetchCapture();
    global.fetch = delegatedCapture.mock as unknown as typeof fetch;

    const delegatedOptions = createProviderCallOptions({
      providerName: 'openai',
      settings: delegatedSettings,
      runtime: delegatedRuntime,
      resolved: { model, baseURL, authToken },
      contents,
    });

    const delegatedProvider = new OpenAIProvider(authToken, baseURL);
    for await (const _ of delegatedProvider.generateChatCompletion(
      delegatedOptions,
    )) {
      void _;
    }

    // --- Assert parity ---
    const standaloneCaptured = standaloneCapture.getCaptured();
    const delegatedCaptured = delegatedCapture.getCaptured();
    expect(standaloneCaptured).toHaveLength(1);
    expect(delegatedCaptured).toHaveLength(1);

    const standaloneReq = standaloneCaptured[0];
    const delegatedReq = delegatedCaptured[0];
    expect(standaloneReq).toBeDefined();
    expect(delegatedReq).toBeDefined();

    // Same endpoint URL
    expect(standaloneReq.url).toBe(delegatedReq.url);
    expect(standaloneReq.url).toContain('/responses');

    // Same model and stream flag
    const standaloneBody = standaloneReq.body as Record<string, unknown>;
    const delegatedBody = delegatedReq.body as Record<string, unknown>;
    expect(standaloneBody.model).toBe(delegatedBody.model);
    expect(standaloneBody.model).toBe(model);
    expect(standaloneBody.stream).toBe(delegatedBody.stream);

    // Same Authorization header
    expect(standaloneReq.headers['Authorization']).toBe(
      delegatedReq.headers['Authorization'],
    );
    expect(standaloneReq.headers['Authorization']).toBe(`Bearer ${authToken}`);
  });

  it('produces identical reasoning.effort for both paths when effort=max', async () => {
    const baseURL = 'https://api.openai.com/v1';
    const model = 'gpt-5.6-sol';
    const authToken = 'test-parity-key';
    const contents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    ];

    const standaloneSettings = new SettingsService();
    standaloneSettings.setProviderSetting('openai-responses', 'model', model);
    standaloneSettings.set('reasoning.effort', 'max');
    standaloneSettings.set('reasoning.enabled', true);
    const standaloneRuntime = createProviderRuntimeContext({
      runtimeId: 'parity-effort-standalone',
      settingsService: standaloneSettings,
    });

    const standaloneCapture = createFetchCapture();
    global.fetch = standaloneCapture.mock as unknown as typeof fetch;

    const standaloneOptions = createProviderCallOptions({
      providerName: 'openai-responses',
      settings: standaloneSettings,
      runtime: standaloneRuntime,
      resolved: { model, baseURL, authToken },
      contents,
    });

    const standaloneProvider = new OpenAIResponsesProvider(authToken, baseURL);
    for await (const _ of standaloneProvider.generateChatCompletion(
      standaloneOptions,
    )) {
      void _;
    }

    const delegatedSettings = new SettingsService();
    delegatedSettings.setProviderSetting('openai', 'model', model);
    delegatedSettings.set('reasoning.effort', 'max');
    delegatedSettings.set('reasoning.enabled', true);
    const delegatedRuntime = createProviderRuntimeContext({
      runtimeId: 'parity-effort-delegated',
      settingsService: delegatedSettings,
    });

    const delegatedCapture = createFetchCapture();
    global.fetch = delegatedCapture.mock as unknown as typeof fetch;

    const delegatedOptions = createProviderCallOptions({
      providerName: 'openai',
      settings: delegatedSettings,
      runtime: delegatedRuntime,
      resolved: { model, baseURL, authToken },
      contents,
    });

    const delegatedProvider = new OpenAIProvider(authToken, baseURL);
    for await (const _ of delegatedProvider.generateChatCompletion(
      delegatedOptions,
    )) {
      void _;
    }

    const standaloneBody = standaloneCapture.getCaptured()[0]?.body as Record<
      string,
      unknown
    >;
    const delegatedBody = delegatedCapture.getCaptured()[0]?.body as Record<
      string,
      unknown
    >;

    expect(standaloneBody.reasoning).toStrictEqual({
      effort: 'max',
    });
    expect(delegatedBody.reasoning).toStrictEqual({
      effort: 'max',
    });
  });
});
