import { describe, it, expect } from 'vitest';
import { ContentConverters } from '../services/history/ContentConverters.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { Content } from '@google/genai';
import type { IContent, IMessage } from '../services/history/IContent.js';

// Type definitions for Anthropic content blocks
type AnthropicTextContent = {
  type: 'text';
  text: string;
};

type AnthropicToolUseContent = {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
};

type AnthropicToolResultContent = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
};

type AnthropicContentBlock =
  | AnthropicTextContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent;

describe('Gemini Provider Switching - MUST FAIL FIRST', () => {
  it('🔥 MUST normalize Gemini tool call IDs to history format', () => {
    const geminiContent: Content = {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'glob',
            args: { pattern: '**/*.ts' },
            id: 'call_1756842007518_9ite1k9vb',
          },
        },
      ],
    };

    const iContent = ContentConverters.toIContent(geminiContent);
    const toolCall = iContent.blocks[0];

    console.error('💥 ACTUAL ID:', toolCall.id);
    console.error('✨ EXPECTED: hist_tool_*');

    expect(toolCall.id).toMatch(/^hist_tool_/);
    expect(toolCall.id).not.toBe('call_1756842007518_9ite1k9vb');
  });

  it('🎯 MUST handle Gemini → OpenAI provider switch without 400', () => {
    const geminiCall: Content = {
      role: 'model',
      parts: [
        {
          text: "I'll search for files",
        },
        {
          functionCall: {
            name: 'glob',
            args: { pattern: '*.ts' },
            id: 'call_gemini_12345',
          },
        },
      ],
    };

    const historyContent = ContentConverters.toIContent(geminiCall);
    const toolCallBlock = historyContent.blocks.find(
      (b) => b.type === 'tool_call',
    );
    const historyId = toolCallBlock?.id;

    console.error('💥 Tool call ID:', historyId);
    expect(historyId).toMatch(/^hist_tool_/);

    const toolResponse: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: historyId!,
          toolName: 'glob',
          result: 'Found 50 files',
        },
      ],
    };

    const openAIMessage = ContentConverters.toOpenAIMessage(historyContent);
    const openAIToolCalls = openAIMessage.tool_calls || [];

    expect(openAIToolCalls.length).toBeGreaterThan(0);
    expect(openAIToolCalls[0].id).toMatch(/^call_/);
    expect(openAIToolCalls[0].id).not.toContain('gemini');

    const openAIResponse = ContentConverters.toOpenAIMessage(toolResponse);

    expect(openAIResponse.tool_call_id).toBe(openAIToolCalls[0].id);
  });

  it('💥 MUST handle Gemini → Anthropic provider switch', () => {
    const geminiCall: Content = {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'test_tool',
            args: { value: 'test' },
            id: 'call_gemini_abc123',
          },
        },
      ],
    };

    const historyContent = ContentConverters.toIContent(geminiCall);
    const toolCallBlock = historyContent.blocks.find(
      (b) => b.type === 'tool_call',
    );

    console.error('🔥 Original Gemini ID: call_gemini_abc123');
    console.error('🔥 History ID:', toolCallBlock?.id);

    expect(toolCallBlock?.id).toMatch(/^hist_tool_/);

    const anthropicMessage =
      ContentConverters.toAnthropicMessage(historyContent);
    const toolUseBlock = (
      anthropicMessage.content as AnthropicContentBlock[]
    )?.find((c): c is AnthropicToolUseContent => c.type === 'tool_use');

    expect(toolUseBlock?.id).toMatch(/^toolu_/);

    const toolResponse: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: toolCallBlock!.id,
          toolName: 'test_tool',
          result: 'test result',
        },
      ],
    };

    const anthropicResponse =
      ContentConverters.toAnthropicMessage(toolResponse);
    const toolResultBlock = (
      anthropicResponse.content as AnthropicContentBlock[]
    )?.find((c): c is AnthropicToolResultContent => c.type === 'tool_result');

    expect(toolResultBlock?.tool_use_id).toBe(toolUseBlock?.id);
  });

  it('💣 MUST handle OpenAI/Qwen SHORT ID format tool calls and responses', () => {
    const shortIdCall: IMessage = {
      role: 'assistant',
      tool_calls: [
        {
          id: 'c050a3d56',
          type: 'function',
          function: { name: 'glob', arguments: '{}' },
        },
      ],
    };

    const shortIdResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'c050a3d56',
      name: 'glob',
      content: 'results',
    };

    const callHistory = ContentConverters.toIContent(shortIdCall, 'openai');
    const responseHistory = ContentConverters.toIContent(
      shortIdResponse,
      'openai',
    );

    const toolCallBlock = callHistory.blocks.find(
      (b) => b.type === 'tool_call',
    );
    const toolResponseBlock = responseHistory.blocks.find(
      (b) => b.type === 'tool_response',
    );

    console.error('🔥 SHORT ID call:', toolCallBlock?.id);
    console.error('🔥 SHORT ID response callId:', toolResponseBlock?.callId);

    expect(toolCallBlock?.id).toMatch(/^hist_tool_/);
    expect(toolResponseBlock?.callId).toMatch(/^hist_tool_/);
    expect(toolResponseBlock?.callId).toBe(toolCallBlock?.id);
  });

  it('🚨 MUST convert tool RESPONSES correctly when switching providers', () => {
    const openAICall: IMessage = {
      role: 'assistant',
      tool_calls: [
        {
          id: 'abc123',
          type: 'function',
          function: { name: 'test', arguments: '{}' },
        },
      ],
    };

    const openAIResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'abc123',
      name: 'test',
      content: 'result',
    };

    const callHistory = ContentConverters.toIContent(openAICall, 'openai');
    const responseHistory = ContentConverters.toIContent(
      openAIResponse,
      'openai',
    );

    const anthropicCall = ContentConverters.toAnthropicMessage(callHistory);
    const anthropicResponse =
      ContentConverters.toAnthropicMessage(responseHistory);

    const toolUse = (anthropicCall.content as AnthropicContentBlock[])?.find(
      (c): c is AnthropicToolUseContent => c.type === 'tool_use',
    );
    const toolResult = (
      anthropicResponse.content as AnthropicContentBlock[]
    )?.find((c): c is AnthropicToolResultContent => c.type === 'tool_result');

    console.error('🎯 Anthropic tool_use ID:', toolUse?.id);
    console.error('🎯 Anthropic tool_result ID:', toolResult?.tool_use_id);

    expect(toolUse?.id).toMatch(/^toolu_/);
    expect(toolResult?.tool_use_id).toBe(toolUse?.id);
  });

  it('⚠️ MUST handle orphaned tool responses after provider switch', () => {
    const historyService = new HistoryService();

    const openAICall: IMessage = {
      role: 'assistant',
      tool_calls: [
        {
          id: 'c050a3d56',
          type: 'function',
          function: { name: 'glob', arguments: '{}' },
        },
      ],
    };

    historyService.addMessage(openAICall, 'openai');

    const toolResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'c050a3d56',
      name: 'glob',
      content: 'results',
    };

    historyService.addMessage(toolResponse, 'openai');

    // Get the history and convert to Anthropic format
    const history = historyService.getAll();

    // Convert each content to Anthropic messages
    const anthropicMessages = history.map((content) =>
      ContentConverters.toAnthropicMessage(content),
    );

    const hasOrphanedResponse = anthropicMessages.some((msg) =>
      (msg.content as AnthropicContentBlock[])?.some(
        (c): c is AnthropicToolResultContent =>
          c.type === 'tool_result' && c.tool_use_id === 'c050a3d56',
      ),
    );

    console.error(
      '🔥 Checking for orphaned response with original ID "c050a3d56"',
    );
    expect(hasOrphanedResponse).toBe(false);

    const assistantMsg = anthropicMessages.find((m) => m.role === 'assistant');
    const toolMsg = anthropicMessages.find(
      (m) =>
        m.role === 'user' &&
        (m.content as AnthropicContentBlock[])?.some(
          (c): c is AnthropicToolResultContent => c.type === 'tool_result',
        ),
    );

    if (assistantMsg && toolMsg) {
      const toolUse = (assistantMsg.content as AnthropicContentBlock[])?.find(
        (c): c is AnthropicToolUseContent => c.type === 'tool_use',
      );
      const toolResult = (toolMsg.content as AnthropicContentBlock[])?.find(
        (c): c is AnthropicToolResultContent => c.type === 'tool_result',
      );

      console.error('✨ Tool use ID:', toolUse?.id);
      console.error('✨ Tool result ID:', toolResult?.tool_use_id);

      expect(toolUse?.id).toMatch(/^toolu_/);
      expect(toolResult?.tool_use_id).toBe(toolUse?.id);
    }
  });
});
