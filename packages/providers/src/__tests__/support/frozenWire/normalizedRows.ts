/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';

const logger = new DebugLogger('frozen-wire-corpus');

/**
 * The unit stream core normalization hands a provider today. Test-side: it
 * collects the whole stream, which the product send paths never do.
 */
export async function normalizedRows(
  rows: readonly IContent[],
): Promise<IContent[]> {
  return buildProviderContent(structuredClone([...rows]), [], logger);
}
