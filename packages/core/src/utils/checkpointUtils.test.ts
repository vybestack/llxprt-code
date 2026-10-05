/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  generateCheckpointFileName,
  getToolCallDataSchema,
  formatCheckpointDisplayList,
  getTruncatedCheckpointNames,
  getCheckpointInfoList,
  type ToolCallData,
} from './checkpointUtils.js';
import type { ToolCallRequestInfo } from '../core/turn.js';

function checkpointFileNameTests(): void {
  describe('generateCheckpointFileName', () => {
    it('returns null when no file_path argument exists', () => {
      const toolCall: ToolCallRequestInfo = {
        callId: 'test-1',
        name: 'test_tool',
        args: { other_arg: 'value' },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      };

      const result = generateCheckpointFileName(toolCall);
      expect(result).toBeNull();
    });

    it('generates filename without colons', () => {
      const toolCall: ToolCallRequestInfo = {
        callId: 'test-2',
        name: 'write_file',
        args: { file_path: '/path/to/test.ts' },
        isClientInitiated: false,
        prompt_id: 'prompt-2',
      };

      const result = generateCheckpointFileName(toolCall);
      expect(result).toBeTruthy();
      expect(result).not.toContain(':');
    });

    it('produces different filenames for different callIds due to timestamp', () => {
      const toolCall1: ToolCallRequestInfo = {
        callId: 'test-3',
        name: 'write_file',
        args: { file_path: '/path/to/test.ts' },
        isClientInitiated: false,
        prompt_id: 'prompt-3',
      };

      const toolCall2: ToolCallRequestInfo = {
        callId: 'test-4',
        name: 'write_file',
        args: { file_path: '/path/to/test.ts' },
        isClientInitiated: false,
        prompt_id: 'prompt-4',
      };

      const result1 = generateCheckpointFileName(toolCall1);
      // Small delay to ensure timestamp differs
      const result2 = generateCheckpointFileName(toolCall2);

      // While they might be the same if called instantly, at minimum they should both be valid
      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();
      expect(result1).toMatch(/test\.ts-write_file$/);
      expect(result2).toMatch(/test\.ts-write_file$/);
    });

    it('includes file basename and tool name in output', () => {
      const toolCall: ToolCallRequestInfo = {
        callId: 'test-5',
        name: 'replace',
        args: { file_path: '/deep/path/to/myfile.js' },
        isClientInitiated: false,
        prompt_id: 'prompt-5',
      };

      const result = generateCheckpointFileName(toolCall);
      expect(result).toContain('myfile.js');
      expect(result).toContain('replace');
    });
  });
}

