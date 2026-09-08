/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildRequestContentsResult } from './streamRequestHelpers.js';

describe('buildRequestContentsResult history override', () => {
  it('curates an isolated provider copy with complete adjacent tool responses', () => {
    const history = new HistoryService();
    const override: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'run the tool' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_interrupted',
            name: 'read_file',
            parameters: { path: 'README.md' },
          },
        ],
      },
    ];
    const pending: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'continue' }],
    };

    const result = buildRequestContentsResult(pending, history, override);
    const toolCallIndex = result.contents.findIndex((content) =>
      content.blocks.some(
        (block) =>
          block.type === 'tool_call' && block.id === 'hist_tool_interrupted',
      ),
    );

    expect(toolCallIndex).toBe(1);
    expect(result.contents[toolCallIndex + 1]?.speaker).toBe('tool');
    expect(
      result.contents[toolCallIndex + 1]?.blocks.some(
        (block) =>
          block.type === 'tool_response' &&
          block.callId === 'hist_tool_interrupted',
      ),
    ).toBe(true);
    expect(result.contents[result.contents.length - 1]?.speaker).toBe('human');
    expect(result.contents[0]).not.toBe(override[0]);
    expect(result.contents[0]?.blocks[0]).not.toBe(override[0]?.blocks[0]);
  });
});
