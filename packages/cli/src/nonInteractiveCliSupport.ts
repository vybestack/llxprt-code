import {
  type Config,
  type ToolCallRequestInfo,
  executeToolCall,
  GeminiEventType,
  JsonStreamEventType,
  type MessageBus,
  type ServerGeminiStreamEvent,
  StreamIdleTimeoutError,
  FatalTurnLimitedError,
  debugLogger,
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
  type StreamJsonFormatter,
  type EmojiFilter,
  type SessionMetrics,
} from '@vybestack/llxprt-code-core';
import type { Part } from '@google/genai';

type RuntimeToolCallRequest = Omit<ToolCallRequestInfo, 'args' | 'callId'> & {
  args: unknown;
  callId?: string;
};

type ResponseProcessingContext = {
  config: Config;
  abortController: AbortController;
  prompt_id: string;
  jsonOutput: boolean;
  streamJsonOutput: boolean;
  streamFormatter: StreamJsonFormatter | null;
  emojiFilter: EmojiFilter | undefined;
  runtimeMessageBus?: MessageBus;
  createProfileNameWriter: () => () => void;
  maxSessionTurns: number;
};

type TurnResult =
  | { kind: 'continue'; messages: Part[]; jsonResponseText: string }
  | { kind: 'complete'; jsonResponseText: string; emitFinal: boolean };

