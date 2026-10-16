/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: the histories the peak-during-send probe sends.
 *
 * Two shapes at two sizes. `text-only` alternates human and assistant text.
 * `tool-heavy` repeats a four-row group (human text, assistant tool call, tool
 * result, assistant text) and carries one inline image. The small size is
 * about 1 MiB of request body and the large size is at least 8 MiB, so a
 * structure proportional to the history shows as growth between the two.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryCase } from './wireBodyHistories.js';
import type { HistoryRequestShape } from './wireBodyCapture.js';

export type SendPeakShape = 'text-only' | 'tool-heavy';
export type SendPeakSize = 'small' | 'large';

export const SEND_PEAK_SHAPES: readonly SendPeakShape[] = [
  'text-only',
  'tool-heavy',
];
export const SEND_PEAK_SIZES: readonly SendPeakSize[] = ['small', 'large'];

const ROW_COUNT: Record<SendPeakSize, number> = {
  small: 1024,
  large: 8192,
};

/** The request fields every probe history shares. */
export const SEND_PEAK_REQUEST_SHAPE: HistoryRequestShape = {
  systemInstruction: 'You are a terse assistant.',
};

const PNG_DATA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Whole code points only, so no length cut can split a surrogate pair. */
const FILLER_UNIT = 'snow 雪 grin 😀 quote " slash \\ line\n ';

/** Text of at least `length` characters that differs for every `seed`. */
function filler(seed: number, length: number): string {
  return `${seed}: ${FILLER_UNIT.repeat(Math.ceil(length / FILLER_UNIT.length))}`;
}

function textRow(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function textOnlyRows(count: number): IContent[] {
  return Array.from({ length: count }, (_, index) =>
    textRow(index % 2 === 0 ? 'human' : 'ai', filler(index, 850)),
  );
}

function toolHeavyGroup(group: number): IContent[] {
  const human = textRow('human', filler(group, 600));
  if (group === 8) {
    human.blocks.push({
      type: 'media',
      mimeType: 'image/png',
      encoding: 'base64',
      data: PNG_DATA,
    });
  }
  return [
    human,
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: `call_${group}`,
          name: 'read_file',
          parameters: {
            path: `/src/file-${group}.ts`,
            note: filler(group, 400),
          },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: `call_${group}`,
          toolName: 'read_file',
          result: filler(group, 2800),
        },
      ],
    },
    textRow('ai', filler(group, 600)),
  ];
}

function toolHeavyRows(count: number): IContent[] {
  return Array.from({ length: count / 4 }, (_, group) =>
    toolHeavyGroup(group),
  ).flat();
}

/** The rows of one probe history; the last row is always a human turn. */
export function buildSendPeakRows(
  shape: SendPeakShape,
  size: SendPeakSize,
): IContent[] {
  const count = ROW_COUNT[size];
  const rows =
    shape === 'text-only' ? textOnlyRows(count) : toolHeavyRows(count);
  rows[rows.length - 1] = textRow('human', filler(count, 600));
  return rows;
}

export function sendPeakHistory(
  shape: SendPeakShape,
  size: SendPeakSize,
): HistoryCase {
  return {
    id: `send-peak-${shape}-${size}`,
    description: `${shape} history of ${ROW_COUNT[size]} rows`,
    rows: buildSendPeakRows(shape, size),
    ...SEND_PEAK_REQUEST_SHAPE,
  };
}

export interface SendPeakRowFiles {
  readonly directory: string;
  readonly count: number;
}

/**
 * Writes each row to its own file (`<index>.row`, v8-serialized) so the child
 * can read them back one at a time without ever holding the history.
 */
export function writeSendPeakRows(
  directory: string,
  rows: readonly IContent[],
): SendPeakRowFiles {
  mkdirSync(directory, { recursive: true });
  for (const [index, row] of rows.entries()) {
    writeFileSync(join(directory, `${index}.row`), serialize(row));
  }
  return { directory, count: rows.length };
}
