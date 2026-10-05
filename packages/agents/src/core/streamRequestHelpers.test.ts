import { forbidHistoryMaterializationForTest } from '../../../core/src/test-utils/history-materialization-test-guard.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildRequestContentsResult } from './streamRequestHelpers.js';

describe('request cursor cancellation', () => {
  it('rejects a cancelled request before preparing any provider contents', async () => {
    const history = new HistoryService();
    const controller = new AbortController();
    controller.abort(new Error('request cancelled'));
    try {
      await expect(
        buildRequestContentsResult(
          { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
          history,
          undefined,
          controller.signal,
        ),
      ).rejects.toThrow('request cancelled');
    } finally {
      history.dispose();
    }
  });
});

describe('buildRequestContentsResult history override', () => {
  class CursorOnlyRequestHistory extends HistoryService {
    constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
      super(options);
      forbidHistoryMaterializationForTest(this, 'eager request preparation');
    }
  }

  describe('request preparation from a journal cursor', () => {
    it('prepares actual request rows without either eager history getter', async () => {
      const history = new CursorOnlyRequestHistory();
      try {
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'prior' }],
        });
        const result = await buildRequestContentsResult(
          { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
          history,
        );
        expect(result.contents.map((row) => row.blocks)).toStrictEqual([
          [{ type: 'text', text: 'prior' }],
          [{ type: 'text', text: 'pending' }],
        ]);
        expect(result.pending).toHaveLength(1);
        expect(result.contents[1].metadata).toStrictEqual(
          result.pending[0].metadata,
        );
      } finally {
        history.dispose();
      }
    });
  });

  it('curates an isolated provider copy with complete adjacent tool responses', async () => {
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

    const result = await buildRequestContentsResult(pending, history, override);
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
