/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentClientContract } from '../core/clientContract.js';
import { debugLogger } from './debugLogger.js';
import {
  summarizeToolOutput,
  llmSummarizer,
  defaultSummarizer,
} from './summarizer.js';
import type { ToolResult } from '@vybestack/llxprt-code-tools';

describe('summarizers', () => {
  let mockAgentClient: AgentClientContract;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    mockAgentClient = {
      generateContent: vi.fn(),
    } as unknown as AgentClientContract;

    vi.spyOn(debugLogger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    (debugLogger.error as Mock).mockRestore();
  });

  describe('summarizeToolOutput', () => {
    it('should return original text if it is shorter than maxLength', async () => {
      const shortText = 'This is a short text.';
      const result = await summarizeToolOutput(
        shortText,
        mockAgentClient,
        abortSignal,
        2000,
      );
      expect(result).toBe(shortText);
      expect(mockAgentClient.generateContent).not.toHaveBeenCalled();
    });

    it('should return original text if it is empty', async () => {
      const emptyText = '';
      const result = await summarizeToolOutput(
        emptyText,
        mockAgentClient,
        abortSignal,
        2000,
      );
      expect(result).toBe(emptyText);
      expect(mockAgentClient.generateContent).not.toHaveBeenCalled();
    });

    it('should call generateContent if text is longer than maxLength', async () => {
      const longText = 'This is a very long text.'.repeat(200);
      const summary = 'This is a summary.';
      (mockAgentClient.generateContent as Mock).mockResolvedValue({
        candidates: [{ content: { parts: [{ text: summary }] } }],
      });

      const result = await summarizeToolOutput(
        longText,
        mockAgentClient,
        abortSignal,
        2000,
      );

      expect(mockAgentClient.generateContent).toHaveBeenCalledTimes(1);
      expect(result).toBe(summary);
    });

    it('should return original text if generateContent throws an error', async () => {
      const longText = 'This is a very long text.'.repeat(200);
      const error = new Error('API Error');
      (mockAgentClient.generateContent as Mock).mockRejectedValue(error);

      const result = await summarizeToolOutput(
        longText,
        mockAgentClient,
        abortSignal,
        2000,
      );

      expect(mockAgentClient.generateContent).toHaveBeenCalledTimes(1);
      expect(result).toBe(longText);
      expect(debugLogger.error).toHaveBeenCalledWith(
        'Failed to summarize tool output.',
        error,
      );
    });

    it('should construct the correct prompt for summarization', async () => {
      const longText = 'This is a very long text.'.repeat(200);
      const summary = 'This is a summary.';
      (mockAgentClient.generateContent as Mock).mockResolvedValue({
        candidates: [{ content: { parts: [{ text: summary }] } }],
      });

      await summarizeToolOutput(longText, mockAgentClient, abortSignal, 1000);

      const expectedPrompt = `Summarize the following tool output to be a maximum of 1000 tokens. The summary should be concise and capture the main points of the tool output.

The summarization should be done based on the content that is provided. Here are the basic rules to follow:
1. If the text is a directory listing or any output that is structural, use the history of the conversation to understand the context. Using this context try to understand what information we need from the tool output and return that as a response.
2. If the text is text content and there is nothing structural that we need, summarize the text.
3. If the text is the output of a shell command, use the history of the conversation to understand the context. Using this context try to understand what information we need from the tool output and return a summarization along with the stack trace of any error within the <error></error> tags. The stack trace should be complete and not truncated. If there are warnings, you should include them in the summary within <warning></warning> tags.


Text to summarize:
"${longText}"

Return the summary string which should first contain an overall summarization of text followed by the full stack trace of errors and warnings in the tool output.
`;
      const calledWith = (mockAgentClient.generateContent as Mock).mock
        .calls[0];
      const contents = calledWith[0];
      expect(contents[0].parts[0].text).toBe(expectedPrompt);
    });
  });

  describe('llmSummarizer', () => {
    it('should summarize tool output using summarizeToolOutput', async () => {
      const toolResult: ToolResult = {
        llmContent: 'This is a very long text.'.repeat(200),
        returnDisplay: '',
      };
      const summary = 'This is a summary.';
      (mockAgentClient.generateContent as Mock).mockResolvedValue({
        candidates: [{ content: { parts: [{ text: summary }] } }],
      });

      const result = await llmSummarizer(
        toolResult,
        mockAgentClient,
        abortSignal,
      );

      expect(mockAgentClient.generateContent).toHaveBeenCalledTimes(1);
      expect(result).toBe(summary);
    });

    it('should handle different llmContent types', async () => {
      const longText = 'This is a very long text.'.repeat(200);
      const toolResult: ToolResult = {
        llmContent: [{ text: longText }],
        returnDisplay: '',
      };
      const summary = 'This is a summary.';
      (mockAgentClient.generateContent as Mock).mockResolvedValue({
        candidates: [{ content: { parts: [{ text: summary }] } }],
      });

      const result = await llmSummarizer(
        toolResult,
        mockAgentClient,
        abortSignal,
      );

      expect(mockAgentClient.generateContent).toHaveBeenCalledTimes(1);
      const calledWith = (mockAgentClient.generateContent as Mock).mock
        .calls[0];
      const contents = calledWith[0];
      expect(contents[0].parts[0].text).toContain(`"${longText}"`);
      expect(result).toBe(summary);
    });
  });

  describe('defaultSummarizer', () => {
    it('should stringify the llmContent', async () => {
      const toolResult: ToolResult = {
        llmContent: { text: 'some data' },
        returnDisplay: '',
      };

      const result = await defaultSummarizer(
        toolResult,
        mockAgentClient,
        abortSignal,
      );

      expect(result).toBe(JSON.stringify({ text: 'some data' }));
      expect(mockAgentClient.generateContent).not.toHaveBeenCalled();
    });
  });
});
