/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Universal content representation that is provider-agnostic.
 * All conversation content is represented as blocks within a speaker's turn.
 */
export interface IContent {
  /**
   * Who is speaking in this content
   * - 'human': The user
   * - 'ai': The AI assistant
   * - 'tool': A tool/function response
   */
  speaker: 'human' | 'ai' | 'tool';

  /**
   * Array of content blocks that make up this message.
   * A message can contain multiple blocks of different types.
   */
  blocks: ContentBlock[];

  /**
   * Optional metadata for the content
   */
  metadata?: ContentMetadata;
}

/**
 * Metadata associated with content
 */
export interface ContentMetadata {
  /** When this content was created */
  timestamp?: number;

  /** Which model generated this (for AI responses) */
  model?: string;

  /** Token usage statistics */
  usage?: UsageStats;

  /** Unique identifier for this content */
  id?: string;

  /** Provider that generated this content */
  provider?: string;

  /** Whether this is a summary of previous messages */
  isSummary?: boolean;

  /** Additional provider-specific metadata */
  providerMetadata?: Record<string, unknown>;

  /** Whether this content is synthetic (auto-generated) */
  synthetic?: boolean;

  /** Reason for synthetic content generation */
  reason?: string;

  /** Stable identifier for a conversation turn */
  turnId?: string;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;

  cachedTokens?: number;
  cacheCreationTokens?: number;
  cacheMissTokens?: number;

  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Union type of all possible content blocks
 */
export type ContentBlock =
  | TextBlock
  | ToolCallBlock
  | ToolResponseBlock
  | MediaBlock
  | ThinkingBlock
  | CodeBlock;

/**
 * Regular text content
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * AI calling a tool/function
 */
export interface ToolCallBlock {
  type: 'tool_call';

  /** Unique identifier for this tool call */
  id: string;

  /** Name of the tool being called */
  name: string;

  /** Parameters passed to the tool (must be JSON-serializable) */
  parameters: unknown;

  /** Optional description of what this tool call is intended to do */
  description?: string;
}

/**
 * Response from a tool/function call
 */
export interface ToolResponseBlock {
  type: 'tool_response';

  /** References the ToolCallBlock.id this is responding to */
  callId: string;

  /** The tool that generated this response */
  toolName: string;

  /** Result from the tool (must be JSON-serializable) */
  result: unknown;

  /** Error message if the tool call failed */
  error?: string;

  /** Whether this response completes the tool call */
  isComplete?: boolean;
}

/**
 * Media content (images, files, etc.)
 */
export interface MediaBlock {
  type: 'media';

  /** MIME type of the media */
  mimeType: string;

  /** Either a URL or base64-encoded data */
  data: string;

  /** Whether data is a URL or base64 */
  encoding: 'url' | 'base64';

  /** Optional caption or alt text */
  caption?: string;

  /** Original filename if applicable */
  filename?: string;
}

/**
 * Thinking/reasoning content (for models that support it)
 * @plan PLAN-20251202-THINKING.P03
 * @requirement REQ-THINK-001.1, REQ-THINK-001.2
 */
export interface ThinkingBlock {
  type: 'thinking';

  /** The thinking/reasoning text */
  thought: string;

  /** Whether this thinking should be hidden from the user */
  isHidden?: boolean;

  /** Source field name for round-trip serialization */
  sourceField?: 'reasoning_content' | 'thinking' | 'thought' | 'think_tags';

  /** Signature for Anthropic extended thinking */
  signature?: string;

  /** Base64-encoded reasoning content (for OpenAI Codex/Responses API) */
  encryptedContent?: string;
}

/**
 * Code content with syntax highlighting support
 */
export interface CodeBlock {
  type: 'code';

  /** The code content */
  code: string;

  /** Programming language for syntax highlighting */
  language?: string;
}

/**
 * Utility class for content validation operations
 */
export const ContentValidation = {
  /**
   * Check if IContent has valid content (non-empty blocks, at least one block with actual content)
   */
  hasContent(content: IContent): boolean {
    if (!content.blocks || content.blocks.length === 0) {
      return false;
    }

    // Check if any block has actual content
    return content.blocks.some((block) => {
      if (block.type === 'text') {
        return !!block.text && block.text.trim().length > 0;
      }
      if (block.type === 'tool_call') {
        return !!block.name && !!block.parameters;
      }
      if (block.type === 'tool_response') {
        return !!block.callId && block.result !== undefined;
      }
      if (block.type === 'media') {
        return !!block.data && !!block.mimeType;
      }
      if (block.type === 'thinking') {
        // A thinking block is valid if it has:
        // 1. Thought content (text), OR
        // 2. Encrypted content (for OpenAI Codex round-trip reasoning)
        const hasThought = !!block.thought && block.thought.trim().length > 0;
        const hasEncrypted =
          !!block.encryptedContent && block.encryptedContent.trim().length > 0;

        // For Anthropic extended thinking, require signature
        if (block.sourceField === 'thinking') {
          return hasThought && Boolean(block.signature);
        }

        // For OpenAI/Codex, either thought OR encrypted content is valid
        return hasThought || hasEncrypted;
      }
      if (block.type === 'code') {
        return !!block.code && block.code.trim().length > 0;
      }
      return false;
    });
  },
};

export function createUserMessage(
  text: string,
  metadata?: { timestamp?: number; provider?: string },
): IContent {
  const content: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
  if (metadata) {
    content.metadata = metadata;
  }
  return content;
}

export function createToolResponse(
  callId: string,
  toolName: string,
  result: unknown,
  error?: string,
): IContent {
  const block: ToolResponseBlock = {
    type: 'tool_response',
    callId,
    toolName,
    result,
  };
  if (error) {
    block.error = error;
  }
  return {
    speaker: 'tool',
    blocks: [block],
  };
}
