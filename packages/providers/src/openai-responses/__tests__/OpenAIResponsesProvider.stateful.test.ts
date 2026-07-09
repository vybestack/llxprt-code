/**
 * @license
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
 * Issue #207: Stateful conversations for OpenAI Responses API.
 *
 * In stateful mode, the provider threads the last AI message's metadata.id as
 * previous_response_id and trims the input to only the new turn.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponsesInputItem } from '../OpenAIResponsesTypes.js';

const originalFetch = global.fetch;
const mockFetch = vi.fn();

function createMockStreamingResponse() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"content.delta","delta":"ok"}\n\n'),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function captureRequestBody(
  provider: OpenAIResponsesProvider,
  contents: IContent[],
  settings: SettingsService,
  ephemerals: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let capturedBody: string | undefined;

  mockFetch.mockImplementation(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.body != null) {
        capturedBody =
          typeof init.body === 'string'
            ? init.body
            : await new Response(init.body).text();
      }
      return createMockStreamingResponse();
    },
  );

  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'stateful-test-runtime',
    config: createRuntimeConfigStub(settings),
  });

  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: ephemerals,
  });

  const options = createProviderCallOptions({
    providerName: provider.name,
    settings,
    config: createRuntimeConfigStub(settings),
    runtime,
    invocation,
    contents,
    ephemeralSettings: ephemerals,
  });

  for await (const _content of provider.generateChatCompletion(options)) {
    // drain
  }

  expect(capturedBody).toBeDefined();
  return JSON.parse(capturedBody!) as Record<string, unknown>;
}

function inputItems(body: Record<string, unknown>): ResponsesInputItem[] {
  return body['input'] as ResponsesInputItem[];
}

function userMessages(items: ResponsesInputItem[]): string[] {
  const messages: string[] = [];
  for (const i of items) {
    if ('role' in i && i.role === 'user' && typeof i.content === 'string') {
      messages.push(i.content);
    }
  }
  return messages;
}

function assistantMessages(items: ResponsesInputItem[]): string[] {
  const messages: string[] = [];
  for (const i of items) {
    if (
      'role' in i &&
      i.role === 'assistant' &&
      typeof i.content === 'string'
    ) {
      messages.push(i.content);
    }
  }
  return messages;
}

describe('OpenAIResponsesProvider stateful conversations @issue:207', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'stateful-test-runtime',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('is stateless by default: no previous_response_id, full history in input', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
        metadata: { id: 'resp_1' },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second question' }],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {});

    expect(body['previous_response_id']).toBeUndefined();
    const items = inputItems(body);
    const users = userMessages(items);
    const assistants = assistantMessages(items);
    expect(users).toContain('first question');
    expect(assistants).toContain('first answer');
    expect(users).toContain('second question');
  });

  it('sets previous_response_id and trims input in stateful mode with prior AI turn', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
        metadata: { id: 'resp_1' },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second question' }],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {
      'responses-stateful': true,
    });

    expect(body['previous_response_id']).toBe('resp_1');
    expect(body['store']).toBe(true);
    const items = inputItems(body);
    const users = userMessages(items);
    const assistants = assistantMessages(items);
    expect(users).not.toContain('first question');
    expect(assistants).not.toContain('first answer');
    expect(users).toContain('second question');
  });

  it('falls back to full history in stateful mode with no prior AI message metadata.id', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second question' }],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {
      'responses-stateful': true,
    });

    expect(body['previous_response_id']).toBeUndefined();
    const items = inputItems(body);
    const users = userMessages(items);
    expect(users).toContain('first question');
    expect(users).toContain('second question');
  });

  it('preserves function_call_output for the new turn in stateful tool-response mode', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'check the weather' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_wx',
            name: 'get_weather',
            parameters: { city: 'SF' },
          },
        ],
        metadata: { id: 'resp_tool' },
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_wx',
            toolName: 'get_weather',
            result: { temperature: 72 },
          },
        ],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {
      'responses-stateful': true,
    });

    expect(body['previous_response_id']).toBe('resp_tool');
    const items = inputItems(body);
    const outputs: unknown[] = [];
    for (const i of items) {
      if ('type' in i && i.type === 'function_call_output') {
        outputs.push(i);
      }
    }
    expect(outputs).toHaveLength(1);
    const output = outputs[0] as { call_id: string; output: string };
    expect(output.call_id).toBe('call_wx');
    expect(JSON.parse(output.output)).toMatchObject({ temperature: 72 });
  });

  it('drops orphan function_call_output when stateful is on but no prior parent id exists @issue:207', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    // No AI turn carries metadata.id, so previous_response_id is not sent and
    // the request is effectively stateless: the orphan guard must still run.
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'question' }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_orphan_no_parent',
            toolName: 'get_weather',
            result: { temperature: 72 },
          },
        ],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {
      'responses-stateful': true,
    });

    expect(body['previous_response_id']).toBeUndefined();
    const items = inputItems(body);
    const outputs: unknown[] = [];
    for (const i of items) {
      if ('type' in i && i.type === 'function_call_output') {
        outputs.push(i);
      }
    }
    expect(outputs).toHaveLength(0);
    expect(userMessages(items)).toContain('question');
  });

  it('falls back to stateless when the last turn is the parent with no new content after it @issue:207', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    // History ends at an AI turn carrying a response id, with no new user
    // message after it. Sending previous_response_id alongside the full
    // history would duplicate context, so stateful is disabled for this turn.
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
        metadata: { id: 'resp_last' },
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {
      'responses-stateful': true,
    });

    expect(body['previous_response_id']).toBeUndefined();
    const items = inputItems(body);
    expect(userMessages(items)).toContain('first question');
    expect(assistantMessages(items)).toContain('first answer');
  });
});
