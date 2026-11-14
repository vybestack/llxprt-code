/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createStreamInterruptionError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { ownedString } from '@vybestack/llxprt-code-core/utils/ownedString.js';
import type {
  FunctionCallState,
  ResponsesEvent,
} from './parseResponsesStreamTypes.js';
import {
  assertProviderStreamByteLimit,
  assertToolCallArgumentsWithinLimit,
  MAX_PROVIDER_TOOL_CALL_BYTES,
  utf8ByteLength,
} from '../streamLimits.js';

function argumentContent(
  call: FunctionCallState,
  argumentsValue: string,
): IContent {
  return {
    speaker: 'ai',
    blocks: [],
    toolArgumentDelta: {
      sourceId: call.id,
      id: call.call_id ?? call.id,
      name: call.name,
      arguments: argumentsValue,
    },
  };
}

export function* handleOutputItemAdded(
  event: ResponsesEvent,
  functionCalls: Map<string, FunctionCallState>,
): Generator<IContent> {
  if (event.item?.type !== 'function_call' || !event.item.id) return;
  const argumentsValue = event.item.arguments ?? '';
  const argumentBytes = utf8ByteLength(argumentsValue);
  assertProviderStreamByteLimit(
    'tool-call arguments',
    argumentBytes,
    MAX_PROVIDER_TOOL_CALL_BYTES,
  );
  const call: FunctionCallState = {
    id: event.item.id,
    call_id: event.item.call_id,
    name: event.item.name ?? '',
    arguments: argumentsValue,
    argumentBytes,
  };
  functionCalls.set(call.id, call);
  if (argumentsValue) yield argumentContent(call, argumentsValue);
}

export function* handleArgumentsDelta(
  event: ResponsesEvent,
  functionCalls: Map<string, FunctionCallState>,
): Generator<IContent> {
  if (!event.item_id || !event.delta) return;
  const call = functionCalls.get(event.item_id);
  if (call === undefined) return;
  call.argumentBytes += utf8ByteLength(event.delta);
  assertProviderStreamByteLimit(
    'tool-call arguments',
    call.argumentBytes,
    MAX_PROVIDER_TOOL_CALL_BYTES,
  );
  call.arguments += event.delta;
  yield argumentContent(call, event.delta);
}

export function* handleFunctionCallDone(
  event: ResponsesEvent,
  functionCalls: Map<string, FunctionCallState>,
): Generator<IContent> {
  const itemId = event.item?.id ?? event.item_id;
  if (!itemId) return;
  const call = functionCalls.get(itemId);
  if (!call) return;
  assertToolCallArgumentsWithinLimit(event.arguments);
  const finalArguments = event.arguments ?? call.arguments;
  let parsedArguments: unknown = {};
  if (finalArguments) {
    try {
      parsedArguments = JSON.parse(finalArguments);
    } catch (parseError) {
      throw createStreamInterruptionError(
        'Streaming tool call arguments were malformed JSON.',
        { itemId, snippet: ownedString(finalArguments.slice(0, 200)) },
        parseError,
      );
    }
  }
  const content = argumentContent(call, '');
  const replacement = finalArguments || '{}';
  yield {
    ...content,
    toolArgumentDelta: {
      sourceId: call.id,
      id: call.call_id ?? call.id,
      name: call.name,
      arguments: '',
      complete: true,
      ...(replacement === call.arguments
        ? {}
        : { replacementArguments: replacement }),
    },
    blocks: [
      {
        type: 'tool_call',
        id: call.call_id ?? call.id,
        name: call.name,
        parameters: parsedArguments,
      },
    ],
  };
  functionCalls.delete(itemId);
}
