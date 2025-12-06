/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251205-ISSUE712
 * @description Tests for ToolIdStrategy module - Kimi K2 tool ID handling
 *
 * TDD Phase 1: RED - These tests should FAIL until implementation exists
 */

import { describe, it, expect } from 'vitest';
import {
  isKimiModel,
  kimiStrategy,
  standardStrategy,
  getToolIdStrategy,
} from './ToolIdStrategy.js';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '../services/history/IContent.js';

describe('ToolIdStrategy', () => {
  describe('isKimiModel', () => {
    it('should return true for kimi-k2-0711-preview', () => {
      expect(isKimiModel('kimi-k2-0711-preview')).toBe(true);
    });

    it('should return true for K2-Thinking', () => {
      expect(isKimiModel('K2-Thinking')).toBe(true);
    });

    it('should return true for moonshot-kimi-k2', () => {
      expect(isKimiModel('moonshot-kimi-k2')).toBe(true);
    });

    it('should return false for gpt-4o', () => {
      expect(isKimiModel('gpt-4o')).toBe(false);
    });

    it('should return false for qwen3-coder-plus', () => {
      expect(isKimiModel('qwen3-coder-plus')).toBe(false);
    });

    it('should return false for claude-sonnet-4', () => {
      expect(isKimiModel('claude-sonnet-4')).toBe(false);
    });

    it('should handle case-insensitive matching', () => {
      expect(isKimiModel('KIMI-K2-0711-preview')).toBe(true);
      expect(isKimiModel('kimi-K2-thinking')).toBe(true);
    });
  });

  describe('kimiStrategy', () => {
    describe('createMapper', () => {
      it('should generate K2 ID for first tool call', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_abc',
                name: 'read_file',
                parameters: {},
              },
            ],
          },
        ];
        const mapper = kimiStrategy.createMapper(contents);
        expect(
          mapper.resolveToolCallId(contents[0].blocks[0] as ToolCallBlock),
        ).toBe('functions.read_file:0');
      });

      it('should generate sequential K2 IDs for multiple tool calls in same turn', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_1',
                name: 'read_file',
                parameters: {},
              },
              {
                type: 'tool_call',
                id: 'hist_tool_2',
                name: 'glob',
                parameters: {},
              },
            ],
          },
        ];
        const mapper = kimiStrategy.createMapper(contents);
        const blocks = contents[0].blocks as ToolCallBlock[];
        expect(mapper.resolveToolCallId(blocks[0])).toBe(
          'functions.read_file:0',
        );
        expect(mapper.resolveToolCallId(blocks[1])).toBe('functions.glob:1');
      });

      it('should generate sequential K2 IDs across multiple turns', () => {
        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'list files' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_1',
                name: 'glob',
                parameters: {},
              },
            ],
          },
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'hist_tool_1',
                toolName: 'glob',
                result: ['file.ts'],
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_2',
                name: 'read_file',
                parameters: {},
              },
            ],
          },
        ];
        const mapper = kimiStrategy.createMapper(contents);
        const tc1 = contents[1].blocks[0] as ToolCallBlock;
        const tc2 = contents[3].blocks[0] as ToolCallBlock;
        expect(mapper.resolveToolCallId(tc1)).toBe('functions.glob:0');
        expect(mapper.resolveToolCallId(tc2)).toBe('functions.read_file:1');
      });

      it('should resolve tool response ID to match its corresponding call', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_abc',
                name: 'read_file',
                parameters: {},
              },
            ],
          },
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'hist_tool_abc',
                toolName: 'read_file',
                result: { content: 'file content' },
              },
            ],
          },
        ];
        const mapper = kimiStrategy.createMapper(contents);
        const response = contents[1].blocks[0] as ToolResponseBlock;
        expect(mapper.resolveToolResponseId(response)).toBe(
          'functions.read_file:0',
        );
      });

      it('should handle multiple tool calls and responses correctly', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_1',
                name: 'glob',
                parameters: { pattern: '*.ts' },
              },
              {
                type: 'tool_call',
                id: 'hist_tool_2',
                name: 'read_file',
                parameters: { path: 'file.ts' },
              },
            ],
          },
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'hist_tool_1',
                toolName: 'glob',
                result: ['a.ts', 'b.ts'],
              },
              {
                type: 'tool_response',
                callId: 'hist_tool_2',
                toolName: 'read_file',
                result: 'content',
              },
            ],
          },
        ];
        const mapper = kimiStrategy.createMapper(contents);

        // Tool calls
        const tc1 = contents[0].blocks[0] as ToolCallBlock;
        const tc2 = contents[0].blocks[1] as ToolCallBlock;
        expect(mapper.resolveToolCallId(tc1)).toBe('functions.glob:0');
        expect(mapper.resolveToolCallId(tc2)).toBe('functions.read_file:1');

        // Tool responses should map to their calls
        const tr1 = contents[1].blocks[0] as ToolResponseBlock;
        const tr2 = contents[1].blocks[1] as ToolResponseBlock;
        expect(mapper.resolveToolResponseId(tr1)).toBe('functions.glob:0');
        expect(mapper.resolveToolResponseId(tr2)).toBe('functions.read_file:1');
      });

      it('should return fallback ID for unknown tool response', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_abc',
                name: 'read_file',
                parameters: {},
              },
            ],
          },
        ];
        const mapper = kimiStrategy.createMapper(contents);

        // Response for a call that doesn't exist
        const orphanResponse: ToolResponseBlock = {
          type: 'tool_response',
          callId: 'hist_tool_unknown',
          toolName: 'unknown_tool',
          result: {},
        };
        // Should return a fallback that includes the tool name
        const result = mapper.resolveToolResponseId(orphanResponse);
        expect(result).toContain('functions.');
        expect(result).toContain(':');
      });
    });
  });

  describe('standardStrategy', () => {
    describe('createMapper', () => {
      it('should normalize hist_tool_xxx to call_xxx format', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_abc123',
                name: 'read_file',
                parameters: {},
              },
            ],
          },
        ];
        const mapper = standardStrategy.createMapper(contents);
        expect(
          mapper.resolveToolCallId(contents[0].blocks[0] as ToolCallBlock),
        ).toBe('call_abc123');
      });

      it('should handle call_xxx IDs by keeping them as-is', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call_xyz789',
                name: 'glob',
                parameters: {},
              },
            ],
          },
        ];
        const mapper = standardStrategy.createMapper(contents);
        expect(
          mapper.resolveToolCallId(contents[0].blocks[0] as ToolCallBlock),
        ).toBe('call_xyz789');
      });

      it('should normalize tool response IDs to call_xxx format', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_abc123',
                name: 'read_file',
                parameters: {},
              },
            ],
          },
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'hist_tool_abc123',
                toolName: 'read_file',
                result: 'content',
              },
            ],
          },
        ];
        const mapper = standardStrategy.createMapper(contents);
        const response = contents[1].blocks[0] as ToolResponseBlock;
        expect(mapper.resolveToolResponseId(response)).toBe('call_abc123');
      });

      it('should sanitize non-alphanumeric characters', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'hist_tool_abc-123.xyz:456',
                name: 'read_file',
                parameters: {},
              },
            ],
          },
        ];
        const mapper = standardStrategy.createMapper(contents);
        // Should remove - . : characters
        expect(
          mapper.resolveToolCallId(contents[0].blocks[0] as ToolCallBlock),
        ).toBe('call_abc123xyz456');
      });
    });
  });

  describe('getToolIdStrategy', () => {
    it('should return kimiStrategy for kimi format', () => {
      const strategy = getToolIdStrategy('kimi');
      expect(strategy).toBe(kimiStrategy);
    });

    it('should return standardStrategy for openai format', () => {
      const strategy = getToolIdStrategy('openai');
      expect(strategy).toBe(standardStrategy);
    });

    it('should return standardStrategy for qwen format', () => {
      const strategy = getToolIdStrategy('qwen');
      expect(strategy).toBe(standardStrategy);
    });

    it('should return standardStrategy for deepseek format', () => {
      const strategy = getToolIdStrategy('deepseek');
      expect(strategy).toBe(standardStrategy);
    });

    it('should return standardStrategy for anthropic format', () => {
      const strategy = getToolIdStrategy('anthropic');
      expect(strategy).toBe(standardStrategy);
    });
  });
});
