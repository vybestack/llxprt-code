/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { ResponsesVariant } from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import {
  buildOpenAIResponsesUnit,
  type ResponsesToolPairs,
} from './OpenAIResponsesInputBuilder.js';
import {
  inlineBase64ByteLength,
  classifyMediaBlock,
} from '../utils/mediaUtils.js';
import type { ResponsesInputItem } from './OpenAIResponsesTypes.js';

export interface ResponsesUnitLength {
  readonly bytes: number;
  readonly count: number;
  readonly generatedIds: number;
  readonly pdfBytes: number;
}

export async function responsesUnitPairs(
  unit: IContent,
  query: Pick<IndexedJournalRequestSnapshot, 'count' | 'normalizedCount'>,
  from = 0,
): Promise<ResponsesToolPairs> {
  const range = { from, to: query.count };
  const calls = new Set<string>();
  const responses = new Set<string>();
  for (const block of unit.blocks) {
    if (unit.speaker === 'ai' && block.type === 'tool_call') {
      const id = normalizeToOpenAIToolId(block.id);
      if ((await query.normalizedCount(1, 1, id, range)) > 0) responses.add(id);
    } else if (unit.speaker === 'tool' && block.type === 'tool_response') {
      const id = normalizeToOpenAIToolId(block.callId);
      if ((await query.normalizedCount(1, 0, id, range)) > 0) calls.add(id);
    }
  }
  return {
    hasCall: (id) => calls.has(id),
    hasResponse: (id) => responses.has(id),
  };
}

function emittedPdfBytes(item: ResponsesInputItem): number {
  if (!('role' in item) || item.role !== 'user' || !Array.isArray(item.content))
    return 0;
  let bytes = 0;
  for (const part of item.content)
    if (part.type === 'input_file')
      bytes += inlineBase64ByteLength(part.file_data);
  return bytes;
}

export function responsesUnitLength(
  unit: IContent,
  settings: RowFormatSettings,
  includeReasoning: boolean,
  pairs: ResponsesToolPairs,
  serverSideParentActive = false,
): ResponsesUnitLength {
  const measured = measurableResponsesUnit(unit, settings.mediaPdfEnabled);
  const items = buildOpenAIResponsesUnit(
    measured.unit,
    {
      includeReasoningInContext: includeReasoning,
      outputLimits: settings.outputLimits ?? parseOutputLimits({}),
      debug: () => undefined,
      mediaPdfEnabled: settings.mediaPdfEnabled,
      reasoningIdTime: 0,
      serverSideParentActive,
    },
    pairs,
    () => '',
  );
  let bytes = 0;
  let generatedIds = 0;
  let pdfBytes = 0;
  for (const item of items) {
    if ('type' in item && item.type === 'reasoning' && item.id === '') {
      const { id: _id, ...withoutId } = item;
      bytes += Buffer.byteLength(JSON.stringify(withoutId));
      generatedIds++;
    } else bytes += Buffer.byteLength(JSON.stringify(item));
    pdfBytes += emittedPdfBytes(item);
  }
  const emittedMedia = items.some(
    (item) =>
      'role' in item && item.role === 'user' && Array.isArray(item.content),
  );
  return {
    bytes: bytes + (emittedMedia ? measured.bytes : 0),
    count: items.length,
    generatedIds,
    pdfBytes: pdfBytes + (emittedMedia ? measured.pdfBytes : 0),
  };
}

function measurableResponsesUnit(
  unit: IContent,
  pdfEnabled: boolean,
): {
  readonly unit: IContent;
  readonly bytes: number;
  readonly pdfBytes: number;
} {
  let bytes = 0;
  let pdfBytes = 0;
  const blocks = unit.blocks.map<IContent['blocks'][number]>((block) => {
    if (block.type !== 'media' || block.encoding !== 'reference') return block;
    const category = classifyMediaBlock(block);
    if (category === 'image' || (category === 'pdf' && pdfEnabled))
      bytes += block.normalizedBase64Length;
    if (category === 'pdf' && pdfEnabled) pdfBytes += block.byteLength;
    return {
      type: block.type,
      mimeType: block.mimeType,
      encoding: 'base64',
      data: '',
      ...(block.filename === undefined ? {} : { filename: block.filename }),
    };
  });
  return { unit: { ...unit, blocks }, bytes, pdfBytes };
}

export function responsesUnitSummary(
  facts: ResponsesUnitLength,
): ResponsesVariant {
  const { bytes, count, generatedIds } = facts;
  return {
    out: [count === 0 ? 0 : 1, 1],
    bytes: [count === 0 ? 0 : bytes + count - 1, bytes + count],
    count: [count, count],
    r: generatedIds,
  };
}

export function reasoningDigitBytes(count: number): number {
  let bytes = Number(count > 0);
  for (let first = 1, digits = 1; first < count; first *= 10, digits++)
    bytes += (Math.min(count, first * 10) - first) * digits;
  return bytes;
}
