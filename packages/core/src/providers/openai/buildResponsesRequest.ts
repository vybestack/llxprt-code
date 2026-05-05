/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy provider boundary retained while larger decomposition continues. */

import {
  buildToolResponsePayload,
  formatToolResponseText,
} from '../utils/toolResponsePayload.js';

import { DebugLogger } from '../../debug/index.js';
import { type IContent } from '../../services/history/IContent.js';
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

function validateParams(params: ResponsesRequestParams): void {
  const { messages, prompt, tools, model } = params;

  if (prompt && messages && messages.length > 0) {
    throw new Error(
      'Cannot specify both "prompt" and "messages". Use either prompt (for simple queries) or messages (for conversation history).',
    );
  }

  if (!prompt && (!messages || messages.length === 0)) {
    throw new Error('Either "prompt" or "messages" must be provided.');
  }

  if (!model) {
    throw new Error('Model is required for Responses API.');
  }

  if (tools && tools.length > MAX_TOOLS) {
    throw new Error(
      `Too many tools provided. Maximum allowed is ${MAX_TOOLS}, but ${tools.length} were provided.`,
    );
  }

  if (tools) {
    const toolsJson = JSON.stringify(tools);
    const sizeKb = new TextEncoder().encode(toolsJson).length / 1024;
    if (sizeKb > MAX_JSON_SIZE_KB) {
      throw new Error(
        `Tools JSON size exceeds ${MAX_JSON_SIZE_KB}KB limit. Current size: ${sizeKb.toFixed(2)}KB`,
      );
    }
  }
}

function findMatchingAiMessageIndex(
  messages: IContent[],
  toolMsg: IContent,
  currentStart: number,
): number {
  const toolResponseBlocks = toolMsg.blocks.filter(
    (block) => block.type === 'tool_response',
  );

  for (let i = currentStart - 1; i >= 0; i--) {
    const prevMsg = messages[i];
    if (prevMsg.speaker === 'ai') {
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      const hasMatchingCall = prevMsg.blocks.some((block) => {
        if (block.type === 'tool_call') {
          const toolCallBlock = block;
          return toolResponseBlocks.some(
            (respBlock) => respBlock.callId === toolCallBlock.id,
          );
        }
        return false;
      });
      if (hasMatchingCall) {
        return i;
      }
    }
  }
  return currentStart;
}

function trimMessagesForStatefulMode(
  messages: IContent[],
  conversationId: string | undefined,
): IContent[] {
  if (!conversationId || messages.length <= 2) {
    return messages;
  }

  let startIndex = messages.length - 1;

  while (startIndex > 0) {
    const msg = messages[startIndex];

    if (msg.speaker === 'tool') {
      startIndex = findMatchingAiMessageIndex(messages, msg, startIndex);
    }

    if (msg.speaker === 'human' && startIndex < messages.length - 1) {
      break;
    }

    startIndex--;
  }

  startIndex = Math.max(0, Math.min(startIndex, messages.length - 2));
  return messages.slice(startIndex);
}

