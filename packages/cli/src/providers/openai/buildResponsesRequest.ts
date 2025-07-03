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

// Responses API message format (without tool_calls)
interface ResponsesMessage {
  role: 'assistant' | 'system' | 'developer' | 'user';
  content: string;
  // tool_call_id is not supported, tool responses are transformed to user messages
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ResponsesRequest {
  model: string;
  input?: ResponsesMessage[]; // Changed from messages to input, uses cleaned format
  prompt?: string;
  tools?: ResponsesTool[];
  stream?: boolean;
  conversation_id?: string;
  parent_id?: string;
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
    console.warn(
      '[buildResponsesRequest] conversationId provided in stateful mode. Only the most recent messages will be sent to maintain context window.',
    );
    // For stateful mode, include only the last 2 messages (assistant+user pair)
    if (messages.length > 2) {
      processedMessages = messages.slice(-2);
      console.warn(
        `[buildResponsesRequest] Trimmed messages from ${messages.length} to ${processedMessages.length} for stateful mode.`,
      );
    }
  }
  
  // Transform messages for Responses API format
  let transformedMessages: ResponsesMessage[] | undefined;
  if (processedMessages) {
    transformedMessages = processedMessages
      .filter((msg): msg is IMessage => msg !== undefined && msg !== null)
      .map(msg => {
        // Remove tool_calls field as it's not accepted by Responses API
        const { tool_calls: _tool_calls, tool_call_id, usage, ...cleanMsg } = msg;
        
        // Transform tool messages to user messages with special formatting
        if (msg.role === 'tool') {
          return {
            role: 'user' as const,
            content: `[Tool Response - ${tool_call_id}]\n${msg.content}`,
          };
        }
        
        // Ensure role is valid for Responses API
        const validRole = cleanMsg.role as 'user' | 'assistant' | 'system' | 'developer';
        return {
          role: validRole,
          content: cleanMsg.content,
          ...(usage ? { usage } : {}), // Preserve usage data if present
        };
      });
  }

  // Build the request object with conditional fields
  const request: ResponsesRequest = {
    model,
    ...otherParams,
    ...(prompt ? { prompt } : {}),
    ...(transformedMessages ? { input: transformedMessages } : {}), // Changed from messages to input
  };

  // Map conversation fields
  if (conversationId) {
    request.conversation_id = conversationId;
  }
  if (parentId) {
    request.parent_id = parentId;
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
