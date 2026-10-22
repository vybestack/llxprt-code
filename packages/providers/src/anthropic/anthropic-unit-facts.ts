/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  convertBlockToAnthropicPart,
  convertContentToMessages,
  type AnthropicMessage,
  type AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';
import type { AnthropicMessageConversionOptions } from './AnthropicMessageConversionOptions.js';
import { stripCrossModelThinking } from './crossModelThinkingStrip.js';
import { sanitizeRowImages } from './AnthropicImageSanitizer.js';
import {
  measurableAnthropicRow,
  anthropicBlockByteLength,
} from './anthropic-measured-media.js';
import { unprefixAnthropicToolName } from './schemaConverter.js';
import { selectLastCacheableBlockIndex } from './AnthropicRequestBuilder.js';
import {
  readAnchorBlockTag,
  readAnchorStringTag,
} from './AnthropicAnchorCache.js';

export interface AnthropicBlockLength {
  readonly kind: AnthropicMessageBlock['type'];
  readonly bytes: number;
  readonly blank: boolean;
  readonly id?: string;
  readonly anchored: boolean;
  readonly cacheable?: boolean;
}

export type AnthropicAtom =
  | {
      readonly role: AnthropicMessage['role'];
      readonly form: 'string';
      readonly bytes: number;
      readonly blank: boolean;
      readonly anchored: boolean;
    }
  | {
      readonly role: AnthropicMessage['role'];
      readonly form: 'array';
      readonly blocks: readonly AnthropicBlockLength[];
    };

export interface AnthropicUnitFacts {
  readonly speaker: IContent['speaker'];
  readonly chainStart: boolean;
  readonly hasThinking: boolean;
  readonly atoms: readonly [readonly AnthropicAtom[], readonly AnthropicAtom[]];
  readonly chain: readonly [AnthropicAtom, AnthropicAtom];
}

const logger = { debug: (): void => undefined };

function blockId(block: AnthropicMessageBlock): string | undefined {
  if (block.type === 'tool_use') return block.id;
  return block.type === 'tool_result' ? block.tool_use_id : undefined;
}

function blockLength(block: AnthropicMessageBlock): AnthropicBlockLength {
  return {
    kind: block.type,
    bytes: anthropicBlockByteLength(block),
    blank: block.type === 'text' && block.text.trim() === '',
    id: blockId(block),
    anchored: readAnchorBlockTag(block),
    cacheable: selectLastCacheableBlockIndex([block]) === 0,
  };
}

function atomLength(message: AnthropicMessage): AnthropicAtom {
  return typeof message.content === 'string'
    ? {
        role: message.role,
        form: 'string',
        bytes: Buffer.byteLength(JSON.stringify(message.content)),
        blank: message.content.trim() === '',
        anchored: readAnchorStringTag(message),
      }
    : {
        role: message.role,
        form: 'array',
        blocks: message.content.map(blockLength),
      };
}

function chainLength(
  row: IContent,
  redact: boolean,
  options: AnthropicMessageConversionOptions,
): AnthropicAtom {
  const blocks: AnthropicBlockLength[] = [];
  if (row.speaker === 'ai') {
    for (const block of row.blocks) {
      const part = convertBlockToAnthropicPart(block, 0, redact, options);
      if (part !== null) blocks.push(blockLength(part));
    }
  }
  return { role: 'assistant', form: 'array', blocks };
}

export function projectAnthropicUnit(
  row: IContent,
  settings: RowFormatSettings,
): IContent | undefined {
  if (
    [
      settings.formatId !== 'anthropic',
      settings.formatRev !== 1,
      settings.toolNameTransform !== (settings.isOAuth ? 'oauth' : 'none'),
      settings.unsupportedMedia !== 'notice',
    ].includes(true)
  )
    throw new JournalFormatError(
      'Anthropic unit facts do not support these converter settings',
    );
  if (settings.anthropic === undefined || settings.anthropic.cache !== 'off')
    throw new JournalFormatError(
      'Anthropic numeric facts require explicit cache-off settings',
    );
  if (
    row.speaker === 'ai' &&
    row.blocks.some((block) => block.type === 'tool_response')
  )
    throw new JournalFormatError(
      'Anthropic unit facts require normalized AI units without tool responses',
    );
  const sized = measurableAnthropicRow(
    sanitizeRowImages(row, settings.anthropic.imageBudget ?? undefined).row,
  );
  const kept = stripCrossModelThinking(
    [sized],
    settings.model,
    settings.endpoint,
    logger,
  );
  return kept[0];
}

export function anthropicUnitFacts(
  row: IContent,
  settings: RowFormatSettings,
): AnthropicUnitFacts | undefined {
  const projected = projectAnthropicUnit(row, settings);
  if (projected === undefined) return undefined;
  const options: AnthropicMessageConversionOptions = {
    isOAuth: settings.isOAuth,
    reasoningEnabled: settings.reasoningEnabled,
    supportsUrlImages: settings.supportsUrlImages,
    config: settings.outputLimits ?? undefined,
    unprefixToolName: unprefixAnthropicToolName,
    logger,
  };
  const atoms = (redact: boolean): readonly AnthropicAtom[] =>
    convertContentToMessages(
      [projected],
      new Set(redact ? [0] : []),
      options,
    ).map(atomLength);
  return {
    speaker: projected.speaker,
    chainStart:
      settings.reasoningEnabled &&
      projected.speaker === 'ai' &&
      projected.blocks.length > 0 &&
      projected.blocks.every(
        (block) =>
          block.type === 'thinking' && block.sourceField === 'thinking',
      ),
    hasThinking: projected.blocks.some((block) => block.type === 'thinking'),
    atoms: [atoms(false), atoms(true)],
    chain: [
      chainLength(projected, false, options),
      chainLength(projected, true, options),
    ],
  };
}