function extractFunctionCalls(messages: IContent[]): {
  functionCalls: FunctionCall[];
  functionCallOutputs: FunctionCallOutput[];
} {
  const functionCalls: FunctionCall[] = [];
  const functionCallOutputs: FunctionCallOutput[] = [];

  messages
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI response input parts cross provider/runtime boundaries despite declared types.
    .filter((msg): msg is IContent => msg !== undefined && msg !== null)
    .forEach((msg) => {
      if (msg.speaker === 'ai') {
        msg.blocks.forEach((block) => {
          if (block.type === 'tool_call') {
            const toolCallBlock = block;
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

      if (msg.speaker === 'tool') {
        msg.blocks.forEach((block) => {
          if (block.type === 'tool_response') {
            const toolResponseBlock = block;

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

            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            if (hasUnicodeReplacements(sanitizedContent)) {
              logger.debug(
                () =>
                  'Tool output contains Unicode replacement characters (U+FFFD), sanitizing...',
              );
              sanitizedContent = ensureJsonSafe(sanitizedContent);
            }

            functionCallOutputs.push({
              type: 'function_call_output' as const,
              call_id: normalizeToOpenAIToolId(toolResponseBlock.callId),
              output: sanitizedContent,
            });
          }
        });
      }
    });

  return { functionCalls, functionCallOutputs };
}

function transformMessages(
  messages: IContent[],
): ResponsesMessage[] | undefined {
  return (
    messages
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI response input parts cross provider/runtime boundaries despite declared types.
      .filter((msg): msg is IContent => msg !== undefined && msg !== null)
      .filter((msg) => msg.speaker !== 'tool')
      .map((msg) => {
        const textBlocks = msg.blocks.filter(
          (block): block is Extract<typeof block, { type: 'text' }> =>
            block.type === 'text',
        );
        const content =
          textBlocks.length > 0
            ? textBlocks.map((block) => block.text).join('\n')
            : '';

        const role =
          msg.speaker === 'human'
            ? 'user'
            : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
              msg.speaker === 'ai'
              ? 'assistant'
              : 'system';

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

        if (sanitizedContent) {
          result.content = sanitizedContent;
        }

        if (msg.metadata?.usage) {
          result.usage = msg.metadata.usage;
        }

        return result as ResponsesMessage;
      })
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI response input parts cross provider/runtime boundaries despite declared types.
        (msg): msg is NonNullable<typeof msg> => msg !== null,
      ) as ResponsesMessage[]
  );
}

function buildInputArray(
  transformedMessages: ResponsesMessage[] | undefined,
  functionCalls: FunctionCall[],
  functionCallOutputs: FunctionCallOutput[],
): ResponsesMessage[] | undefined {
  if (
    !transformedMessages &&
    functionCalls.length === 0 &&
    functionCallOutputs.length === 0
  ) {
    return undefined;
  }

  const inputItems: ResponsesMessage[] = [];
  if (transformedMessages) {
    inputItems.push(...transformedMessages);
  }
  if (functionCalls.length > 0) {
    inputItems.push(...functionCalls);
  }
  if (functionCallOutputs.length > 0) {
    inputItems.push(...functionCallOutputs);
  }
  return inputItems;
}

function applyConversationFields(
  request: ResponsesRequest,
  model: string,
  conversationId: string | undefined,
  parentId: string | undefined,
): void {
  if (model && conversationId && parentId) {
    request.previous_response_id = parentId;
    request.store = true;
  }
}

function applyToolFields(
  request: ResponsesRequest,
  tools: ITool[] | ResponsesTool[] | undefined,
  toolChoice: string | object | undefined,
): void {
  if (tools && tools.length > 0) {
    request.tools = tools as ResponsesTool[];
    if (
      (typeof toolChoice === 'string' && toolChoice !== '') ||
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve old runtime-boundary falsy handling for malformed null tool choices.
      (typeof toolChoice === 'object' && toolChoice !== null)
    ) {
      request.tool_choice = toolChoice;
    }
  }
}

export function buildResponsesRequest(
  params: ResponsesRequestParams,
): ResponsesRequest {
  validateParams(params);

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

  const processedMessages = trimMessagesForStatefulMode(
    messages ?? [],
    conversationId,
  );

  const { functionCalls, functionCallOutputs } =
    extractFunctionCalls(processedMessages);

  const transformedMessages =
    processedMessages.length > 0
      ? transformMessages(processedMessages)
      : undefined;

  const request: ResponsesRequest = {
    model: model ?? '',
    ...otherParams,
    ...(prompt ? { prompt } : {}),
  };

  const input = buildInputArray(
    transformedMessages,
    functionCalls,
    functionCallOutputs,
  );

  if (input) {
    request.input = input;
  }

  applyConversationFields(request, model ?? '', conversationId, parentId);
  applyToolFields(request, tools, tool_choice);

  if (stateful !== undefined) {
    request.stateful = stateful;
  }

  if (params.stream !== undefined) {
    request.stream = params.stream;
  }

  return request;
}
