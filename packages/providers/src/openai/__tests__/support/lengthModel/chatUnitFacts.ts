/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the per-unit stored facts of the chat length model.
 * They are produced by the real converters in "count mode": the converter's
 * own message objects are measured, so key order and escaping are whatever
 * the converter emits. Each unit is converted twice, once with its thinking
 * kept and once with it removed, because the strip policy picks per unit.
 */

import type OpenAI from 'openai';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import {
  createInMemoryToolIdStore,
  getToolIdStrategy,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { jsonBytes } from '../../../../__tests__/support/lengthModel/bytes.js';
import { removeThinkingFromContent } from '../../../../reasoning/reasoningUtils.js';
import { classifyMediaBlock } from '../../../../utils/mediaUtils.js';
import {
  buildToolResponseContent,
  convertBlockToPart,
  normalizeToolCallArguments,
  processAssistantMessage,
  processToolResponses,
  processUserMessage,
} from '../../../OpenAIRequestBuilder.js';
import type { StripPolicy } from './chatDrops.js';
import type {
  ChatMessageFact,
  ChatUnit,
  IdUse,
  PendingMedia,
} from './chatTransducer.js';
import {
  kimiFactsOf,
  kimiResolvers,
  type KimiFacts,
  type KimiNameRule,
  type KimiResolvers,
} from './kimiIdFacts.js';

export interface ChatSettings {
  readonly toolFormat: ToolFormat | undefined;
  readonly strip: StripPolicy;
  readonly includeInContext: boolean;
  /** Kimi only; `lastEligible` is what the mapper does, the others are controls. */
  readonly kimiRule: KimiNameRule;
}

export interface ChatFacts {
  readonly units: ChatUnit[];
  readonly kimi: KimiFacts | undefined;
  /** Mistral ids on the wire that are not nine alphanumeric characters. */
  readonly mistralIdViolations: number;
}

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

interface Conversion {
  readonly resolvers: KimiResolvers;
  readonly log: IdUse[];
}

/**
 * Mistral ids come from the real mapper over an in-memory store. The store is
 * a STAND-IN for the on-disk id index; the length model needs only that every
 * mapped id is nine characters, which the facts count.
 */
function mistralResolvers(live: readonly IContent[]): KimiResolvers {
  const mapper = getToolIdStrategy('mistral').createStreamingMapper(
    createInMemoryToolIdStore(),
  );
  for (const row of live) mapper.observe(structuredClone(row));
  return {
    call: (call) => mapper.resolveToolCallId(call),
    response: (response) => mapper.resolveToolResponseId(response),
  };
}

const genericResolvers: KimiResolvers = {
  call: (call) => normalizeToOpenAIToolId(call.id),
  response: (response) => normalizeToOpenAIToolId(response.callId),
};

/** One conversion per thinking variant: the unmapped Kimi counter is per conversion. */
function conversionsOf(
  live: readonly IContent[],
  settings: ChatSettings,
  kimi: KimiFacts | undefined,
): readonly [Conversion, Conversion] {
  const shared =
    settings.toolFormat === 'mistral'
      ? mistralResolvers(live)
      : genericResolvers;
  const make = (): Conversion => {
    const log: IdUse[] = [];
    if (kimi === undefined) return { resolvers: shared, log };
    const counter = { next: 0 };
    return {
      resolvers: kimiResolvers(kimi, settings.kimiRule, counter, log),
      log,
    };
  };
  return [make(), make()];
}

function messagesOf(
  row: IContent,
  settings: ChatSettings,
  resolvers: KimiResolvers,
  pending: MediaBlock[],
): ChatMessage[] {
  if (row.speaker === 'human') {
    const message = processUserMessage(row);
    return message === null ? [] : [message];
  }
  if (row.speaker === 'ai') {
    const message = processAssistantMessage(
      row,
      settings.includeInContext,
      settings.toolFormat,
      resolvers.call,
      normalizeToolCallArguments,
    );
    return message === null ? [] : [message];
  }
  return processToolResponses(
    row,
    settings.toolFormat ?? 'openai',
    resolvers.response,
    buildToolResponseContent,
    undefined,
    pending,
  );
}

/** The id uses of each message: one per tool message, all of an assistant's. */
function usesPerMessage(
  speaker: string,
  messageCount: number,
  log: IdUse[],
): IdUse[][] {
  const uses = log.splice(0);
  if (uses.length === 0) return Array.from({ length: messageCount }, () => []);
  if (speaker === 'tool') {
    if (uses.length !== messageCount) {
      throw new Error('tool message and id use counts differ');
    }
    return uses.map((use) => [use]);
  }
  if (messageCount !== 1) throw new Error('id uses without a message');
  return [uses];
}

function messageFact(message: ChatMessage, uses: IdUse[]): ChatMessageFact {
  const placeholders = uses.reduce((sum, use) => sum + use.placeholderBytes, 0);
  return {
    bytes: jsonBytes(message) - placeholders,
    role: message.role,
    callIds:
      message.role === 'assistant' && message.tool_calls !== undefined
        ? message.tool_calls.map((call) => call.id)
        : undefined,
    toolCallId: message.role === 'tool' ? message.tool_call_id : undefined,
    uses,
  };
}

function pendingFact(block: MediaBlock): PendingMedia {
  const part = convertBlockToPart(block);
  return {
    video: classifyMediaBlock(block) === 'video',
    part: part === null ? null : jsonBytes(part),
  };
}

interface VariantFact {
  readonly messages: ChatMessageFact[];
  readonly images: PendingMedia[];
}

function variantFact(
  row: IContent,
  removeThinking: boolean,
  settings: ChatSettings,
  conversion: Conversion,
): VariantFact {
  const converted = removeThinking
    ? removeThinkingFromContent(structuredClone(row))
    : structuredClone(row);
  const pending: MediaBlock[] = [];
  const messages = messagesOf(
    converted,
    settings,
    conversion.resolvers,
    pending,
  );
  const uses = usesPerMessage(row.speaker, messages.length, conversion.log);
  return {
    messages: messages.map((message, at) => messageFact(message, uses[at])),
    images: pending.map(pendingFact),
  };
}

function countMistralViolations(units: readonly ChatUnit[]): number {
  let violations = 0;
  for (const unit of units) {
    for (const message of unit.messages[0]) {
      const ids =
        message.toolCallId === undefined
          ? (message.callIds ?? [])
          : [message.toolCallId];
      violations += ids.filter((id) => !/^[a-zA-Z0-9]{9}$/.test(id)).length;
    }
  }
  return violations;
}

/** The facts of every block-bearing row, in order. */
export function chatUnitFacts(
  rows: readonly IContent[],
  settings: ChatSettings,
): ChatFacts {
  const live = rows.filter((row) => Array.isArray(row.blocks));
  const kimi =
    settings.toolFormat === 'kimi'
      ? kimiFactsOf(live, settings.kimiRule)
      : undefined;
  const [kept, removed] = conversionsOf(live, settings, kimi);
  const units = live.map((row, index): ChatUnit => {
    const keep = variantFact(row, false, settings, kept);
    const strip = variantFact(row, true, settings, removed);
    return {
      index,
      speaker: row.speaker,
      hasThinking: row.blocks.some((block) => block.type === 'thinking'),
      hasCall:
        row.speaker === 'ai' &&
        row.blocks.some((block) => block.type === 'tool_call'),
      messages: [keep.messages, strip.messages],
      images: [keep.images, strip.images],
    };
  });
  const mistralIdViolations =
    settings.toolFormat === 'mistral' ? countMistralViolations(units) : 0;
  return { units, kimi, mistralIdViolations };
}
