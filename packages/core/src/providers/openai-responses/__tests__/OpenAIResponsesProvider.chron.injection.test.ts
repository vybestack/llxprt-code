/**
 * Copyright 2026 Vybestack LLC
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

import { describe, expect, it, vi } from 'vitest';
import type {
  IContent,
  TextBlock,
} from '../../../services/history/IContent.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';

function findRoleItem(
  items: unknown[],
  role: 'user' | 'assistant',
): { role: 'user' | 'assistant'; content?: string } | undefined {
  return items.find(
    (item): item is { role: 'user' | 'assistant'; content?: string } =>
      typeof item === 'object' &&
      item !== null &&
      'role' in item &&
      (item as { role?: unknown }).role === role,
  );
}

function findFunctionCallOutput(items: unknown[]) {
  return items.find(
    (
      item,
    ): item is {
      type: 'function_call_output';
      call_id: string;
      output: string;
    } =>
      typeof item === 'object' &&
      item !== null &&
      'type' in item &&
      (item as { type?: unknown }).type === 'function_call_output',
  );
}

function parseChronPrefix(text: string) {
  const [firstLine] = text.split('\n');
  return JSON.parse(firstLine) as { chron?: Record<string, unknown> };
}

describe('OpenAI Responses: chron injection (user/assistant prefix + tool output container)', () => {
  it('should prefix chron JSON line into user and assistant text content', async () => {
    const content: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' } satisfies TextBlock],
        metadata: {
          chronology: {
            userTurnNumber: 7,
            agentStepNumber: 0,
          },
          timestamp: Date.parse('2026-03-03T10:00:00.123Z'),
        },
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hi!' } satisfies TextBlock],
        metadata: {
          chronology: {
            userTurnNumber: 7,
            agentStepNumber: 1,
          },
          timestamp: Date.parse('2026-03-03T10:00:01.456Z'),
        },
      },
    ];

    const captured: { input?: unknown[] } = {};

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const bodyText =
        init?.body instanceof Blob
          ? await init.body.text()
          : String(init?.body);
      const parsed = JSON.parse(bodyText) as { input?: unknown[] };
      captured.input = parsed.input;
      return new Response(
        JSON.stringify({
          id: 'resp_test',
          output: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const provider = new OpenAIResponsesProvider(
        'test',
        undefined,
        {} as unknown as ConstructorParameters<
          typeof OpenAIResponsesProvider
        >[2],
      );

      const iter = (
        provider as unknown as {
          generateChatCompletionWithOptions: (
            opts: unknown,
          ) => AsyncIterable<unknown>;
        }
      ).generateChatCompletionWithOptions({
        contents: content,
        tools: undefined,
        config: undefined,
        settings: undefined,
        runtime: undefined,
        invocation: undefined,
        resolved: {
          model: 'gpt-4.1-mini',
          authToken: 'test',
        },
      });

      // Trigger first network call
      for await (const ignored of iter) {
        void ignored;
        break;
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    const input = captured.input ?? [];

    const userItem = findRoleItem(input, 'user');
    expect(userItem?.content).toContain('\nHello');

    const userChron = parseChronPrefix(userItem!.content!);
    expect(userChron.chron?.usrTrn).toBe(7);
    expect(userChron.chron?.agTrn).toBe(0);
    expect(userChron.chron?.start).toBeTypeOf('string');

    const assistantItem = findRoleItem(input, 'assistant');
    expect(assistantItem?.content).toContain('\nHi!');

    const assistantChron = parseChronPrefix(assistantItem!.content!);
    expect(assistantChron.chron?.usrTrn).toBe(7);
    expect(assistantChron.chron?.agTrn).toBe(1);
    expect(assistantChron.chron?.start).toBeTypeOf('string');
  });

  it('should add chron container into function_call_output.output with dur when available', async () => {
    const content: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_123',
            name: 'read_file',
            parameters: { path: '/tmp/file.txt' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_123',
            toolName: 'read_file',
            result: { ok: true, durationSec: 12.5 },
            isComplete: true,
          },
        ],
        metadata: {
          chronology: {
            userTurnNumber: 7,
            agentStepNumber: 1,
          },
          timestamp: Date.parse('2026-03-03T10:00:02.000Z'),
        },
      },
    ];

    const captured: { input?: unknown[] } = {};

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const bodyText =
        init?.body instanceof Blob
          ? await init.body.text()
          : String(init?.body);
      const parsed = JSON.parse(bodyText) as { input?: unknown[] };
      captured.input = parsed.input;
      return new Response(
        JSON.stringify({
          id: 'resp_test',
          output: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const provider = new OpenAIResponsesProvider(
        'test',
        undefined,
        {} as unknown as ConstructorParameters<
          typeof OpenAIResponsesProvider
        >[2],
      );

      const iter = (
        provider as unknown as {
          generateChatCompletionWithOptions: (
            opts: unknown,
          ) => AsyncIterable<unknown>;
        }
      ).generateChatCompletionWithOptions({
        contents: content,
        tools: undefined,
        config: undefined,
        settings: undefined,
        runtime: undefined,
        invocation: undefined,
        resolved: {
          model: 'gpt-4.1-mini',
          authToken: 'test',
        },
      });

      // Trigger first network call
      for await (const ignored of iter) {
        void ignored;
        break;
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    const input = captured.input ?? [];
    const outputItem = findFunctionCallOutput(input);
    expect(outputItem).toBeDefined();

    const parsed = JSON.parse(outputItem!.output) as Record<string, unknown>;

    expect(parsed.ok, `function_call_output.output=${outputItem!.output}`).toBe(
      true,
    );

    expect(
      parsed.chron,
      `function_call_output.output=${outputItem!.output}`,
    ).toBeDefined();

    const chron = parsed.chron as Record<string, unknown>;
    expect(chron.usrTrn).toBe(7);
    expect(chron.agTrn).toBe(1);
    expect(chron.start).toBeTypeOf('string');
    expect(chron.dur).toBe(12.5);
  });
});
