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
import type { IContent } from '../../../services/history/IContent.js';
import { buildResponsesInputFromContent } from '../buildResponsesInputFromContent.js';

function findFunctionCallOutput(
  items: ReturnType<typeof buildResponsesInputFromContent>,
) {
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
      item.type === 'function_call_output',
  );
}

describe('OpenAIResponsesProvider tool output ephemerals (Issue #894)', () => {
  it('should apply tool-output-max-tokens when building function_call_output items', () => {
    const oversized = 'line\n'.repeat(2000);
    const content: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_001',
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
            callId: 'hist_tool_001',
            toolName: 'read_file',
            result: oversized,
          },
        ],
      },
    ];

    const fakeConfig = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 50,
        'tool-output-truncate-mode': 'truncate',
      }),
    };

    const input = buildResponsesInputFromContent(
      content,
      undefined,
      fakeConfig,
    );
    const outputItem = findFunctionCallOutput(input);

    expect(outputItem).toBeDefined();
    expect(outputItem?.output).toContain(
      '[Output truncated due to token limit]',
    );
    expect(outputItem?.output.length).toBeLessThan(oversized.length);
  });

  it('should NOT truncate when output is within tool-output-max-tokens limit', () => {
    const content: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_002',
            name: 'list_directory',
            parameters: { path: '/tmp' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_002',
            toolName: 'list_directory',
            result: 'a'.repeat(2000),
          },
        ],
      },
    ];

    const fakeConfig = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 50000,
        'tool-output-truncate-mode': 'truncate',
      }),
    };

    const input = buildResponsesInputFromContent(
      content,
      undefined,
      fakeConfig,
    );
    const outputItem = findFunctionCallOutput(input);

    expect(outputItem).toBeDefined();
    expect(outputItem?.output).toContain('a'.repeat(2000));
    expect(outputItem?.output).not.toContain(
      '[Output truncated due to token limit]',
    );
  });
});
