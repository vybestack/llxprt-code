import { describe, it, expect } from 'vitest';
import { HistoryService } from '../services/history/HistoryService.js';
import { MessageConverters } from '../services/history/MessageConverters.js';
import type { IMessage } from '../services/history/IContent.js';

describe('REAL BUG: Orphaned Tool Response', () => {
  it('🔥 MUST handle orphaned tool response when switching providers', () => {
    const historyService = new HistoryService();

    // Simulate what actually happened:
    // 1. There's a tool response with SHORT ID but NO corresponding call
    const orphanedResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'ad9c11ef9', // 9-char SHORT ID from the actual error!
      name: 'glob',
      content: JSON.stringify({
        error: "params must have required property 'pattern'",
      }),
    };

    // Add the orphaned response to history
    historyService.addMessage(orphanedResponse, 'openai');

    // Now there's some AI response
    const aiResponse: IMessage = {
      role: 'assistant',
      content:
        'Let me correct my approach and examine the codebase structure more systematically.',
    };
    historyService.addMessage(aiResponse, 'openai');

    // Now AI makes a NEW tool call
    const newCall: IMessage = {
      role: 'assistant',
      tool_calls: [
        {
          id: '3eb942023', // Different ID
          type: 'function',
          function: {
            name: 'list_directory',
            arguments: JSON.stringify({
              path: '/Users/acoliver/projects/llxprt-code/packages',
            }),
          },
        },
      ],
    };
    historyService.addMessage(newCall, 'openai');

    // Get history and convert to Anthropic
    const history = historyService.getAll();

    // Try to convert to Anthropic format
    const anthropicMessages = history.map((content) =>
      MessageConverters.toAnthropicMessage(content),
    );

    // The orphaned response should NOT have the original SHORT ID
    const orphanMsg = anthropicMessages[0];

    // Check if the orphaned response has been normalized
    if (orphanMsg.role === 'user' && orphanMsg.content) {
      const toolResult = (
        orphanMsg.content as Array<
          | { type: 'text'; text: string }
          | { type: 'tool_use'; id: string; name: string; input: unknown }
          | { type: 'tool_result'; tool_use_id: string; content: string }
        >
      ).find((c) => c.type === 'tool_result');

      console.error('🔥 Orphaned tool_result ID:', toolResult?.tool_use_id);
      console.error('🔥 Original SHORT ID was: ad9c11ef9');

      // The ID should be normalized, NOT the original SHORT ID
      expect(toolResult?.tool_use_id).not.toBe('ad9c11ef9');
      expect(toolResult?.tool_use_id).toMatch(/^toolu_/);

      // But wait - this is still wrong! There's NO corresponding tool_use!
      // Anthropic will reject this

      // Check if there's a corresponding tool_use in any previous message
      const hasMatchingToolUse = anthropicMessages.some((msg) => {
        if (msg.role === 'assistant' && msg.content) {
          return (
            msg.content as Array<
              | { type: 'text'; text: string }
              | { type: 'tool_use'; id: string; name: string; input: unknown }
              | { type: 'tool_result'; tool_use_id: string; content: string }
            >
          ).some(
            (c) => c.type === 'tool_use' && c.id === toolResult?.tool_use_id,
          );
        }
        return false;
      });

      // This should FAIL - there's no matching tool_use!
      expect(hasMatchingToolUse).toBe(false);

      console.error('⚠️ WARNING: Orphaned tool response will cause 400 error!');
    }
  });

  it('🔥 MUST filter out orphaned tool responses when no matching call exists', () => {
    // This is what we SHOULD do - filter out orphaned responses
    const historyService = new HistoryService();

    // Add orphaned response
    const orphanedResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'ad9c11ef9',
      name: 'glob',
      content: 'error response',
    };
    historyService.addMessage(orphanedResponse, 'openai');

    // Get history for Anthropic
    const history = historyService.getAll();
    const anthropicMessages = history.map((content) =>
      MessageConverters.toAnthropicMessage(content),
    );

    // We SHOULD filter out orphaned tool responses
    // or convert them to regular text messages
    // Currently this will FAIL because we don't handle this case

    // Check that we don't send orphaned tool_result to Anthropic
    const hasOrphanedToolResult = anthropicMessages.some((msg) => {
      if (msg.content && Array.isArray(msg.content)) {
        return msg.content.some((c: unknown) => {
          if (typeof c === 'object' && c !== null && 'type' in c) {
            return (c as { type: string }).type === 'tool_result';
          }
          return false;
        });
      }
      return false;
    });

    // This test will FAIL - showing we have a bug
    expect(hasOrphanedToolResult).toBe(false);
  });
});
