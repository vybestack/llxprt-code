/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { copyCommand } from './copyCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { copyToClipboard } from '../utils/commandUtils.js';

vi.mock('../utils/commandUtils.js', () => ({
  copyToClipboard: vi.fn(),
}));

describe('copyCommand', () => {
  let mockContext: CommandContext;
  let mockCopyToClipboard: Mock;
  let mockGetChat: Mock;
  let mockGetHistory: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCopyToClipboard = vi.mocked(copyToClipboard);
    mockGetChat = vi.fn();
    mockGetHistory = vi.fn();

    mockContext = createMockCommandContext({
      services: {
        config: {
          getAgentClient: () => ({
            getChat: mockGetChat,
            hasChatInitialized: vi.fn().mockReturnValue(true),
            getHistory: vi.fn().mockResolvedValue([]),
          }),
        },
      },
    });

    mockGetChat.mockReturnValue({
      getHistory: mockGetHistory,
    });
  });

  it('should return info message when no history is available', async () => {
    // Mock no chat initialized
    mockContext = createMockCommandContext({
      services: {
        config: {
          getAgentClient: () => ({
            getChat: mockGetChat,
            hasChatInitialized: vi.fn().mockReturnValue(false),
            getHistory: vi.fn().mockResolvedValue([]),
          }),
        },
      },
    });

    const result = await copyCommand.action!(mockContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No chat history available yet',
    });

    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it('should return info message when history is empty', async () => {
    mockGetHistory.mockReturnValue([]);

    const result = await copyCommand.action!(mockContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No output in history',
    });

    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it('should return info message when no AI messages are found in history', async () => {
    const historyWithUserOnly = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
    ];

    mockGetHistory.mockReturnValue(historyWithUserOnly);

    const result = await copyCommand.action!(mockContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No output in history',
    });

    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it('should copy last AI message to clipboard successfully', async () => {
    const historyWithAiMessage = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hi there! How can I help you?' }],
      },
    ];

    mockGetHistory.mockReturnValue(historyWithAiMessage);
    mockCopyToClipboard.mockResolvedValue(undefined);

    const result = await copyCommand.action!(mockContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });

    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'Hi there! How can I help you?',
    );
  });

  it('should handle multiple text parts in AI message', async () => {
    const historyWithMultipleParts = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Part 1: ' },
          { type: 'text', text: 'Part 2: ' },
          { type: 'text', text: 'Part 3' },
        ],
      },
    ];

    mockGetHistory.mockReturnValue(historyWithMultipleParts);
    mockCopyToClipboard.mockResolvedValue(undefined);

    const result = await copyCommand.action!(mockContext, '');

    expect(mockCopyToClipboard).toHaveBeenCalledWith('Part 1: Part 2: Part 3');
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });

  it('should filter out non-text parts', async () => {
    const historyWithMixedParts = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Text part' },
          { type: 'media', mediaType: 'image/jpeg', data: 'base64data' },
          { type: 'text', text: ' more text' },
        ],
      },
    ];

    mockGetHistory.mockReturnValue(historyWithMixedParts);
    mockCopyToClipboard.mockResolvedValue(undefined);

    const result = await copyCommand.action!(mockContext, '');

    expect(mockCopyToClipboard).toHaveBeenCalledWith('Text part more text');
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });

  it('should get the last AI message when multiple AI messages exist', async () => {
    const historyWithMultipleAiMessages = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'First AI response' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'User message' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Second AI response' }],
      },
    ];

    mockGetHistory.mockReturnValue(historyWithMultipleAiMessages);
    mockCopyToClipboard.mockResolvedValue(undefined);

    const result = await copyCommand.action!(mockContext, '');

    expect(mockCopyToClipboard).toHaveBeenCalledWith('Second AI response');
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });

  it('should handle clipboard copy error', async () => {
    const historyWithAiMessage = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'AI response' }],
      },
    ];

    mockGetHistory.mockReturnValue(historyWithAiMessage);
    const clipboardError = new Error('Clipboard access denied');
    mockCopyToClipboard.mockRejectedValue(clipboardError);

    const result = await copyCommand.action!(mockContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: `Failed to copy to the clipboard. ${clipboardError.message}`,
    });
  });

  it('should handle non-Error clipboard errors', async () => {
    const historyWithAiMessage = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'AI response' }],
      },
    ];

    mockGetHistory.mockReturnValue(historyWithAiMessage);
    const rejectedValue = 'String error';
    mockCopyToClipboard.mockRejectedValue(rejectedValue);

    const result = await copyCommand.action!(mockContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: `Failed to copy to the clipboard. ${rejectedValue}`,
    });
  });

  it('should return info message when no text parts found in AI message', async () => {
    const historyWithEmptyParts = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'media', mediaType: 'image/jpeg', data: 'base64data' },
        ], // No text blocks
      },
    ];

    mockGetHistory.mockReturnValue(historyWithEmptyParts);

    const result = await copyCommand.action!(mockContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last AI output contains no text to copy.',
    });

    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it('should handle unavailable config service', async () => {
    const nullConfigContext = createMockCommandContext({
      services: { config: null },
    });

    const result = await copyCommand.action!(nullConfigContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No chat history available yet',
    });

    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
