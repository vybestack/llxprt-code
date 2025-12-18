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

import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIProvider } from './OpenAIProvider.js';

describe('OpenAIProvider compressToolMessages (Issue #894)', () => {
  it('should compress tool messages when provider limits require it', () => {
    const provider = new OpenAIProvider('test-key');

    const originalPayload = {
      status: 'success',
      toolName: 'read_file',
      result: 'a'.repeat(5000),
    };

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        content: JSON.stringify(originalPayload),
        tool_call_id: 'call_abc',
      } as OpenAI.Chat.ChatCompletionToolMessageParam,
    ];

    const logger = { debug: () => undefined } as unknown as {
      debug: (fn: () => string) => void;
    };

    const didModify = (
      provider as unknown as {
        compressToolMessages: (
          msgs: OpenAI.Chat.ChatCompletionMessageParam[],
          maxLength: number,
          l: typeof logger,
        ) => boolean;
      }
    ).compressToolMessages(messages, 500, logger);

    expect(didModify).toBe(true);

    const modified = messages[0] as { content?: unknown };
    expect(typeof modified.content).toBe('string');

    const parsed = JSON.parse(modified.content as string) as {
      result?: string;
      truncated?: boolean;
      originalLength?: number;
    };

    expect(parsed.truncated).toBe(true);
    expect(typeof parsed.originalLength).toBe('number');
    expect(parsed.result).toContain('[omitted');
  });
});
