/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { inMemoryRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import {
  convertToAnthropicMessages,
  type AnthropicConversationConversionOptions,
  type AnthropicMessage,
  type AnthropicMessageBlock,
} from '../../../AnthropicMessageNormalizer.js';
import { sanitizeAnthropicContentImages } from '../../../AnthropicImageSanitizer.js';
import {
  ensureValidMessageSequence,
  stripEmptyTextBlocks,
} from '../../../AnthropicMessageValidator.js';
import { MessageTable } from '../../message-table.js';
import {
  buildValidatedWireTable,
  type WireBuildOptions,
} from '../../wire-builder.js';

export type StripPolicy = 'none' | 'all' | 'allButLast';

export interface WireSettings {
  readonly reasoningEnabled: boolean;
  readonly strip?: StripPolicy;
  readonly includeInContext?: boolean;
  readonly currentModel?: string;
  readonly currentBaseURL?: string;
  readonly supportsUrlImages?: boolean;
  readonly isOAuth?: boolean;
  readonly imageBudget?: ImageDimensionBudget;
}

const logger = { debug: (): void => undefined };

export function conversionOptions(
  settings: WireSettings,
): AnthropicConversationConversionOptions {
  return {
    isOAuth: settings.isOAuth ?? false,
    stripFromContext: settings.strip,
    includeInContext: settings.includeInContext,
    reasoningEnabled: settings.reasoningEnabled,
    config: undefined,
    currentModel: settings.currentModel,
    currentBaseURL: settings.currentBaseURL,
    supportsUrlImages: settings.supportsUrlImages,
    unprefixToolName: (name, oauth) =>
      oauth && name.startsWith('oauth_') ? name.slice('oauth_'.length) : name,
    logger,
  };
}

/**
 * Today's route: the proactive image sanitizer, then `convertToAnthropicMessages`
 * with its validators. The result carries no `cache_control`: the converter
 * only leaves symbol tags on its messages, which JSON does not show.
 */
export function oracleJson(
  rows: readonly IContent[],
  settings: WireSettings,
): string {
  const sanitized = sanitizeAnthropicContentImages(
    structuredClone([...rows]),
    settings.imageBudget,
  ).contents;
  return JSON.stringify(
    convertToAnthropicMessages(sanitized, conversionOptions(settings)),
  );
}

const THINKING = new Set(['thinking', 'redacted_thinking']);

function orderedBlocks(
  role: 'user' | 'assistant',
  blocks: AnthropicMessageBlock[],
): AnthropicMessageBlock[] {
  const first = (block: AnthropicMessageBlock): boolean =>
    role === 'user' ? block.type === 'tool_result' : THINKING.has(block.type);
  return [...blocks.filter(first), ...blocks.filter((block) => !first(block))];
}

/** The table as messages: what the emit walk will write, before the E3 passes. */
export function tableMessages(table: MessageTable): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.text !== undefined) {
      messages.push({ role: message.role, content: message.text });
      continue;
    }
    const blocks = [...table.entries(message)].map((entry) => entry.block);
    messages.push({
      role: message.role,
      content:
        message.ordered === true ? orderedBlocks(message.role, blocks) : blocks,
    });
  }
  return messages;
}

/**
 * The array stages that follow the table passes in `convertToAnthropicMessages`
 * (start with user, placeholders, trailing assistant, empty text blocks). They
 * move to the table in E3; until then the table's messages go through them.
 */
export function finishMessages(
  messages: AnthropicMessage[],
  settings: WireSettings,
): AnthropicMessage[] {
  return stripEmptyTextBlocks(
    ensureValidMessageSequence(
      messages,
      settings.reasoningEnabled,
      settings.currentModel,
      logger,
    ),
    logger,
  );
}

export type WireExtras = Partial<
  Pick<WireBuildOptions, 'mediaStage' | 'signal'>
>;

/** The same messages from the table builder and the E1 passes. */
export async function candidateJson(
  rows: readonly IContent[],
  settings: WireSettings,
  extra: WireExtras = {},
): Promise<string> {
  const table = new MessageTable();
  try {
    await buildValidatedWireTable(
      table,
      inMemoryRequestSelection(structuredClone([...rows])),
      {
        ...conversionOptions(settings),
        imageBudget: settings.imageBudget,
        ...extra,
      },
    );
    return JSON.stringify(finishMessages(tableMessages(table), settings));
  } finally {
    table.close();
  }
}

/** Where two JSON strings first differ, or undefined when they are equal. */
export function describeDifference(
  expected: string,
  actual: string,
): string | undefined {
  if (expected === actual) return undefined;
  let at = 0;
  while (at < expected.length && expected[at] === actual[at]) at++;
  return `first difference at ${at}: expected ...${expected.slice(Math.max(0, at - 60), at + 80)} but got ...${actual.slice(Math.max(0, at - 60), at + 80)}`;
}
