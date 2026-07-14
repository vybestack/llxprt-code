/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { CommandContext, SlashCommand } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { AgentClientContract as AgentClient } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { IContent, ContentBlock } from '@vybestack/llxprt-code-core';

import { chatCommand } from './chatCommand.js';
import {
  validateCheckpointContentBlock,
  checkpointPartToContentBlock,
  iContentToCheckpoint,
  checkpointToIContent,
} from './checkpointContentValidation.js';
import { assertDefined } from '../../test-utils/assertions.js';

const getSubCommand = (name: 'save' | 'resume'): SlashCommand => {
  const subCommand = chatCommand.subCommands?.find((cmd) => cmd.name === name);
  assertDefined(subCommand);
  return subCommand;
};

describe('checkpoint content validation', () => {
  describe('validateCheckpointContentBlock (unit)', () => {
    it('rejects non-object input', () => {
      expect(validateCheckpointContentBlock(null)).toBeNull();
      expect(validateCheckpointContentBlock('string')).toBeNull();
      expect(validateCheckpointContentBlock(42)).toBeNull();
      expect(validateCheckpointContentBlock(undefined)).toBeNull();
    });

    it('rejects objects without a string type field', () => {
      expect(validateCheckpointContentBlock({})).toBeNull();
      expect(validateCheckpointContentBlock({ type: 123 })).toBeNull();
    });

    it('rejects unknown block types', () => {
      expect(
        validateCheckpointContentBlock({ type: 'unknown_type', foo: 'bar' }),
      ).toBeNull();
    });

    it('validates a minimal text block', () => {
      expect(
        validateCheckpointContentBlock({ type: 'text', text: 'hi' }),
      ).toStrictEqual({
        type: 'text',
        text: 'hi',
      });
    });

    it('rejects text block missing required text field', () => {
      expect(validateCheckpointContentBlock({ type: 'text' })).toBeNull();
    });

    it('rejects tool_call missing required id', () => {
      expect(
        validateCheckpointContentBlock({
          type: 'tool_call',
          name: 'search',
          parameters: {},
        }),
      ).toBeNull();
    });

    it('rejects tool_response missing required toolName', () => {
      expect(
        validateCheckpointContentBlock({
          type: 'tool_response',
          callId: 'c1',
        }),
      ).toBeNull();
    });

    it('rejects media missing required data and encoding', () => {
      expect(
        validateCheckpointContentBlock({
          type: 'media',
          mimeType: 'image/png',
        }),
      ).toBeNull();
    });

    it('rejects thinking missing required thought', () => {
      expect(validateCheckpointContentBlock({ type: 'thinking' })).toBeNull();
    });

    it('rejects code missing required code', () => {
      expect(validateCheckpointContentBlock({ type: 'code' })).toBeNull();
    });
  });

  describe('checkpointPartToContentBlock legacy fallback', () => {
    it('falls back to legacy { text } shape for untyped parts', () => {
      expect(
        checkpointPartToContentBlock({ text: 'legacy text' } as never),
      ).toStrictEqual({ type: 'text', text: 'legacy text' });
    });

    it('does NOT rescue a typed block that was rejected by the validator', () => {
      // Has a recognized type but malformed optional — must NOT be rescued
      expect(
        checkpointPartToContentBlock({
          type: 'text',
          text: 'ok',
          providerMetadata: [1, 2],
        } as never),
      ).toBeNull();
    });

    it('returns null for non-object parts', () => {
      expect(checkpointPartToContentBlock('not-an-object' as never)).toBeNull();
      expect(checkpointPartToContentBlock(null as never)).toBeNull();
    });
  });

  describe('iContentToCheckpoint / checkpointToIContent round-trip', () => {
    it('preserves speaker, blocks, and metadata through round-trip', () => {
      const original: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'response' }],
        metadata: { model: 'gemini-pro', turnId: 'turn_abc' },
      };
      const checkpoint = iContentToCheckpoint(original);
      const restored = checkpointToIContent(checkpoint);
      expect(restored).toStrictEqual(original);
    });

    it('maps human speaker to user role', () => {
      const cp = iContentToCheckpoint({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hi' }],
      });
      expect(cp.role).toBe('user');
      expect(cp.speaker).toBe('human');
    });

    it('maps ai and tool speakers to model role', () => {
      const aiCp = iContentToCheckpoint({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'hi' }],
      });
      expect(aiCp.role).toBe('model');

      const toolCp = iContentToCheckpoint({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'fn',
            result: 'ok',
          },
        ],
      });
      expect(toolCp.role).toBe('model');
    });

    it('omits metadata when absent', () => {
      const cp = iContentToCheckpoint({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hi' }],
      });
      expect(cp.metadata).toBeUndefined();
    });

    it('falls back to legacy ContentConverters for checkpoints without speaker', () => {
      const legacy = checkpointToIContent({
        role: 'user',
        parts: [{ text: 'old hello' }],
      });
      expect(legacy.speaker).toBe('human');
      expect(legacy.blocks[0]).toMatchObject({
        type: 'text',
        text: 'old hello',
      });
    });
  });
});

