/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Provider-level tests proving the media.pdf.enabled capability reaches the
 * actual request body through the executor resolution path
 * (invocation ephemeral → getModelBehavior → settings; default enabled)
 * without model-name conditionals (issue #2608).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

const originalFetch = global.fetch;
const mockFetch = vi.fn();

function pdfToolContinuation(): Array<{
  speaker: string;
  blocks: Array<Record<string, unknown>>;
}> {
  return [
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call_pdf_exec',
          name: 'read_file',
          parameters: { absolute_path: 'report.pdf' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call_pdf_exec',
          toolName: 'read_file',
          result: { output: 'Binary content provided (1 item(s)).' },
        },
        {
          type: 'media',
          mimeType: 'application/pdf',
          data: 'JVBERi0xLjQK',
          encoding: 'base64',
          filename: 'report.pdf',
        },
      ],
    },
  ];
}

async function captureRequestBody(
  provider: OpenAIResponsesProvider,
  options: ReturnType<typeof createProviderCallOptions>,
): Promise<Record<string, unknown>> {
  let capturedBody: string | undefined;
  mockFetch.mockImplementation(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.body instanceof Blob) {
        capturedBody = await init.body.text();
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  );

  for await (const _content of provider.generateChatCompletion(options)) {
    // Consume generator
  }

  expect(capturedBody).toBeDefined();
  if (typeof capturedBody !== 'string') {
    throw new Error('Request body was not captured');
  }
  const parsed: unknown = JSON.parse(capturedBody);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Request body is not an object');
  }
  return parsed;
}

function inputPartsFromBody(
  body: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const input = body['input'];
  if (!Array.isArray(input)) return [];
  return input.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null,
  );
}

function flattenUserContentParts(
  body: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const item of inputPartsFromBody(body)) {
    if (item['role'] === 'user' && Array.isArray(item['content'])) {
      parts.push(
        ...item['content'].filter(
          (p): p is Record<string, unknown> =>
            typeof p === 'object' && p !== null,
        ),
      );
    }
  }
  return parts;
}

describe('OpenAIResponsesProvider PDF request construction @issue:2608', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-responses-pdf-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('emits input_file with source filename when media.pdf.enabled is unset (default enabled)', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'pdf-default-runtime',
      settingsService: settings,
    });

    const options = createProviderCallOptions({
      providerName: provider.name,
      settings,
      runtime,
      contents: pdfToolContinuation(),
    });

    const body = await captureRequestBody(provider, options);
    const parts = flattenUserContentParts(body);
    const files = parts.filter((p) => p['type'] === 'input_file');
    expect(files).toHaveLength(1);
    expect(files[0]['filename']).toBe('report.pdf');
    expect(String(files[0]['file_data'])).toMatch(
      /^data:application\/pdf;base64,/,
    );
  });

  it('emits input_text notice and no input_file when ephemeral sets media.pdf.enabled=false', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'pdf-disabled-runtime',
      settingsService: settings,
    });

    const options = createProviderCallOptions({
      providerName: provider.name,
      settings,
      runtime,
      ephemerals: { 'media.pdf.enabled': false },
      contents: pdfToolContinuation(),
    });

    const body = await captureRequestBody(provider, options);
    const parts = flattenUserContentParts(body);
    expect(parts.filter((p) => p['type'] === 'input_file')).toHaveLength(0);
    const texts = parts.filter((p) => p['type'] === 'input_text');
    expect(texts).toHaveLength(1);
    const notice = String(texts[0]['text']);
    expect(notice).toContain(
      'was not read because native PDF input is disabled for this provider',
    );
    expect(notice).toContain('report.pdf');
    expect(/[Ee]xtract|[Rr]ender/.test(notice)).toBe(true);
  });

  it('still emits input_file when ephemeral explicitly sets media.pdf.enabled=true', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'pdf-enabled-runtime',
      settingsService: settings,
    });

    const options = createProviderCallOptions({
      providerName: provider.name,
      settings,
      runtime,
      ephemerals: { 'media.pdf.enabled': true },
      contents: pdfToolContinuation(),
    });

    const body = await captureRequestBody(provider, options);
    const parts = flattenUserContentParts(body);
    const files = parts.filter((p) => p['type'] === 'input_file');
    expect(files).toHaveLength(1);
    expect(files[0]['filename']).toBe('report.pdf');
  });
});
