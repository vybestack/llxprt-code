import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from '../services/history/HistoryService.js';
import { MessageConverters } from '../services/history/MessageConverters.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type { IMessage } from '../providers/IMessage.js';
import type { Content } from '@google/genai';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  ContentBlock,
} from '../services/history/IContent.js';

describe('Provider Switching Integration', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  it('should handle complete flow: OpenAI → History → Anthropic without 400 error', () => {
    // THE CRITICAL TEST - Preventing the 400 error when switching providers

    // 1. OpenAI sends tool calls (IMessage format)
    const openAIToolCall: IMessage = {
      role: 'assistant',
      content: "I'll help you read and process these files.",
      tool_calls: [
        {
          id: 'call_abc123xyz',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: '/tmp/data.txt' }),
          },
        },
        {
          id: 'call_def456uvw',
          type: 'function',
          function: {
            name: 'analyze_content',
            arguments: JSON.stringify({ content: 'placeholder' }),
          },
        },
      ],
    };

    // Convert to IContent and add to history
    const callContent = MessageConverters.toIContent(openAIToolCall, 'openai');
    historyService.add(callContent);

    // Verify history normalized the IDs
    const toolCall1 = callContent.blocks[1] as ToolCallBlock;
    const toolCall2 = callContent.blocks[2] as ToolCallBlock;
    expect(toolCall1.id).toMatch(/^hist_tool_/);
    expect(toolCall2.id).toMatch(/^hist_tool_/);

    // Store the mapping of original IDs to history IDs
    const idMapping = new Map([
      ['call_abc123xyz', toolCall1.id],
      ['call_def456uvw', toolCall2.id],
    ]);

    // 2. Tool responses arrive with original OpenAI IDs
    const toolResponse1: IMessage = {
      role: 'tool',
      tool_call_id: 'call_abc123xyz',
      name: 'read_file',
      content: 'File contents: Hello World',
    };

    const toolResponse2: IMessage = {
      role: 'tool',
      tool_call_id: 'call_def456uvw',
      name: 'analyze_content',
      content: 'Analysis complete: 2 words, 11 characters',
    };

    // Convert responses to IContent (they need to match the history IDs)
    const response1Content = MessageConverters.toIContent(
      toolResponse1,
      'openai',
      idMapping,
    );
    const response2Content = MessageConverters.toIContent(
      toolResponse2,
      'openai',
      idMapping,
    );

    historyService.add(response1Content);
    historyService.add(response2Content);

    // Verify responses got matched to correct history IDs
    const response1Block = response1Content.blocks[0] as ToolResponseBlock;
    const response2Block = response2Content.blocks[0] as ToolResponseBlock;
    expect(response1Block.callId).toBe(toolCall1.id);
    expect(response2Block.callId).toBe(toolCall2.id);

    // 3. Switch to Anthropic - need to convert history to Anthropic format
    const historyContents = historyService.getAll();

    // Create new ID mapping for Anthropic (history ID → Anthropic ID)
    const anthropicIdMap = new Map([
      [toolCall1.id, 'toolu_newid_001'],
      [toolCall2.id, 'toolu_newid_002'],
    ]);

    // Convert history to Anthropic messages
    const anthropicMessages = historyContents.map((content: IContent) =>
      MessageConverters.toAnthropicMessage(content, anthropicIdMap),
    );

    // 4. Verify no mismatched IDs that would cause 400 error
    const anthropicToolCall = anthropicMessages.find((m) => m.tool_calls);
    const anthropicResponses = anthropicMessages.filter(
      (m) => m.role === 'tool',
    );

    // All tool calls should have toolu_ format
    anthropicToolCall?.tool_calls?.forEach((tc: { id: string }) => {
      expect(tc.id).toMatch(/^toolu_/);
      expect(tc.id).not.toContain('call_');
      expect(tc.id).not.toContain('hist_');
    });

    // All tool responses should have matching toolu_ IDs
    anthropicResponses.forEach((response: IMessage, idx: number) => {
      expect(response.tool_call_id).toMatch(/^toolu_/);
      // Response IDs should match the corresponding tool call
      const matchingCallId = anthropicToolCall?.tool_calls?.[idx]?.id;
      expect(response.tool_call_id).toBe(matchingCallId);
    });

    // 5. Critical check: tool_result blocks reference existing tool_use IDs
    const toolUseIds =
      anthropicToolCall?.tool_calls?.map((tc: { id: string }) => tc.id) || [];
    const toolResultIds = anthropicResponses
      .map((r: IMessage) => r.tool_call_id)
      .filter((id: string | undefined): id is string => id !== undefined);

    toolResultIds.forEach((resultId: string) => {
      expect(toolUseIds).toContain(resultId);
    });
  });

  it('should handle OpenAI → Gemini → Anthropic transitions', () => {
    // Start with OpenAI
    const openAICall: IMessage = {
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_oai_123',
          type: 'function',
          function: {
            name: 'search',
            arguments: '{"query": "test"}',
          },
        },
      ],
    };

    const openAIContent = MessageConverters.toIContent(openAICall, 'openai');
    historyService.add(openAIContent);
    const historyId1 = (openAIContent.blocks[0] as ToolCallBlock).id;

    const openAIResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'call_oai_123',
      name: 'search',
      content: 'Search results',
    };

    const responseContent = MessageConverters.toIContent(
      openAIResponse,
      'openai',
      new Map([['call_oai_123', historyId1]]),
    );
    historyService.add(responseContent);

    // Switch to Gemini (uses Content format, position-based)
    const history = historyService.getAll();
    const _geminiContents = history.map((h: IContent) =>
      ContentConverters.toGeminiContent(h),
    );

    // Gemini continues conversation (no IDs needed)
    const geminiCall: Content = {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'write_file',
            args: { path: 'out.txt', content: 'data' },
            // No ID - Gemini is position-based
          },
        },
      ],
    };

    const geminiCallContent = ContentConverters.toIContent(geminiCall);
    historyService.add(geminiCallContent);

    const geminiResponse: Content = {
      role: 'user', // Gemini uses 'user' for tool responses
      parts: [
        {
          functionResponse: {
            name: 'write_file',
            response: { result: 'File written' },
            // No ID - matched by position
          },
        },
      ],
    };

    const geminiResponseContent = ContentConverters.toIContent(geminiResponse);
    // Match by position to the most recent tool call
    (geminiResponseContent.blocks[0] as ToolResponseBlock).callId = (
      geminiCallContent.blocks[0] as ToolCallBlock
    ).id;
    historyService.add(geminiResponseContent);

    // Finally switch to Anthropic
    const fullHistory = historyService.getAll();

    // Create Anthropic ID mapping
    const anthropicMap = new Map<string, string>();
    let anthropicIdCounter = 1;
    fullHistory.forEach((content: IContent) => {
      content.blocks.forEach((block: ContentBlock) => {
        if (block.type === 'tool_call') {
          const toolCallBlock = block as ToolCallBlock;
          if (toolCallBlock.id && !anthropicMap.has(toolCallBlock.id)) {
            anthropicMap.set(toolCallBlock.id, `toolu_${anthropicIdCounter++}`);
          }
        }
      });
    });

    const anthropicMessages = fullHistory.map((c: IContent) =>
      MessageConverters.toAnthropicMessage(c, anthropicMap),
    );

    // Verify all tool pairs are properly matched with Anthropic IDs
    const anthropicToolCalls = anthropicMessages
      .filter((m: IMessage) => m.tool_calls)
      .flatMap((m: IMessage) => m.tool_calls || []);
    const anthropicToolResponses = anthropicMessages.filter(
      (m: IMessage) => m.role === 'tool',
    );

    // All should have toolu_ format
    anthropicToolCalls.forEach((tc: { id: string }) => {
      expect(tc.id).toMatch(/^toolu_/);
    });

    anthropicToolResponses.forEach((tr: IMessage) => {
      if (tr.tool_call_id) {
        expect(tr.tool_call_id).toMatch(/^toolu_/);
      }
    });

    // Each response should match a call
    const callIds = anthropicToolCalls.map((tc: { id: string }) => tc.id);
    anthropicToolResponses.forEach((tr: IMessage) => {
      if (tr.tool_call_id) {
        expect(callIds).toContain(tr.tool_call_id);
      }
    });
  });

  it('should handle Anthropic → OpenAI transitions', () => {
    // Start with Anthropic
    const anthropicCall: IMessage = {
      role: 'assistant',
      content: 'Let me check that for you.',
      tool_calls: [
        {
          id: 'toolu_abc789xyz',
          type: 'function',
          function: {
            name: 'get_info',
            arguments: '{"topic": "weather"}',
          },
        },
      ],
    };

    const anthropicContent = MessageConverters.toIContent(
      anthropicCall,
      'anthropic',
    );
    historyService.add(anthropicContent);
    const historyId = (anthropicContent.blocks[1] as ToolCallBlock).id; // text is [0], tool call is [1]

    const anthropicResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'toolu_abc789xyz',
      name: 'get_info',
      content: 'Sunny, 75°F',
    };

    const responseContent = MessageConverters.toIContent(
      anthropicResponse,
      'anthropic',
      new Map([['toolu_abc789xyz', historyId]]),
    );
    historyService.add(responseContent);

    // Switch to OpenAI
    const history = historyService.getAll();

    // Create OpenAI ID mapping
    const openAIMap = new Map([[historyId, 'call_newopenai_123']]);

    const openAIMessages = history.map((c: IContent) =>
      MessageConverters.toOpenAIMessage(c, openAIMap),
    );

    // Verify OpenAI format
    const openAIToolCall = openAIMessages.find((m: IMessage) => m.tool_calls);
    const openAIToolResponse = openAIMessages.find(
      (m: IMessage) => m.role === 'tool',
    );

    expect(openAIToolCall?.tool_calls?.[0].id).toBe('call_newopenai_123');
    expect(openAIToolResponse?.tool_call_id).toBe('call_newopenai_123');

    // No Anthropic IDs should leak through
    expect(openAIToolCall?.tool_calls?.[0].id).not.toContain('toolu_');
    expect(openAIToolResponse?.tool_call_id).not.toContain('toolu_');
  });

  it('should maintain conversation continuity across multiple provider switches', () => {
    // Simulate a complex conversation with multiple switches

    // User starts
    const userMessage: IMessage = {
      role: 'user',
      content: 'Help me analyze some data',
    };
    historyService.add(MessageConverters.toIContent(userMessage, 'user'));

    // OpenAI responds with tool
    const openAICall: IMessage = {
      role: 'assistant',
      content: "I'll analyze that data for you.",
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'load_data', arguments: '{}' },
        },
      ],
    };
    const openAIContent = MessageConverters.toIContent(openAICall, 'openai');
    historyService.add(openAIContent);
    const toolId1 = (openAIContent.blocks[1] as ToolCallBlock).id;

    const openAIResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'load_data',
      content: 'Data loaded: 1000 records',
    };
    historyService.add(
      MessageConverters.toIContent(
        openAIResponse,
        'openai',
        new Map([['call_1', toolId1]]),
      ),
    );

    // Switch to Anthropic
    const anthropicCall: IMessage = {
      role: 'assistant',
      content: 'Now processing the data.',
      tool_calls: [
        {
          id: 'toolu_2',
          type: 'function',
          function: { name: 'process_data', arguments: '{}' },
        },
      ],
    };
    const anthropicContent = MessageConverters.toIContent(
      anthropicCall,
      'anthropic',
    );
    historyService.add(anthropicContent);
    const toolId2 = (anthropicContent.blocks[1] as ToolCallBlock).id;

    const anthropicResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'toolu_2',
      name: 'process_data',
      content: 'Processing complete',
    };
    historyService.add(
      MessageConverters.toIContent(
        anthropicResponse,
        'anthropic',
        new Map([['toolu_2', toolId2]]),
      ),
    );

    // Switch to Gemini
    const geminiCall: Content = {
      role: 'model',
      parts: [
        { text: 'Generating report.' },
        {
          functionCall: {
            name: 'generate_report',
            args: {},
            // No ID
          },
        },
      ],
    };
    const geminiContent = ContentConverters.toIContent(geminiCall);
    historyService.add(geminiContent);
    const toolId3 = (geminiContent.blocks[1] as ToolCallBlock).id;

    const geminiResponse: Content = {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'generate_report',
            response: { status: 'Report generated' },
          },
        },
      ],
    };
    const geminiResponseContent = ContentConverters.toIContent(geminiResponse);
    (geminiResponseContent.blocks[0] as ToolResponseBlock).callId = toolId3; // Match by position
    historyService.add(geminiResponseContent);

    // Get final history
    const finalHistory = historyService.getAll();

    // Verify all tool pairs have matching history IDs
    const toolCalls = finalHistory.filter((c: IContent) =>
      c.blocks.some((b: ContentBlock) => b.type === 'tool_call'),
    );
    const toolResponses = finalHistory.filter((c: IContent) =>
      c.blocks.some((b: ContentBlock) => b.type === 'tool_response'),
    );

    expect(toolCalls).toHaveLength(3);
    expect(toolResponses).toHaveLength(3);

    // Each call should have a matching response
    const callIds = new Set<string>();
    toolCalls.forEach((call: IContent) => {
      call.blocks.forEach((block: ContentBlock) => {
        if (block.type === 'tool_call') {
          const toolCallBlock = block as ToolCallBlock;
          if (toolCallBlock.id) {
            callIds.add(toolCallBlock.id);
          }
        }
      });
    });

    const responseIds = new Set<string>();
    toolResponses.forEach((response: IContent) => {
      response.blocks.forEach((block: ContentBlock) => {
        if (block.type === 'tool_response') {
          const toolResponseBlock = block as ToolResponseBlock;
          if (toolResponseBlock.callId) {
            responseIds.add(toolResponseBlock.callId);
          }
        }
      });
    });

    // All call IDs should have matching response IDs
    callIds.forEach((id: string) => {
      expect(responseIds.has(id)).toBe(true);
    });
  });

  // NEW TESTS FOR ID NORMALIZATION ARCHITECTURE
  // These tests SHOULD FAIL initially - that's the point of TDD
  describe('ID Normalization Architecture - NEW FAILING TESTS', () => {
    it('should use HistoryService callbacks throughout provider switching flow', () => {
      // FAILING TEST: Complete flow should use HistoryService as ONLY ID generator

      // Start with OpenAI using HistoryService callbacks
      const openAIMessage: IMessage = {
        role: 'assistant',
        content: 'Processing with callbacks',
        tool_calls: [
          {
            id: 'call_original_123',
            type: 'function',
            function: { name: 'callback_tool', arguments: '{}' },
          },
        ],
      };

      // HistoryService should provide callbacks to converters
      const generateIdCallback = historyService.getIdGeneratorCallback();
      const idMapping = new Map<string, string>();

      // Convert using callbacks (not internal generation)
      const iContent = MessageConverters.toIContent(
        openAIMessage,
        'openai',
        idMapping,
        generateIdCallback,
      );

      // Should use callback-generated IDs
      const toolCall = iContent.blocks[1] as ToolCallBlock;
      expect(toolCall.id).toMatch(
        /^hist_tool_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      // Add to history
      historyService.add(iContent);
    });

    it('should verify NO internal ID generation in converters after refactor', () => {
      // FAILING TEST: After refactor, converters should not generate IDs internally

      // Check that private generateHistoryToolId method doesn't exist in MessageConverters
      expect(
        (
          MessageConverters as {
            generateHistoryToolId?: () => string;
          } & typeof MessageConverters
        ).generateHistoryToolId,
      ).toBeUndefined();

      // Check that generateHistoryId function is not exported from ContentConverters module
      // The function should be internal only (not exported)
      expect(
        (
          ContentConverters as {
            generateHistoryId?: () => string;
          } & typeof ContentConverters
        ).generateHistoryId,
      ).toBeUndefined();

      // Verify that all ID generation goes through HistoryService
      const openAIMessage: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_no_internal',
            type: 'function',
            function: { name: 'test', arguments: '{}' },
          },
        ],
      };

      // Without callback, should either fail gracefully or use fallback
      const _result = MessageConverters.toIContent(
        openAIMessage,
        'openai',
        new Map(),
      );

      // But with HistoryService callback, should work
      const withCallback = MessageConverters.toIContent(
        openAIMessage,
        'openai',
        new Map(),
        historyService.getIdGeneratorCallback(),
      );

      const toolCallWithCallback = withCallback.blocks[0] as ToolCallBlock;
      expect(toolCallWithCallback.id).toMatch(/^hist_tool_/);
    });
  });
});
