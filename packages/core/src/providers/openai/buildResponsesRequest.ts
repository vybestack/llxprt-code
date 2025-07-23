import { IMessage } from '../IMessage.js';
import { ITool } from '../ITool.js';
import { ResponsesTool } from '../../tools/IToolFormatter.js';

export interface ResponsesRequestParams {
  messages?: IMessage[];
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
      content: string;
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

        // If we find a tool message, we need to include the assistant message with the tool call
        if (msg.role === 'tool') {
          // Find the assistant message that contains this tool call
          for (let i = startIndex - 1; i >= 0; i--) {
            const prevMsg = messages[i];
            if (prevMsg.role === 'assistant' && prevMsg.tool_calls) {
              // Check if this assistant message contains the tool call for our tool response
              const hasMatchingCall = prevMsg.tool_calls.some(
                (call) => call.id === msg.tool_call_id,
              );
              if (hasMatchingCall) {
                startIndex = i;
                break;
              }
            }
          }
        }

        // If we find a user message after going through tool responses, this is a good starting point
        if (msg.role === 'user' && startIndex < messages.length - 1) {
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
      .filter((msg): msg is IMessage => msg !== undefined && msg !== null)
      .forEach((msg) => {
        // Extract function calls from assistant messages
        if (msg.role === 'assistant' && msg.tool_calls) {
          msg.tool_calls.forEach((toolCall) => {
            if (toolCall.type === 'function') {
              functionCalls.push({
                type: 'function_call' as const,
                call_id: toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              });
            }
          });
        }

        // Extract function call outputs from tool messages
        if (msg.role === 'tool' && msg.tool_call_id && msg.content) {
          functionCallOutputs.push({
            type: 'function_call_output' as const,
            call_id: msg.tool_call_id,
            output: msg.content,
          });
        }
      });

    // Then, create the regular messages array (excluding tool messages)
    transformedMessages = processedMessages
      .filter((msg): msg is IMessage => msg !== undefined && msg !== null)
      .filter((msg) => msg.role !== 'tool') // Exclude tool messages
      .map((msg) => {
        // Remove tool_calls field as it's not accepted by Responses API
        const {
          tool_calls: _tool_calls,
          tool_call_id: _tool_call_id,
          usage,
          ...cleanMsg
        } = msg;

        // Ensure role is valid for Responses API
        const validRole = cleanMsg.role as
          | 'user'
          | 'assistant'
          | 'system'
          | 'developer';

        return {
          role: validRole,
          content: cleanMsg.content,
          ...(usage ? { usage } : {}), // Preserve usage data if present
        };
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