function normalizeToolCallArgs(args: unknown): Record<string, unknown> {
  if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

function normalizeRequestArgs(
  rawArgs: unknown,
  toolName: string,
): Record<string, unknown> {
  if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch (error) {
      debugLogger.error(
        `Failed to parse tool arguments for ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }
  if (Array.isArray(rawArgs)) {
    debugLogger.error(
      `Unexpected array arguments for tool ${toolName}; coercing to empty object.`,
    );
    return {};
  }
  return typeof rawArgs === 'object' && rawArgs !== null
    ? (rawArgs as Record<string, unknown>)
    : {};
}

function formatThoughtText(thought: {
  subject?: string;
  description?: string;
}): string {
  if (thought.subject && thought.description) {
    return `${thought.subject}: ${thought.description}`;
  }
  return thought.subject ?? thought.description ?? '';
}

function emitStreamError(
  formatter: StreamJsonFormatter | null,
  severity: 'warning' | 'error',
  message: string,
): void {
  formatter?.emitEvent({
    type: JsonStreamEventType.ERROR,
    timestamp: new Date().toISOString(),
    severity,
    message,
  });
}

function handleThoughtEvent(
  event: ServerGeminiStreamEvent,
  context: ResponseProcessingContext,
  writeProfileName: () => void,
  thoughtBuffer: string,
  includeThinking: boolean,
): string {
  if (event.type !== GeminiEventType.Thought || !includeThinking) {
    return thoughtBuffer;
  }
  writeProfileName();
  let thoughtText = formatThoughtText(event.value);
  if (!thoughtText.trim()) {
    return thoughtBuffer;
  }
  if (context.emojiFilter) {
    const filterResult = context.emojiFilter.filterText(thoughtText);
    if (filterResult.blocked) {
      return thoughtBuffer;
    }
    if (typeof filterResult.filtered === 'string') {
      thoughtText = filterResult.filtered;
    }
  }
  return thoughtBuffer ? `${thoughtBuffer} ${thoughtText}` : thoughtText;
}

function handleContentEvent(
  event: ServerGeminiStreamEvent,
  context: ResponseProcessingContext,
  writeProfileName: () => void,
  jsonResponseText: string,
): string {
  if (event.type !== GeminiEventType.Content) {
    return jsonResponseText;
  }
  writeProfileName();
  let outputValue = event.value;
  if (context.emojiFilter) {
    const filterResult = context.emojiFilter.filterStreamChunk(outputValue);
    if (filterResult.blocked) {
      if (!context.jsonOutput) {
        process.stderr.write(
          '[Error: Response blocked due to emoji detection]\n',
        );
      }
      return jsonResponseText;
    }
    outputValue =
      typeof filterResult.filtered === 'string' ? filterResult.filtered : '';
    if (filterResult.systemFeedback && !context.jsonOutput) {
      process.stderr.write(`Warning: ${filterResult.systemFeedback}\n`);
    }
  }
  if (context.streamFormatter) {
    context.streamFormatter.emitEvent({
      type: JsonStreamEventType.MESSAGE,
      timestamp: new Date().toISOString(),
      role: 'assistant',
      content: outputValue,
      delta: true,
    });
    return jsonResponseText;
  }
  if (context.jsonOutput) {
    return jsonResponseText + outputValue;
  }
  process.stdout.write(outputValue);
  return jsonResponseText;
}

function collectToolCall(
  event: ServerGeminiStreamEvent,
  functionCalls: RuntimeToolCallRequest[],
  formatter: StreamJsonFormatter | null,
): void {
  if (event.type !== GeminiEventType.ToolCallRequest) {
    return;
  }
  const toolCallRequest = event.value as RuntimeToolCallRequest;
  const callId =
    toolCallRequest.callId ?? `${toolCallRequest.name}-${Date.now()}`;
  formatter?.emitEvent({
    type: JsonStreamEventType.TOOL_USE,
    timestamp: new Date().toISOString(),
    tool_name: toolCallRequest.name,
    tool_id: callId,
    parameters: normalizeToolCallArgs(toolCallRequest.args),
  });
  functionCalls.push({
    ...toolCallRequest,
    callId,
    args: toolCallRequest.args,
    agentId: toolCallRequest.agentId ?? 'primary',
  });
}

function handleControlEvent(
  event: ServerGeminiStreamEvent,
  formatter: StreamJsonFormatter | null,
): void {
  if (event.type === GeminiEventType.LoopDetected) {
    emitStreamError(formatter, 'warning', 'Loop detected, stopping execution');
  } else if (event.type === GeminiEventType.MaxSessionTurns) {
    emitStreamError(formatter, 'error', 'Maximum session turns exceeded');
  } else if (event.type === GeminiEventType.Error) {
    throw event.value.error;
  } else if (event.type === GeminiEventType.AgentExecutionStopped) {
    const stopMessage = `Agent execution stopped: ${event.systemMessage?.trim() ?? event.reason}`;
    process.stderr.write(`${stopMessage}\n`);
  } else if (event.type === GeminiEventType.AgentExecutionBlocked) {
    const blockMessage = `Agent execution blocked: ${event.systemMessage?.trim() ?? event.reason}`;
    process.stderr.write(`[WARNING] ${blockMessage}\n`);
  }
}

async function nextStreamEvent(
  iterator: AsyncIterator<ServerGeminiStreamEvent>,
  context: ResponseProcessingContext,
): Promise<IteratorResult<ServerGeminiStreamEvent>> {
  const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(context.config);
  if (effectiveTimeoutMs <= 0) {
    return iterator.next();
  }
  return nextStreamEventWithIdleTimeout({
    iterator,
    timeoutMs: effectiveTimeoutMs,
    signal: context.abortController.signal,
  });
}

function handleStreamReadError(
  error: unknown,
  context: ResponseProcessingContext,
): void {
  if (error instanceof StreamIdleTimeoutError) {
    context.abortController.abort();
    debugLogger.error('Operation cancelled.');
    emitStreamError(
      context.streamFormatter,
      'error',
      'Stream idle timeout: no response received within the allowed time.',
    );
  }
}

function flushThoughtBuffer(
  thoughtBuffer: string,
  includeThinking: boolean,
): string {
  if (!includeThinking || !thoughtBuffer.trim()) {
    return '';
  }
  process.stdout.write(`<think>${thoughtBuffer.trim()}</think>\n`);
  return '';
}

function flushEmojiBuffer(
  context: ResponseProcessingContext,
  jsonResponseText: string,
): string {
  const remainingBuffered = context.emojiFilter?.flushBuffer();
  if (!remainingBuffered) {
    return jsonResponseText;
  }
  if (context.jsonOutput) {
    return jsonResponseText + remainingBuffered;
  }
  process.stdout.write(remainingBuffered);
  return jsonResponseText;
}

async function handleToolCalls(
  requests: RuntimeToolCallRequest[],
  context: ResponseProcessingContext,
): Promise<Part[]> {
  const toolResponseParts: Part[] = [];
  for (const requestFromModel of requests) {
    const requestInfo: ToolCallRequestInfo = {
      callId:
        requestFromModel.callId ?? `${requestFromModel.name}-${Date.now()}`,
      name: requestFromModel.name,
      args: normalizeRequestArgs(requestFromModel.args, requestFromModel.name),
      isClientInitiated: false,
      prompt_id: requestFromModel.prompt_id,
      agentId: requestFromModel.agentId ?? 'primary',
    };
    const completed = await executeToolCall(
      context.config,
      requestInfo,
      context.abortController.signal,
      { messageBus: context.runtimeMessageBus },
    );
    emitToolResult(
      requestInfo.callId,
      completed.response,
      context.streamFormatter,
    );
    displayToolResult(requestFromModel.name, completed.response, context);
    toolResponseParts.push(...completed.response.responseParts);
  }
  return toolResponseParts;
}

function emitToolResult(
  toolId: string,
  toolResponse: Awaited<ReturnType<typeof executeToolCall>>['response'],
  formatter: StreamJsonFormatter | null,
): void {
  const output =
    typeof toolResponse.resultDisplay === 'string'
      ? toolResponse.resultDisplay
      : undefined;
  const error = toolResponse.error
    ? {
        type: toolResponse.errorType ?? 'TOOL_EXECUTION_ERROR',
        message: toolResponse.error.message,
      }
    : undefined;
  formatter?.emitEvent({
    type: JsonStreamEventType.TOOL_RESULT,
    timestamp: new Date().toISOString(),
    tool_id: toolId,
    status: toolResponse.error ? 'error' : 'success',
    output,
    error,
  });
}

function shouldDisplayToolResult(
  toolResponse: Awaited<ReturnType<typeof executeToolCall>>['response'],
  context: ResponseProcessingContext,
): boolean {
  if (context.jsonOutput !== false || context.streamJsonOutput !== false) {
    return false;
  }
  if (toolResponse.suppressDisplay === true) {
    return false;
  }
  return (
    typeof toolResponse.resultDisplay === 'string' &&
    toolResponse.resultDisplay.length !== 0
  );
}

function displayToolResult(
  toolName: string,
  toolResponse: Awaited<ReturnType<typeof executeToolCall>>['response'],
  context: ResponseProcessingContext,
): void {
  if (toolResponse.error != null) {
    if (context.jsonOutput === false && context.streamJsonOutput === false) {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/strict-boolean-expressions -- intentional falsy coalescing: empty resultDisplay should fall back to error message */
      debugLogger.error(
        `Error executing tool ${toolName}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
      );
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/strict-boolean-expressions */
    }
    return;
  }
  if (shouldDisplayToolResult(toolResponse, context)) {
    process.stdout.write(`${toolResponse.resultDisplay}\n`);
  }
}