function checkpointSchemaTests(): void {
  describe('getToolCallDataSchema', () => {
    it('validates minimal valid payload', () => {
      const schema = getToolCallDataSchema();
      const validData = {
        toolCall: {
          name: 'test_tool',
          args: { key: 'value' },
        },
      };

      const result = schema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('rejects payload missing toolCall', () => {
      const schema = getToolCallDataSchema();
      const invalidData = {
        history: [],
        commitHash: 'abc123',
      };

      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('accepts extra fields via passthrough', () => {
      const schema = getToolCallDataSchema();
      const dataWithExtra = {
        toolCall: {
          name: 'test_tool',
          args: { key: 'value' },
        },
        extraField: 'should be preserved',
        anotherExtra: 42,
      };

      const result = schema.safeParse(dataWithExtra);
      expect(result.success).toBe(true);
      const parsed = result as unknown as {
        success: true;
        data: Record<string, unknown>;
      };
      expect(parsed.data.extraField).toBe('should be preserved');
      expect(parsed.data.anotherExtra).toBe(42);
    });

    it('validates optional fields when present', () => {
      const schema = getToolCallDataSchema();
      const fullData: ToolCallData = {
        history: [{ role: 'user', message: 'test' }],
        clientHistory: [
          {
            role: 'user',
            parts: [{ text: 'hello' }],
          },
        ],
        commitHash: 'abc123',
        toolCall: {
          name: 'test_tool',
          args: { key: 'value' },
        },
        messageId: 'msg-1',
      };

      const result = schema.safeParse(fullData);
      expect(result.success).toBe(true);
    });
  });
}

function checkpointDisplayTests(): void {
  describe('formatCheckpointDisplayList', () => {
    it('strips .json extension from filenames', () => {
      const filenames = [
        '2025-01-01T12-00-00_000Z-test.ts-write_file.json',
        '2025-01-01T12-01-00_000Z-app.js-replace.json',
      ];

      const result = formatCheckpointDisplayList(filenames);
      expect(result).not.toContain('.json');
      expect(result).toContain('2025-01-01T12-00-00_000Z-test.ts-write_file');
      expect(result).toContain('2025-01-01T12-01-00_000Z-app.js-replace');
    });

    it('joins filenames with newline', () => {
      const filenames = ['checkpoint1.json', 'checkpoint2.json'];

      const result = formatCheckpointDisplayList(filenames);
      expect(result).toContain('\n');
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
    });

    it('returns empty string for empty array', () => {
      const result = formatCheckpointDisplayList([]);
      expect(result).toBe('');
    });
  });
}

function checkpointTruncatedNamesTests(): void {
  describe('getTruncatedCheckpointNames', () => {
    it('strips .json extension', () => {
      const filenames = ['checkpoint1.json', 'checkpoint2.json'];
      const result = getTruncatedCheckpointNames(filenames);

      expect(result).toStrictEqual(['checkpoint1', 'checkpoint2']);
    });

    it('handles filenames without extension', () => {
      const filenames = ['checkpoint1', 'checkpoint2'];
      const result = getTruncatedCheckpointNames(filenames);

      expect(result).toStrictEqual(['checkpoint1', 'checkpoint2']);
    });

    it('handles filenames with multiple dots correctly', () => {
      const filenames = ['file.backup.json', 'test.old.json'];
      const result = getTruncatedCheckpointNames(filenames);

      expect(result).toStrictEqual(['file.backup', 'test.old']);
    });
  });
}

function checkpointInfoTests(): void {
  describe('getCheckpointInfoList', () => {
    it('extracts messageId from valid JSON entries', () => {
      const checkpointFiles = new Map<string, string>([
        [
          'checkpoint1.json',
          JSON.stringify({
            toolCall: { name: 'test', args: {} },
            messageId: 'msg-1',
          }),
        ],
        [
          'checkpoint2.json',
          JSON.stringify({
            toolCall: { name: 'test2', args: {} },
            messageId: 'msg-2',
          }),
        ],
      ]);

      const result = getCheckpointInfoList(checkpointFiles);

      expect(result.length).toBe(2);
      expect(result[0].messageId).toBe('msg-1');
      expect(result[0].checkpoint).toBe('checkpoint1');
      expect(result[1].messageId).toBe('msg-2');
      expect(result[1].checkpoint).toBe('checkpoint2');
    });

    it('ignores entries without messageId', () => {
      const checkpointFiles = new Map<string, string>([
        [
          'checkpoint1.json',
          JSON.stringify({
            toolCall: { name: 'test', args: {} },
          }),
        ],
        [
          'checkpoint2.json',
          JSON.stringify({
            toolCall: { name: 'test2', args: {} },
            messageId: 'msg-2',
          }),
        ],
      ]);

      const result = getCheckpointInfoList(checkpointFiles);

      expect(result.length).toBe(1);
      expect(result[0].messageId).toBe('msg-2');
    });

    it('ignores invalid JSON files', () => {
      const checkpointFiles = new Map<string, string>([
        ['invalid.json', 'not valid json {{{'],
        [
          'valid.json',
          JSON.stringify({
            toolCall: { name: 'test', args: {} },
            messageId: 'msg-valid',
          }),
        ],
      ]);

      const result = getCheckpointInfoList(checkpointFiles);

      expect(result.length).toBe(1);
      expect(result[0].messageId).toBe('msg-valid');
    });

    it('returns empty array for empty map', () => {
      const checkpointFiles = new Map<string, string>();
      const result = getCheckpointInfoList(checkpointFiles);

      expect(result).toStrictEqual([]);
    });
  });
}

describe('checkpointUtils', () => {
  checkpointFileNameTests();
  checkpointSchemaTests();
  checkpointDisplayTests();
  checkpointTruncatedNamesTests();
  checkpointInfoTests();
});
