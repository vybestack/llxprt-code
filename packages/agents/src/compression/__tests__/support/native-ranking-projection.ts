/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export async function nativeRankingProjection(
  rows: AsyncIterable<IContent>,
  stubTokens: number,
): Promise<number> {
  let tokens = 0;
  for await (const row of rows)
    for (const block of row.blocks)
      if (block.type === 'tool_response')
        tokens +=
          block.providerMetadata?.contextTruncated === true ? stubTokens : 1000;
  return tokens;
}