function emitFinalResult(
  context: ResponseProcessingContext,
  jsonResponseText: string,
  startTime: number,
  metrics: SessionMetrics,
): void {
  if (context.streamFormatter) {
    context.streamFormatter.emitEvent({
      type: JsonStreamEventType.RESULT,
      timestamp: new Date().toISOString(),
      status: 'success',
      stats: context.streamFormatter.convertToStreamStats(
        metrics,
        Date.now() - startTime,
      ),
    });
  } else if (context.jsonOutput) {
    process.stdout.write(
      `${JSON.stringify(
        {
          session_id: context.config.getSessionId(),
          response: jsonResponseText.trimEnd(),
          stats: metrics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write('\n');
  }
}

function assertTurnLimit(turnCount: number, maxSessionTurns: number): void {
  if (maxSessionTurns >= 0 && turnCount > maxSessionTurns) {
    throw new FatalTurnLimitedError(
      'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
    );
  }
}

export async function processResponseTurns(
  initialMessages: Part[],
  context: ResponseProcessingContext,
  startTime: number,
  getMetrics: () => SessionMetrics,
): Promise<void> {
  let currentMessages = initialMessages;
  let turnCount = 0;
  let jsonResponseText = '';
  for (;;) {
    turnCount++;
    assertTurnLimit(turnCount, context.maxSessionTurns);
    const result = await processOneTurn(
      currentMessages,
      context,
      jsonResponseText,
    );
    if (result.kind === 'continue') {
      currentMessages = result.messages;
      jsonResponseText = result.jsonResponseText;
    } else {
      if (result.emitFinal) {
        emitFinalResult(
          context,
          result.jsonResponseText,
          startTime,
          getMetrics(),
        );
      }
      return;
    }
  }
}

async function processOneTurn(
  currentMessages: Part[],
  context: ResponseProcessingContext,
  jsonResponseText: string,
): Promise<TurnResult> {
  const functionCalls: RuntimeToolCallRequest[] = [];
  const writeProfileName = context.createProfileNameWriter();
  let thoughtBuffer = '';
  const includeThinking =
    !context.jsonOutput &&
    !context.streamJsonOutput &&
    context.config.getEphemeralSetting('reasoning.includeInResponse') !== false;
  const responseIterator = context.config
    .getGeminiClient()
    .sendMessageStream(
      currentMessages,
      context.abortController.signal,
      context.prompt_id,
    )
    [Symbol.asyncIterator]();
  for (;;) {
    let nextEvent: IteratorResult<ServerGeminiStreamEvent>;
    try {
      nextEvent = await nextStreamEvent(responseIterator, context);
    } catch (error) {
      if (context.abortController.signal.aborted) {
        debugLogger.error('Operation cancelled.');
        return { kind: 'complete', jsonResponseText, emitFinal: false };
      }
      handleStreamReadError(error, context);
      throw error;
    }
    if (nextEvent.done === true) {
      break;
    }
    if (context.abortController.signal.aborted) {
      debugLogger.error('Operation cancelled.');
      return { kind: 'complete', jsonResponseText, emitFinal: false };
    }
    thoughtBuffer = handleThoughtEvent(
      nextEvent.value,
      context,
      writeProfileName,
      thoughtBuffer,
      includeThinking,
    );
    if (nextEvent.value.type === GeminiEventType.Content) {
      thoughtBuffer = flushThoughtBuffer(thoughtBuffer, includeThinking);
      jsonResponseText = handleContentEvent(
        nextEvent.value,
        context,
        writeProfileName,
        jsonResponseText,
      );
    } else if (nextEvent.value.type === GeminiEventType.ToolCallRequest) {
      thoughtBuffer = flushThoughtBuffer(thoughtBuffer, includeThinking);
      collectToolCall(nextEvent.value, functionCalls, context.streamFormatter);
    } else {
      handleControlEvent(nextEvent.value, context.streamFormatter);
      if (nextEvent.value.type === GeminiEventType.AgentExecutionStopped) {
        return { kind: 'complete', jsonResponseText, emitFinal: false };
      }
    }
  }
  flushThoughtBuffer(thoughtBuffer, includeThinking);
  jsonResponseText = flushEmojiBuffer(context, jsonResponseText);
  if (functionCalls.length === 0) {
    return { kind: 'complete', jsonResponseText, emitFinal: true };
  }
  return {
    kind: 'continue',
    messages: await handleToolCalls(functionCalls, context),
    jsonResponseText,
  };
}
