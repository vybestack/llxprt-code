/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import {
  getToolIdStrategy,
  generateDeterministicMistralId,
} from '@vybestack/llxprt-code-tools';
import type { IContent } from '../../../../../core/src/services/history/IContent.js';
import type { MistralMapping } from '../../../../../core/src/journal/mistralMapping.js';
import { streamChatMessages } from '../../OpenAIChatBodyBuilder.js';
import {
  buildMessagesWithReasoning,
  processAssistantMessage,
  processToolResponses,
  normalizeToolCallArguments,
  buildToolResponseContent,
} from '../../OpenAIRequestBuilder.js';

const reasoning = { invocation: { ephemerals: {} } };

function conversionTrace(units: readonly IContent[]): string[] {
  const trace: string[] = [];
  function record(raw: string): string {
    trace.push(raw);
    return raw;
  }
  for (const unit of units) {
    if (unit.speaker === 'ai')
      processAssistantMessage(
        unit,
        false,
        'mistral',
        (call) => record(call.id),
        normalizeToolCallArguments,
      );
    if (unit.speaker === 'tool')
      processToolResponses(
        unit,
        'mistral',
        (response) => record(response.callId),
        buildToolResponseContent,
        undefined,
        [],
      );
  }
  return trace;
}

export async function assertNativeMistral(
  rows: () => AsyncIterable<IContent>,
  units: readonly IContent[],
  native: { resolve(rawId: string): Promise<MistralMapping> },
): Promise<void> {
  const mapper = getToolIdStrategy('mistral').createMapper([...units]);
  const trace: string[] = [];
  const messages = [];
  for await (const item of streamChatMessages(
    { rows },
    {
      reasoning,
      toolFormat: 'mistral',
      nativeMistral: {
        async resolve(rawId): Promise<MistralMapping> {
          trace.push(rawId);
          const expected = mapper.resolveToolResponseId({
            callId: rawId,
            toolName: '',
          });
          const mapping = await native.resolve(rawId);
          expect(mapping.id).toBe(expected);
          let salt: number | null = null;
          if (!/^[a-zA-Z0-9]{9}$/.test(rawId)) {
            salt = 0;
            while (generateDeterministicMistralId(rawId, salt) !== expected)
              salt++;
          }
          expect(mapping.salt).toBe(salt);
          return mapping;
        },
      },
    },
  )) {
    messages.push(
      item.kind === 'message'
        ? item.message
        : { role: 'user', content: [...item.parts()] },
    );
  }
  expect(trace).toStrictEqual(conversionTrace(units));
  expect(messages).toStrictEqual(
    buildMessagesWithReasoning([...units], reasoning, 'mistral', undefined),
  );
}
