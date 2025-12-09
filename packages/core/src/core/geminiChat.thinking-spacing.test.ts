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
import type { IContent, ContentBlock } from '../services/history/IContent.js';
import { aggregateTextWithSpacing } from './geminiChat.js';

/**
 * Helper function that simulates streaming text aggregation by iterating
 * over IContent chunks and using the exported aggregateTextWithSpacing function.
 *
 * @param streamChunks - Array of IContent chunks simulating a stream response
 * @returns Aggregated text with proper spacing
 */
function aggregateTextFromStream(streamChunks: IContent[]): string {
  let aggregatedText = '';
  let lastBlockWasNonText = false;

  for (const iContent of streamChunks) {
    const result = aggregateTextWithSpacing(
      iContent.blocks ?? [],
      aggregatedText,
      lastBlockWasNonText,
    );
    aggregatedText = result.text;
    lastBlockWasNonText = result.lastBlockWasNonText;
  }

  return aggregatedText;
}

describe('geminiChat text aggregation with thinking blocks', () => {
  describe('aggregateTextWithSpacing (direct function tests)', () => {
    it('should add space after non-text block when text follows', () => {
      const blocks: ContentBlock[] = [{ type: 'text', text: 'Hello' }];
      const result = aggregateTextWithSpacing(blocks, 'Previous', true);

      expect(result.text).toBe('Previous Hello');
      expect(result.lastBlockWasNonText).toBe(false);
    });

    it('should not add space when no previous text exists', () => {
      const blocks: ContentBlock[] = [{ type: 'text', text: 'Hello' }];
      const result = aggregateTextWithSpacing(blocks, '', true);

      expect(result.text).toBe('Hello');
      expect(result.lastBlockWasNonText).toBe(false);
    });

    it('should track non-text block at end', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Hello' },
        { type: 'thinking', thought: 'pondering' },
      ];
      const result = aggregateTextWithSpacing(blocks, '', false);

      expect(result.text).toBe('Hello');
      expect(result.lastBlockWasNonText).toBe(true);
    });

    it('should handle empty blocks array', () => {
      const blocks: ContentBlock[] = [];
      const result = aggregateTextWithSpacing(blocks, 'existing', false);

      expect(result.text).toBe('existing');
      expect(result.lastBlockWasNonText).toBe(false);
    });
  });

  describe('aggregateTextFromStream (integration with stream chunks)', () => {
    it('should preserve spacing when thinking block appears between text chunks', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'The service is available.' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'considering the response' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: "I'll help you with that." }],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe("The service is available. I'll help you with that.");
    });

    it('should not add multiple spaces for consecutive thinking blocks', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'First part' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'thought 1' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'thought 2' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'second part' }],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('First part second part');
    });

    it('should not add leading space when thinking block appears at start', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'initial thought' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'The response' }],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('The response');
    });

    it('should preserve existing trailing space in text when followed by thinking block', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'The response ' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'final thought' }],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('The response ');
    });

    it('should handle empty text blocks without adding spurious spaces', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Start' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: '' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'thinking' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'End' }],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('Start End');
    });

    it('should handle multiple non-text block types preserving spacing', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Here is code:' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'code',
              code: 'const x = 1;',
              language: 'typescript',
            } as ContentBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'And the result.' }],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('Here is code: And the result.');
    });

    it('should handle mixed content blocks in single chunk', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'First' },
            { type: 'thinking', thought: 'thinking' },
            { type: 'text', text: 'Second' },
          ],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('First Second');
    });

    it('should handle only text blocks without adding spaces', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Part 1' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: ' Part 2' }],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('Part 1 Part 2');
    });

    it('should handle only thinking blocks without producing text', () => {
      const chunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'thought 1' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'thought 2' }],
        },
      ];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('');
    });

    it('should handle empty chunks array', () => {
      const chunks: IContent[] = [];

      const result = aggregateTextFromStream(chunks);

      expect(result).toBe('');
    });
  });
});
