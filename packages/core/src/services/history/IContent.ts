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

  /** Optional filename this code is from/for */
  filename?: string;

  /** Whether this code was executed */
  executed?: boolean;

  /** Execution result if executed */
  executionResult?: unknown;
}

/**
 * Helper type guards for content blocks
 */
export const ContentBlockGuards = {
  isTextBlock: (block: ContentBlock): block is TextBlock =>
    block.type === 'text',

  isToolCallBlock: (block: ContentBlock): block is ToolCallBlock =>
    block.type === 'tool_call',

  isToolResponseBlock: (block: ContentBlock): block is ToolResponseBlock =>
    block.type === 'tool_response',

  isMediaBlock: (block: ContentBlock): block is MediaBlock =>
    block.type === 'media',

  isThinkingBlock: (block: ContentBlock): block is ThinkingBlock =>
    block.type === 'thinking',

  isCodeBlock: (block: ContentBlock): block is CodeBlock =>
    block.type === 'code',
};

/**
 * Helper to create IContent instances
 */
export const ContentFactory = {
  createUserMessage: (text: string, metadata?: ContentMetadata): IContent => ({
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata,
  }),

  createAIMessage: (
    blocks: ContentBlock[],
    metadata?: ContentMetadata,
  ): IContent => ({
    speaker: 'ai',
    blocks,
    metadata,
  }),

  createToolResponse: (
    callId: string,
    toolName: string,
    result: unknown,
    error?: string,
    metadata?: ContentMetadata,
  ): IContent => ({
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
        error,
      },
    ],
    metadata,
  }),
};

/**
 * Validation helpers
 */
export const ContentValidation = {
  /**
   * Check if content has meaningful content (not empty)
   */
  hasContent: (content: IContent): boolean => {
    if (!content.blocks || content.blocks.length === 0) {
      return false;
    }

    return content.blocks.some((block) => {
      switch (block.type) {
        case 'text':
          return block.text.trim().length > 0;
        case 'tool_call':
        case 'tool_response':
        case 'media':
        case 'code':
          return true;
        case 'thinking':
          return block.thought.trim().length > 0;
        default:
          return false;
      }
    });
  },

  /**
   * Check if content is valid for inclusion in history
   */
  isValid: (content: IContent): boolean => {
    // Must have a valid speaker
    if (!['human', 'ai', 'tool'].includes(content.speaker)) {
      return false;
    }

    // Must have at least one block
    if (!content.blocks || content.blocks.length === 0) {
      return false;
    }

    // Tool responses must have tool_response blocks
    if (content.speaker === 'tool') {
      const hasToolResponse = content.blocks.some(
        (b) => b.type === 'tool_response',
      );
      if (!hasToolResponse) {
        return false;
      }
    }

    return true;
  },
};
