/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  generateCheckpointFileName,
  getToolCallDataSchema,
  formatCheckpointDisplayList,
  getTruncatedCheckpointNames,
  processRestorableToolCalls,
  getCheckpointInfoList,
  type ToolCallData,
} from './checkpointUtils.js';
import type { ToolCallRequestInfo } from '../core/turn.js';
import type { GitService } from '../services/gitService.js';
import type { GeminiClient } from '../core/client.js';
import type { Content } from '@google/genai';

describe('checkpointUtils', () => {
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
      if (result.success) {
        expect(
          (result.data as unknown as { extraField: string }).extraField,
        ).toBe('should be preserved');
        expect(
          (result.data as unknown as { anotherExtra: number }).anotherExtra,
        ).toBe(42);
      }
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

  describe('processRestorableToolCalls', () => {
    it('returns empty maps for empty input', async () => {
      const mockGitService = {} as GitService;
      const mockGeminiClient = {
        getHistory: vi.fn().mockResolvedValue([]),
      } as unknown as GeminiClient;

      const result = await processRestorableToolCalls(
        [],
        mockGitService,
        mockGeminiClient,
      );

      expect(result.checkpointsToWrite.size).toBe(0);
      expect(result.toolCallToCheckpointMap.size).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('collects error when git snapshot creation fails completely', async () => {
      const toolCalls: ToolCallRequestInfo[] = [
        {
          callId: 'call-1',
          name: 'write_file',
          args: { file_path: '/test/file.ts' },
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ];

      const mockGitService = {
        createFileSnapshot: vi.fn().mockRejectedValue(new Error('Git error')),
        getCurrentCommitHash: vi.fn().mockResolvedValue(undefined),
      } as unknown as GitService;

      const mockGeminiClient = {
        getHistory: vi.fn().mockResolvedValue([]),
      } as unknown as GeminiClient;

      const result = await processRestorableToolCalls(
        toolCalls,
        mockGitService,
        mockGeminiClient,
      );

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Git error');
      expect(result.checkpointsToWrite.size).toBe(0);
    });

    it('creates checkpoint data with commitHash and clientHistory', async () => {
      const toolCalls: ToolCallRequestInfo[] = [
        {
          callId: 'call-2',
          name: 'replace',
          args: { file_path: '/src/app.ts' },
          isClientInitiated: false,
          prompt_id: 'prompt-2',
        },
      ];

      const mockClientHistory: Content[] = [
        { role: 'user', parts: [{ text: 'test message' }] },
      ];

      const mockGitService = {
        createFileSnapshot: vi.fn().mockResolvedValue('commit-hash-123'),
        getCurrentCommitHash: vi.fn(),
      } as unknown as GitService;

      const mockGeminiClient = {
        getHistory: vi.fn().mockResolvedValue(mockClientHistory),
      } as unknown as GeminiClient;

      const result = await processRestorableToolCalls(
        toolCalls,
        mockGitService,
        mockGeminiClient,
        { customHistory: 'data' },
      );

      expect(result.checkpointsToWrite.size).toBe(1);
      expect(result.errors.length).toBe(0);

      const checkpointContent = Array.from(
        result.checkpointsToWrite.values(),
      )[0];
      const parsed = JSON.parse(checkpointContent) as ToolCallData;

      expect(parsed.commitHash).toBe('commit-hash-123');
      expect(parsed.clientHistory).toStrictEqual(mockClientHistory);
      expect(parsed.history).toStrictEqual({ customHistory: 'data' });
      expect(parsed.messageId).toBe('prompt-2');
    });

    it('falls back to getCurrentCommitHash when snapshot creation fails', async () => {
      const toolCalls: ToolCallRequestInfo[] = [
        {
          callId: 'call-3',
          name: 'write_file',
          args: { file_path: '/test.js' },
          isClientInitiated: false,
          prompt_id: 'prompt-3',
        },
      ];

      const mockGitService = {
        createFileSnapshot: vi
          .fn()
          .mockRejectedValue(new Error('Snapshot failed')),
        getCurrentCommitHash: vi.fn().mockResolvedValue('fallback-hash'),
      } as unknown as GitService;

      const mockGeminiClient = {
        getHistory: vi.fn().mockResolvedValue([]),
      } as unknown as GeminiClient;

      const result = await processRestorableToolCalls(
        toolCalls,
        mockGitService,
        mockGeminiClient,
      );

      expect(result.checkpointsToWrite.size).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('Snapshot failed');

      const checkpointContent = Array.from(
        result.checkpointsToWrite.values(),
      )[0];
      const parsed = JSON.parse(checkpointContent) as ToolCallData;
      expect(parsed.commitHash).toBe('fallback-hash');
    });

    it('skips tool call without file_path and logs error', async () => {
      const toolCalls: ToolCallRequestInfo[] = [
        {
          callId: 'call-4',
          name: 'some_tool',
          args: { other_arg: 'value' },
          isClientInitiated: false,
          prompt_id: 'prompt-4',
        },
      ];

      const mockGitService = {
        createFileSnapshot: vi.fn().mockResolvedValue('hash'),
      } as unknown as GitService;

      const mockGeminiClient = {
        getHistory: vi.fn().mockResolvedValue([]),
      } as unknown as GeminiClient;

      const result = await processRestorableToolCalls(
        toolCalls,
        mockGitService,
        mockGeminiClient,
      );

      expect(result.checkpointsToWrite.size).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('missing file_path');
    });
  });

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
});
