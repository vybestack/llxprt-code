/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'bun:test';
import type { Mock } from 'bun:test';
import { copyToClipboard } from '../utils/commandUtils.js';
import { createCopyCommand, type CopyCommandOutput } from './copyCommand.js';

void vi.mock('../utils/commandUtils.js', () => ({
  copyToClipboard: vi.fn(),
}));

describe('copyCommand', () => {
  let mockCopyToClipboard: Mock<typeof copyToClipboard>;
  let latestOutput: CopyCommandOutput;
  let copyCommand: ReturnType<typeof createCopyCommand>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCopyToClipboard = copyToClipboard as Mock<typeof copyToClipboard>;
    latestOutput = { kind: 'no-chat' };
    copyCommand = createCopyCommand(async () => latestOutput, copyToClipboard);
  });

  it('should return info message when no history is available', async () => {
    latestOutput = { kind: 'no-chat' };
    const result = await copyCommand.action();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No chat history available yet',
    });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it('should return info message when history is empty', async () => {
    latestOutput = { kind: 'no-output' };
    const result = await copyCommand.action();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No output in history',
    });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it('should return info message when no AI messages are found in history', async () => {
    latestOutput = { kind: 'no-output' };
    const result = await copyCommand.action();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No output in history',
    });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it('should copy the last AI message to the clipboard successfully', async () => {
    latestOutput = { kind: 'text', text: 'Hi there! How can I help you?' };
    mockCopyToClipboard.mockResolvedValue(undefined);
    const result = await copyCommand.action();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'Hi there! How can I help you?',
    );
  });

  it('should handle multiple text parts in the latest output', async () => {
    latestOutput = { kind: 'text', text: 'Part 1: Part 2: Part 3' };
    mockCopyToClipboard.mockResolvedValue(undefined);
    const result = await copyCommand.action();

    expect(mockCopyToClipboard).toHaveBeenCalledWith('Part 1: Part 2: Part 3');
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });

  it('should copy text extracted from output containing non-text blocks', async () => {
    latestOutput = { kind: 'text', text: 'Text part more text' };
    mockCopyToClipboard.mockResolvedValue(undefined);
    const result = await copyCommand.action();

    expect(mockCopyToClipboard).toHaveBeenCalledWith('Text part more text');
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });

  it('should copy the latest AI output when multiple AI messages exist', async () => {
    latestOutput = { kind: 'text', text: 'Second AI response' };
    mockCopyToClipboard.mockResolvedValue(undefined);
    const result = await copyCommand.action();

    expect(mockCopyToClipboard).toHaveBeenCalledWith('Second AI response');
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });

  it('should handle clipboard copy error', async () => {
    latestOutput = { kind: 'text', text: 'AI response' };
    const clipboardError = new Error('Clipboard access denied');
    mockCopyToClipboard.mockRejectedValue(clipboardError);
    const result = await copyCommand.action();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: `Failed to copy to the clipboard. ${clipboardError.message}`,
    });
  });

  it('should handle non-Error clipboard errors', async () => {
    latestOutput = { kind: 'text', text: 'AI response' };
    const rejectedValue = 'String error';
    mockCopyToClipboard.mockRejectedValue(rejectedValue);
    const result = await copyCommand.action();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: `Failed to copy to the clipboard. ${rejectedValue}`,
    });
  });

  it('should return info message when no text parts exist in the AI output', async () => {
    latestOutput = { kind: 'empty' };
    const result = await copyCommand.action();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last AI output contains no text to copy.',
    });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  it('should report when the registered owner has no chat', async () => {
    latestOutput = { kind: 'no-chat' };
    const result = await copyCommand.action();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No chat history available yet',
    });
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});
