/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools';
import type { IContent } from '../../../../../core/src/services/history/IContent.js';
import { buildMessagesWithReasoning } from '../../OpenAIRequestBuilder.js';
import { projectOpenAIChatPromptEnvelope } from '../../../runtime/promptEnvelopeProjections.js';

export type MistralStrip = 'none' | 'all' | 'allButLast';
export async function legacyUnitTokens(
  messages: readonly unknown[],
): Promise<number> {
  if (messages.length === 0) return 0;
  const count = (items: readonly unknown[]): Promise<number> =>
    projectOpenAIChatPromptEnvelope({
      model: 'mistral-large-latest',
      messages: items,
    }).legacyEstimate();
  return (await count([...messages, ...messages])) - (await count(messages));
}

export async function oldMistralUnitTokens(
  units: readonly IContent[],
  strip: MistralStrip,
): Promise<number> {
  const mapper = getToolIdStrategy('mistral').createMapper([...units]);
  let last = -1;
  for (const [index, unit] of units.entries())
    if (unit.blocks.some((block) => block.type === 'thinking')) last = index;
  let calls: readonly string[] = [];
  let tokens = 0;
  for (const [index, unit] of units.entries()) {
    const mapped: IContent = {
      ...unit,
      blocks: unit.blocks.map((block) => {
        if (block.type === 'tool_call' && unit.speaker === 'ai')
          return { ...block, id: mapper.resolveToolCallId(block) };
        if (block.type === 'tool_response' && unit.speaker === 'tool')
          return { ...block, callId: mapper.resolveToolResponseId(block) };
        return block;
      }),
    };
    const policy = strip === 'allButLast' ? 'all' : strip;
    const selectedStrip =
      strip === 'allButLast' && index === last ? 'none' : policy;
    const prefix: IContent[] =
      unit.speaker === 'tool' && calls.length !== 0
        ? [
            {
              speaker: 'ai',
              blocks: calls.map((id) => ({
                type: 'tool_call',
                id,
                name: 'oracle-prefix',
                parameters: {},
              })),
            },
          ]
        : [];
    const messages = buildMessagesWithReasoning(
      [...prefix, mapped],
      {
        invocation: {
          ephemerals: {
            'reasoning.includeInContext': true,
            'reasoning.stripFromContext': selectedStrip,
          },
        },
      },
      'mistral',
      undefined,
    );
    const selected = messages.slice(prefix.length).filter((message) => {
      if (message.role === 'tool') return calls.includes(message.tool_call_id);
      if (message.role === 'assistant' && message.tool_calls !== undefined)
        calls = message.tool_calls.map((call) => call.id);
      else if (message.role !== 'assistant') calls = [];
      return true;
    });
    tokens += await legacyUnitTokens(selected);
  }
  return tokens;
}
