/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import {
  buildToolResponsePayload,
  formatToolResponseText,
} from '../utils/toolResponsePayload.js';

import { DebugLogger } from '../../debug/index.js';
import {
  type IContent,
  type ToolCallBlock,
  type ToolResponseBlock,
  type TextBlock,
} from '../../services/history/IContent.js';
import { type ITool } from '../ITool.js';
import { type ResponsesTool } from '../../tools/IToolFormatter.js';
import {
  ensureJsonSafe,
  hasUnicodeReplacements,
} from '../../utils/unicodeUtils.js';
import { normalizeToOpenAIToolId } from '../utils/toolIdNormalization.js';

export interface ResponsesRequestParams {
  messages?: IContent[];
  prompt?: string;
  tools?: ITool[] | ResponsesTool[];
  stream?: boolean;
  conversationId?: string;
  parentId?: string;
  tool_choice?: string | object;
  stateful?: boolean;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  n?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  response_format?: object;
  seed?: number;
  logit_bias?: Record<string, number>;
  user?: string;
}

// Responses API message format
type ResponsesMessage =
  | {
      role: 'assistant' | 'system' | 'developer' | 'user';
      content?: string; // Content is optional for assistant messages with tool calls
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    }
  | FunctionCallOutput
  | FunctionCall;

type FunctionCallOutput = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

type FunctionCall = {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
};

export interface ResponsesRequest {
  model: string;
  input?: ResponsesMessage[]; // Changed from messages to input, uses cleaned format
  prompt?: string;
  tools?: ResponsesTool[];
  stream?: boolean;
  previous_response_id?: string;
  store?: boolean;
  tool_choice?: string | object;
  stateful?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  n?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  response_format?: object;
  seed?: number;
  logit_bias?: Record<string, number>;
  user?: string;
}

const MAX_TOOLS = 16;
const MAX_JSON_SIZE_KB = 32;

// Create a single logger instance for the module (following singleton pattern)
const logger = new DebugLogger('llxprt:openai:provider');

