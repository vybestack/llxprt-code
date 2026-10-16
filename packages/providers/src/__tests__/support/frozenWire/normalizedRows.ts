/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { streamProviderContent } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';

const logger = new DebugLogger('frozen-wire-corpus');

/**
 * The unit stream core normalization hands a provider today. Test-side: it
 * collects the whole stream, which the product send paths never do.
 */
export async function normalizedRows(
  rows: readonly IContent[],
): Promise<IContent[]> {
  async function* source(): AsyncGenerator<IContent> {
    for (const row of structuredClone([...rows])) yield row;
  }
  const out: IContent[] = [];
  for await (const row of streamProviderContent(source(), [], logger)) {
    out.push(row);
  }
  return out;
}
