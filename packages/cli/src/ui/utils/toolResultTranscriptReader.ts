/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { NativeJournalPageReader } from '@vybestack/llxprt-code-core';

export async function readToolResultBody(
  filePath: string,
  callId: string,
): Promise<string | undefined> {
  const reader = await NativeJournalPageReader.open(filePath);
  try {
    let lastMatch: string | undefined;
    for await (const entry of reader.entries()) {
      const content = await reader.readContent(entry);
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
