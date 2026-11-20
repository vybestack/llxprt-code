/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export async function collectHistoryFixture(
  source: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of source) rows.push(row);
  return rows;
}
