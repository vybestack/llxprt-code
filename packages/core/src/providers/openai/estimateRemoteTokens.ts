import { IMessage } from '../IMessage.js';
import { ConversationCache } from './ConversationCache.js';

// Model context size configuration
export const MODEL_CONTEXT_SIZE: Record<string, number> = {
  'gpt-4.1': 1_000_000,
  o3: 200_000,
  'o3-pro': 200_000,
  'o3-mini': 200_000,
  o1: 200_000,
  'o1-mini': 200_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4o-realtime': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4-turbo-preview': 128_000,
  'gpt-3.5-turbo': 16_385,
  // Default fallback
  default: 128_000,
};

/**
 * Estimates the total tokens used including remote stored context
 * @param model The model being used
 * @param cache The conversation cache instance
 * @param conversationId The conversation ID
 * @param parentId The parent message ID
 * @param promptTokens The tokens in the current prompt
 * @returns Object with token usage information
 */
export function estimateRemoteTokens(
  model: string,
  cache: ConversationCache,
  conversationId: string | undefined,
  parentId: string | undefined,
  promptTokens: number,
): {
  totalTokens: number;
  remoteTokens: number;
  promptTokens: number;
  maxTokens: number;
  contextUsedPercent: number;
  tokensRemaining: number;
} {
  // Find the context size by checking if model starts with known prefixes
  let maxTokens = MODEL_CONTEXT_SIZE.default;
  for (const [knownModel, contextSize] of Object.entries(MODEL_CONTEXT_SIZE)) {
    if (knownModel !== 'default' && model.startsWith(knownModel)) {
      maxTokens = contextSize;
      break;
    }
  }

  // Get accumulated tokens from cache
  const remoteTokens =
    conversationId && parentId
      ? cache.getAccumulatedTokens(conversationId, parentId)
      : 0;

  const totalTokens = remoteTokens + promptTokens;
  const tokensRemaining = Math.max(0, maxTokens - totalTokens);
  const contextUsedPercent = Math.min(100, (totalTokens / maxTokens) * 100);

  return {
    totalTokens,
    remoteTokens,
    promptTokens,
    maxTokens,
    contextUsedPercent,
    tokensRemaining,
  };
}

/**
 * Estimates tokens for a message array (rough approximation)
 * @param messages Array of messages
 * @returns Estimated token count
 */
export function estimateMessagesTokens(messages: IMessage[]): number {
  // Rough estimation: ~4 characters per token
  let totalChars = 0;

  for (const message of messages) {
    // Add role tokens (usually 1-2 tokens)
    totalChars += 8;

    // Add content
    if (message.content) {
      totalChars += message.content.length;
    }

    // Add tool calls overhead
    if (message.tool_calls) {
      totalChars += JSON.stringify(message.tool_calls).length;
    }
  }

  // Rough approximation: 4 characters per token
  return Math.ceil(totalChars / 4);
}