describe('checkpoint content validation via command path', () => {
  let mockContext: CommandContext;
  let mockGetChat: ReturnType<typeof vi.fn>;
  let mockSaveCheckpoint: ReturnType<typeof vi.fn>;
  let mockLoadCheckpoint: ReturnType<typeof vi.fn>;
  let mockGetHistory: ReturnType<typeof vi.fn>;
  const goodTag = 'good-tag';

  beforeEach(() => {
    mockGetHistory = vi.fn().mockReturnValue([]);
    mockGetChat = vi.fn().mockReturnValue({
      getHistory: mockGetHistory,
      clearHistory: vi.fn(),
      addHistory: vi.fn(),
    });
    mockSaveCheckpoint = vi.fn().mockResolvedValue(undefined);
    mockLoadCheckpoint = vi.fn().mockResolvedValue({ history: [] });

    mockContext = createMockCommandContext({
      services: {
        config: {
          getProjectRoot: () => '/project/root',
          getAgentClient: () =>
            ({
              getChat: mockGetChat,
              hasChatInitialized: vi.fn().mockReturnValue(true),
              getHistory: vi.fn().mockResolvedValue([]),
            }) as unknown as AgentClient,
          storage: {
            getProjectTempDir: () => '/project/root/.gemini/tmp/mockhash',
          },
        },
        logger: {
          saveCheckpoint: mockSaveCheckpoint,
          loadCheckpoint: mockLoadCheckpoint,
          deleteCheckpoint: vi.fn().mockResolvedValue(true),
          initialize: vi.fn().mockResolvedValue(undefined),
        },
        settings: {
          merged: {
            enableFuzzyFiltering: false,
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves tool speaker through save/resume round-trip', async () => {
    const saveCmd = getSubCommand('save');
    const toolTurn: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-42',
          toolName: 'read_file',
          result: { content: 'file data' },
        },
      ],
    };
    mockGetHistory.mockReturnValue([
      { speaker: 'human', blocks: [{ type: 'text', text: 'setup' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'read it' }] },
      toolTurn,
    ]);
    mockContext.services.logger.checkpointExists = vi
      .fn()
      .mockResolvedValue(false);

    await saveCmd.action?.(mockContext, goodTag);

    const savedData = mockSaveCheckpoint.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    const toolEntry = savedData[savedData.length - 1];
    expect(toolEntry.speaker).toBe('tool');
    const parts = toolEntry.parts as unknown[];
    const toolResponsePart = parts[0] as Record<string, unknown>;
    expect(toolResponsePart.type).toBe('tool_response');
    expect(toolResponsePart.callId).toBe('call-42');
    expect(toolResponsePart.toolName).toBe('read_file');
  });

  it('preserves tool_call IDs and non-text blocks through save/resume round-trip', async () => {
    const saveCmd = getSubCommand('save');
    const resumeCommand = getSubCommand('resume');
    const aiToolCallTurn: IContent = {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool_call',
          id: 'call-99',
          name: 'list_dir',
          parameters: { path: '/tmp' },
        },
      ],
    };
    const toolResponseTurn: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-99',
          toolName: 'list_dir',
          result: { entries: ['a', 'b'] },
        },
      ],
    };
    mockGetHistory.mockReturnValue([
      { speaker: 'human', blocks: [{ type: 'text', text: 'setup' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'list' }] },
      aiToolCallTurn,
      toolResponseTurn,
    ]);
    mockContext.services.logger.checkpointExists = vi
      .fn()
      .mockResolvedValue(false);

    await saveCmd.action?.(mockContext, goodTag);
    const savedData = mockSaveCheckpoint.mock.calls[0][0];

    mockLoadCheckpoint.mockResolvedValue({ history: savedData });
    const result = await resumeCommand.action?.(mockContext, goodTag);

    expect(result).toBeDefined();
    expect(result?.type).toBe('load_history');
    const clientHistory = (result as { clientHistory: IContent[] })
      .clientHistory;

    const resumedAiTurn = clientHistory.find(
      (c) => c.speaker === 'ai' && c.blocks.some((b) => b.type === 'tool_call'),
    );
    expect(resumedAiTurn).toBeDefined();
    const toolCallBlock = resumedAiTurn!.blocks.find(
      (b): b is Extract<ContentBlock, { type: 'tool_call' }> =>
        b.type === 'tool_call',
    );
    expect(toolCallBlock).toBeDefined();
    expect(toolCallBlock!.id).toBe('call-99');
    expect(toolCallBlock!.name).toBe('list_dir');

    const resumedToolTurn = clientHistory.find((c) => c.speaker === 'tool');
    expect(resumedToolTurn).toBeDefined();
    const toolResponseBlock = resumedToolTurn!.blocks.find(
      (b): b is Extract<ContentBlock, { type: 'tool_response' }> =>
        b.type === 'tool_response',
    );
    expect(toolResponseBlock).toBeDefined();
    expect(toolResponseBlock!.callId).toBe('call-99');
    expect(toolResponseBlock!.toolName).toBe('list_dir');
  });

  it('preserves metadata through save/resume round-trip', async () => {
    const saveCmd = getSubCommand('save');
    const resumeCommand = getSubCommand('resume');
    const aiTurnWithMeta: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'response' }],
      metadata: { model: 'gemini-pro', turnId: 'turn_abc' },
    };
    mockGetHistory.mockReturnValue([
      { speaker: 'human', blocks: [{ type: 'text', text: 'setup' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      aiTurnWithMeta,
    ]);
    mockContext.services.logger.checkpointExists = vi
      .fn()
      .mockResolvedValue(false);

    await saveCmd.action?.(mockContext, goodTag);
    const savedData = mockSaveCheckpoint.mock.calls[0][0];

    mockLoadCheckpoint.mockResolvedValue({ history: savedData });
    const result = await resumeCommand.action?.(mockContext, goodTag);
    const clientHistory = (result as { clientHistory: IContent[] })
      .clientHistory;

    const resumedAiTurn = clientHistory.find(
      (c) => c.speaker === 'ai' && c.metadata !== undefined,
    );
    expect(resumedAiTurn).toBeDefined();
    expect(resumedAiTurn!.metadata).toMatchObject({
      model: 'gemini-pro',
      turnId: 'turn_abc',
    });
  });

  it('falls back to legacy conversion for checkpoints without neutral speaker', async () => {
    const resumeCommand = getSubCommand('resume');
    const legacyCheckpoint = [
      { role: 'user', parts: [{ text: 'old hello' }] },
      { role: 'model', parts: [{ text: 'old reply' }] },
    ];
    mockLoadCheckpoint.mockResolvedValue({ history: legacyCheckpoint });

    const result = await resumeCommand.action?.(mockContext, goodTag);
    expect(result).toBeDefined();
    const clientHistory = (result as { clientHistory: IContent[] })
      .clientHistory;
    expect(clientHistory[0].speaker).toBe('human');
    expect(clientHistory[1].speaker).toBe('ai');
    expect(clientHistory[0].blocks[0]).toMatchObject({
      type: 'text',
      text: 'old hello',
    });
  });

  it('rejects corrupted/unknown blocks from checkpoint (runtime validator)', async () => {
    const resumeCommand = getSubCommand('resume');
    const checkpointHistory = [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'valid text' },
          { type: 'unknown_type', foo: 'bar' },
          { type: 'text' },
          { type: 'tool_call', name: 'no_id' },
          {
            type: 'tool_response',
            callId: 'c1',
          },
          { type: 'media', mimeType: 'image/png' },
          { type: 'thinking' },
          { type: 'code' },
          'not-an-object',
          null,
        ],
        speaker: 'human',
      },
    ];
    mockLoadCheckpoint.mockResolvedValue({ history: checkpointHistory });

    await expect(resumeCommand.action?.(mockContext, goodTag)).rejects.toThrow(
      'Checkpoint contains an invalid neutral content block.',
    );
  });

  it('preserves all valid ContentBlock variants through the runtime validator', async () => {
    const resumeCommand = getSubCommand('resume');
    const checkpointHistory = [
      {
        role: 'model',
        speaker: 'ai',
        parts: [
          { type: 'text', text: 'response' },
          {
            type: 'tool_call',
            id: 'tc1',
            name: 'search',
            parameters: { q: 'hi' },
          },
          {
            type: 'thinking',
            thought: 'reasoning here',
            sourceField: 'thought',
          },
          { type: 'code', code: 'console.log(1)', language: 'ts' },
        ],
      },
      {
        role: 'model',
        speaker: 'tool',
        parts: [
          {
            type: 'tool_response',
            callId: 'tc1',
            toolName: 'search',
            result: 'found',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'base64data',
            encoding: 'base64',
          },
        ],
      },
    ];
    mockLoadCheckpoint.mockResolvedValue({ history: checkpointHistory });

    const result = await resumeCommand.action?.(mockContext, goodTag);
    expect(result).toBeDefined();
    const clientHistory = (result as { clientHistory: IContent[] })
      .clientHistory;
    expect(clientHistory).toHaveLength(2);

    expect(clientHistory[0].blocks).toHaveLength(4);
    expect(clientHistory[0].blocks.map((b) => b.type)).toStrictEqual([
      'text',
      'tool_call',
      'thinking',
      'code',
    ]);

    expect(clientHistory[1].blocks).toHaveLength(2);
    expect(clientHistory[1].blocks.map((b) => b.type)).toStrictEqual([
      'tool_response',
      'media',
    ]);
  });

  it('deep strict round-trip preserves all optional fields for every ContentBlock variant', async () => {
    const resumeCommand = getSubCommand('resume');
    const allBlocks: ContentBlock[] = [
      {
        type: 'text',
        text: 'hello',
        providerMetadata: { source: 'gemini', index: 0 },
      },
      {
        type: 'tool_call',
        id: 'tc1',
        name: 'search',
        parameters: { q: 'test' },
        description: 'Search the web',
        providerMetadata: { model: 'gpt-4' },
      },
      {
        type: 'tool_response',
        callId: 'tc1',
        toolName: 'search',
        result: { hits: 42 },
        error: 'partial failure',
        isComplete: false,
        providerMetadata: { latency: 123 },
      },
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'base64data==',
        encoding: 'base64',
        caption: 'A photo',
        filename: 'photo.png',
        providerMetadata: { width: 800 },
      },
      {
        type: 'thinking',
        thought: 'Let me reason about this',
        isHidden: true,
        sourceField: 'thinking',
        signature: 'sig-abc-123',
        encryptedContent: 'enc-content-xyz',
        providerMetadata: { model: 'claude' },
      },
      {
        type: 'code',
        code: 'console.log(1)',
        language: 'typescript',
        providerMetadata: { tool: 'eval' },
      },
    ];
    const checkpointHistory = [
      {
        role: 'model',
        speaker: 'ai',
        parts: allBlocks,
      },
    ];
    mockLoadCheckpoint.mockResolvedValue({ history: checkpointHistory });

    const result = await resumeCommand.action?.(mockContext, goodTag);
    expect(result).toBeDefined();
    const clientHistory = (result as { clientHistory: IContent[] })
      .clientHistory;
    expect(clientHistory).toHaveLength(1);
    expect(clientHistory[0].blocks).toStrictEqual(allBlocks);
  });

  it('rejects malformed optional fields (wrong types)', async () => {
    const resumeCommand = getSubCommand('resume');
    const malformedBlocks = [
      { type: 'text', text: 'ok', providerMetadata: [1, 2] },
      {
        type: 'tool_call',
        id: 'tc1',
        name: 'search',
        parameters: {},
        description: 123,
      },
      {
        type: 'tool_response',
        callId: 'c1',
        toolName: 'search',
        result: 'ok',
        error: 404,
      },
      {
        type: 'tool_response',
        callId: 'c2',
        toolName: 'search',
        result: 'ok',
        isComplete: 'yes',
      },
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'abc',
        encoding: 'base64',
        caption: 42,
      },
      {
        type: 'thinking',
        thought: 'hmm',
        sourceField: 'invalid_source',
      },
      {
        type: 'thinking',
        thought: 'hmm',
        signature: 99,
      },
      { type: 'code', code: 'x = 1', language: 42 },
    ];
    const checkpointHistory = [
      {
        role: 'model',
        speaker: 'ai',
        parts: malformedBlocks,
      },
    ];
    mockLoadCheckpoint.mockResolvedValue({ history: checkpointHistory });

    await expect(resumeCommand.action?.(mockContext, goodTag)).rejects.toThrow(
      'Checkpoint contains an invalid neutral content block.',
    );
  });
});
