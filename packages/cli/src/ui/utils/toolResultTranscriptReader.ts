/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import { readStoredRow } from '@vybestack/llxprt-code-core/journal/rowReads.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';

export async function readToolResultBody(
  filePath: string,
  callId: string,
): Promise<string | undefined> {
  const reader = await openJournalReadOnly(filePath);
  try {
    const root = rowTreeRootOf(reader.trailer);
    if (root === undefined) return undefined;
    let lastMatch: string | undefined;
    for await (const entry of iterateRowEntries(reader, root)) {
      const content = decodeStoredRow(await readStoredRow(reader, entry));
      if (content.speaker !== 'tool') continue;
      const response = content.blocks.find(
        (block) => block.type === 'tool_response' && block.callId === callId,
      );
      if (response?.type === 'tool_response')
        lastMatch = displayBodyFor(response.result);
    }
    return lastMatch;
  } finally {
    await reader.close();
  }
}

function displayBodyFor(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}