export function buildResponsesRequest(
  params: ResponsesRequestParams,
): ResponsesRequest {
  const {
    messages,
    prompt,
    tools,
    conversationId,
    parentId,
    tool_choice,
    stateful,
    model,
    ...otherParams
  } = params;

  // Validate prompt/messages ambiguity
  if (prompt && messages && messages.length > 0) {
    throw new Error(
      'Cannot specify both "prompt" and "messages". Use either prompt (for simple queries) or messages (for conversation history).',
    );
  }

  // Validate required fields
  if (!prompt && (!messages || messages.length === 0)) {
    throw new Error('Either "prompt" or "messages" must be provided.');
  }

  if (!model) {
    throw new Error('Model is required for Responses API.');
  }

  // Validate tools limit
  if (tools && tools.length > MAX_TOOLS) {
    throw new Error(
      `Too many tools provided. Maximum allowed is ${MAX_TOOLS}, but ${tools.length} were provided.`,
    );
  }

  // Validate JSON size for tools
  if (tools) {
    const toolsJson = JSON.stringify(tools);
    const sizeKb = new TextEncoder().encode(toolsJson).length / 1024;
    if (sizeKb > MAX_JSON_SIZE_KB) {
      throw new Error(
        `Tools JSON size exceeds ${MAX_JSON_SIZE_KB}KB limit. Current size: ${sizeKb.toFixed(2)}KB`,
      );
    }
  }

  // Handle message trimming for stateful mode
  let processedMessages = messages;
  if (messages && conversationId) {
    // For stateful mode, we need to be smarter about trimming to preserve tool call/response pairs
    if (messages.length > 2) {
      // Find the last complete interaction (user message -> assistant response/tool calls -> tool responses -> user message)
      let startIndex = messages.length - 1;

      // Work backwards to find a complete interaction
      while (startIndex > 0) {
        const msg = messages[startIndex];

        // If we find a tool message, we need to include the AI message with the tool call
        if (msg.speaker === 'tool') {
          // Find the AI message that contains this tool call
          for (let i = startIndex - 1; i >= 0; i--) {
            const prevMsg = messages[i];
            if (prevMsg.speaker === 'ai') {
              // Check if this AI message contains the tool call for our tool response
              const toolResponseBlocks = msg.blocks.filter(
                (block) => block.type === 'tool_response',
              ) as ToolResponseBlock[];
              const hasMatchingCall = prevMsg.blocks.some((block) => {
                if (block.type === 'tool_call') {
                  const toolCallBlock = block as ToolCallBlock;
                  return toolResponseBlocks.some(
                    (respBlock) => respBlock.callId === toolCallBlock.id,
                  );
                }
                return false;
              });
              if (hasMatchingCall) {
                startIndex = i;
                break;
              }
            }
          }
        }

        // If we find a user message after going through tool responses, this is a good starting point
        if (msg.speaker === 'human' && startIndex < messages.length - 1) {
          break;
        }

        startIndex--;
      }

      // Ensure we don't trim too aggressively
      startIndex = Math.max(0, Math.min(startIndex, messages.length - 2));

      processedMessages = messages.slice(startIndex);
    }
  }

  // Transform messages for Responses API format
  let transformedMessages: ResponsesMessage[] | undefined;
  const functionCallOutputs: FunctionCallOutput[] = [];
  const functionCalls: FunctionCall[] = [];

  if (processedMessages) {
    // First, extract function calls from assistant messages and function call outputs from tool messages
    processedMessages
      .filter((msg): msg is IContent => msg !== undefined && msg !== null)
      .forEach((msg) => {
        // Extract function calls from AI messages
        // Normalize tool IDs to OpenAI format (call_XXX) - fixes issue #825
        if (msg.speaker === 'ai') {
          msg.blocks.forEach((block) => {
            if (block.type === 'tool_call') {
              const toolCallBlock = block as ToolCallBlock;
              functionCalls.push({
                type: 'function_call' as const,
                call_id: normalizeToOpenAIToolId(toolCallBlock.id),
                name: toolCallBlock.name,
                arguments:
                  typeof toolCallBlock.parameters === 'string'
                    ? toolCallBlock.parameters
                    : JSON.stringify(toolCallBlock.parameters),
              });
            }
          });
        }

        // Extract function call outputs from tool messages
        if (msg.speaker === 'tool') {
          msg.blocks.forEach((block) => {
            if (block.type === 'tool_response') {
              const toolResponseBlock = block as ToolResponseBlock;

              const payload = buildToolResponsePayload(
                toolResponseBlock,
                undefined,
                true,
              );
              let sanitizedContent = formatToolResponseText({
                status: payload.status,
                toolName: payload.toolName ?? toolResponseBlock.toolName,
                error: payload.error,
                output: payload.result,
              });

              if (hasUnicodeReplacements(sanitizedContent)) {
                logger.debug(
                  () =>
                    'Tool output contains Unicode replacement characters (U+FFFD), sanitizing...',
                );
                sanitizedContent = ensureJsonSafe(sanitizedContent);
              }

              // Normalize tool IDs to OpenAI format (call_XXX) - fixes issue #825
              functionCallOutputs.push({
                type: 'function_call_output' as const,
                call_id: normalizeToOpenAIToolId(toolResponseBlock.callId),
                output: sanitizedContent,
              });
            }
          });
        }
      });

    // Then, create the regular messages array (excluding tool messages)
    transformedMessages = processedMessages
      .filter((msg): msg is IContent => msg !== undefined && msg !== null)
      .filter((msg) => msg.speaker !== 'tool') // Exclude tool messages
      .map((msg) => {
        // Extract text content from blocks
        const textBlocks = msg.blocks.filter(
          (block) => block.type === 'text',
        ) as TextBlock[];
        const content =
          textBlocks.length > 0
            ? textBlocks.map((block) => block.text).join('\n')
            : '';

        // Convert speaker to role for Responses API
        const role =
          msg.speaker === 'human'
            ? 'user'
            : msg.speaker === 'ai'
              ? 'assistant'
              : 'system';

        // Sanitize content for safe API transmission
        let sanitizedContent = content;
        if (hasUnicodeReplacements(content)) {
          logger.debug(
            () =>
              'Message content contains Unicode replacement characters (U+FFFD), sanitizing...',
          );
          sanitizedContent = ensureJsonSafe(content);
        }

        const result: {
          role: 'user' | 'assistant' | 'system' | 'developer';
          content?: string;
          usage?: unknown;
        } = {
          role: role as 'user' | 'assistant' | 'system' | 'developer',
        };

        // Only add content if it exists
        if (sanitizedContent) {
          result.content = sanitizedContent;
        }

        // Preserve usage data if present in metadata
        if (msg.metadata?.usage) {
          result.usage = msg.metadata.usage;
        }

        return result as ResponsesMessage;
      })
      .filter(
        (msg): msg is NonNullable<typeof msg> => msg !== null,
      ) as ResponsesMessage[];
  }

  // Build the request object with conditional fields
  const request: ResponsesRequest = {
    model,
    ...otherParams,
    ...(prompt ? { prompt } : {}),
  };

  // Add input array if we have messages, function calls, or function call outputs
  if (
    transformedMessages ||
    functionCalls.length > 0 ||
    functionCallOutputs.length > 0
  ) {
    const inputItems: ResponsesMessage[] = [];

    // Add regular messages
    if (transformedMessages) {
      inputItems.push(...transformedMessages);
    }

    // Add function calls
    if (functionCalls.length > 0) {
      inputItems.push(...functionCalls);
    }

    // Add function call outputs
    if (functionCallOutputs.length > 0) {
      inputItems.push(...functionCallOutputs);
    }
    request.input = inputItems;
  }

  // Map conversation fields
  if (model) {
    if (conversationId) {
      // Note: The API uses previous_response_id, not a conversation_id.
      // We are mapping our internal parentId to this field.
      if (parentId) {
        request.previous_response_id = parentId;
        request.store = true;
      }
    }
  }

  // Add tools if provided
  if (tools && tools.length > 0) {
    request.tools = tools as ResponsesTool[];
    if (tool_choice) {
      request.tool_choice = tool_choice;
    }
  }

  // Add stateful flag if provided
  if (stateful !== undefined) {
    request.stateful = stateful;
  }

  // Add stream flag if provided
  if (params.stream !== undefined) {
    request.stream = params.stream;
  }

  return request;
}
