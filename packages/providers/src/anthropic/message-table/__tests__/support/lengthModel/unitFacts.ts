/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: per-unit stored facts for the Anthropic length model.
 *
 * A unit is a row after the row-local projection (image budget, cross-model
 * thinking strip). The facts are produced by the real converters in "count
 * mode": the converter's own output objects are measured, so key order and
 * escaping are whatever the converter emits. Test-side code: it holds whole
 * histories, which the product never does.
 */

import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  convertBlockToAnthropicPart,
  convertContentToMessages,
  type AnthropicMessage,
  type AnthropicMessageBlock,
} from '../../../../AnthropicMessageNormalizer.js';
import { projectRow } from '../../../project-row.js';
import {
  readAnchorBlockTag,
  readAnchorStringTag,
} from '../../../../AnthropicAnchorCache.js';
import { readPurgeStringTag } from '../../../../AnthropicMediaPurgeCache.js';
import { conversionOptions, type WireSettings } from '../wireBuilderHarness.js';

export const utf8 = (value: string): number => Buffer.byteLength(value);
export const jsonBytes = (value: unknown): number =>
  utf8(JSON.stringify(value));

export interface BlockFact {
  readonly kind: AnthropicMessageBlock['type'];
  readonly bytes: number;
  /** A text block whose text is blank: the finishing pass strips it. */
  readonly blank: boolean;
  /** tool_use id, or tool_result tool_use_id. */
  readonly id?: string;
  /** The converter tagged this block as the cache anchor. */
  readonly anchored: boolean;
  readonly obj: AnthropicMessageBlock;
  /** For the thinking-chain path: index of the source block in the row. */
  readonly src?: number;
}

export interface StrFact {
  readonly text: string;
  /** JSON bytes of the string, quotes included. */
  readonly bytes: number;
  readonly blank: boolean;
  readonly anchored: boolean;
  /** The media purge boundary identity the converter tagged this message with. */
  readonly purge?: object;
}

export interface AtomFact {
  readonly role: 'U' | 'A';
  /** The results message a row's tool_response blocks make. */
  readonly isResults: boolean;
  readonly str?: StrFact;
  readonly blocks?: readonly BlockFact[];
}

export type Speaker = 'human' | 'ai' | 'tool';

export interface UnitFact {
  readonly index: number;
  readonly row: IContent;
  readonly speaker: Speaker;
  readonly chainStart: boolean;
  readonly hasThinking: boolean;
  readonly anchorMeta: boolean;
  readonly hasResponses: boolean;
  readonly onlyToolResponses: boolean;
  /** By mode: 0 keeps thinking, 1 redacts it. */
  readonly atoms: readonly [readonly AtomFact[], readonly AtomFact[]];
  /** Blocks as the thinking-chain path converts them (AI units only). */
  readonly chain: readonly [readonly BlockFact[], readonly BlockFact[]];
}

function toolId(block: AnthropicMessageBlock): string | undefined {
  if (block.type === 'tool_use') return block.id;
  if (block.type === 'tool_result') return block.tool_use_id;
  return undefined;
}

export function blockFact(block: AnthropicMessageBlock): BlockFact {
  return {
    kind: block.type,
    bytes: jsonBytes(block),
    blank: block.type === 'text' && block.text.trim() === '',
    id: toolId(block),
    anchored: readAnchorBlockTag(block),
    obj: block,
  };
}

function atomFact(message: AnthropicMessage, isResults: boolean): AtomFact {
  const role = message.role === 'user' ? 'U' : 'A';
  if (typeof message.content === 'string') {
    return {
      role,
      isResults,
      str: {
        text: message.content,
        bytes: jsonBytes(message.content),
        blank: message.content.trim() === '',
        anchored: readAnchorStringTag(message),
        purge: readPurgeStringTag(message),
      },
    };
  }
  return { role, isResults, blocks: message.content.map(blockFact) };
}

function isModelBoundThinking(block: ContentBlock): boolean {
  return block.type === 'thinking' && block.sourceField === 'thinking';
}

export function startsThinkingChain(row: IContent, enabled: boolean): boolean {
  return (
    enabled &&
    row.speaker === 'ai' &&
    row.blocks.length > 0 &&
    row.blocks.every(isModelBoundThinking)
  );
}

function onlyToolResponsesOf(row: IContent): boolean {
  return (
    row.blocks.some((block) => block.type === 'tool_response') &&
    row.blocks.every(
      (block) =>
        block.type === 'tool_response' ||
        block.type === 'text' ||
        block.type === 'code',
    )
  );
}

export function projectionOf(settings: WireSettings): {
  currentModel: string | undefined;
  currentBaseURL: string | undefined;
  logger: { debug: () => void };
  imageBudget: WireSettings['imageBudget'];
} {
  return {
    currentModel: settings.currentModel,
    currentBaseURL: settings.currentBaseURL,
    logger: { debug: (): void => undefined },
    imageBudget: settings.imageBudget,
  };
}

type Conversion = ReturnType<typeof conversionOptions>;

function atomsOf(
  row: IContent,
  redact: boolean,
  options: Conversion,
): AtomFact[] {
  const hasResponses = row.blocks.some((b) => b.type === 'tool_response');
  const messages = convertContentToMessages(
    [structuredClone(row)],
    new Set(redact ? [0] : []),
    options,
  );
  return messages.map((message, at) =>
    atomFact(message, hasResponses && at === 0),
  );
}

function chainOf(
  row: IContent,
  redact: boolean,
  options: Conversion,
): BlockFact[] {
  if (row.speaker !== 'ai') return [];
  const out: BlockFact[] = [];
  structuredClone(row.blocks).forEach((block, src) => {
    const part = convertBlockToAnthropicPart(block, 0, redact, options);
    if (part !== null) out.push({ ...blockFact(part), src });
  });
  return out;
}

export function unitOf(
  index: number,
  row: IContent,
  settings: WireSettings,
  options: Conversion,
): UnitFact {
  return {
    index,
    row,
    speaker: row.speaker,
    chainStart: startsThinkingChain(row, settings.reasoningEnabled),
    hasThinking: row.blocks.some((block) => block.type === 'thinking'),
    anchorMeta: row.metadata?.cacheAnchor === true,
    hasResponses: row.blocks.some((block) => block.type === 'tool_response'),
    onlyToolResponses: onlyToolResponsesOf(row),
    atoms: [atomsOf(row, false, options), atomsOf(row, true, options)],
    chain: [chainOf(row, false, options), chainOf(row, true, options)],
  };
}

/** Units of a history for one format key (settings), both thinking modes. */
export function unitFacts(
  rows: readonly IContent[],
  settings: WireSettings,
): UnitFact[] {
  const options = conversionOptions(settings);
  const projection = projectionOf(settings);
  const units: UnitFact[] = [];
  for (const raw of structuredClone([...rows])) {
    const row = projectRow(raw, projection);
    if (row === undefined) continue;
    units.push(unitOf(units.length, row, settings, options));
  }
  return units;
}
