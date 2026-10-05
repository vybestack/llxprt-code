/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../services/history/IContent.js';

/** Test-only collection for assertions that compare complete fixtures. */
export async function collectRawHistory(history: {
  streamRawHistory(): AsyncIterable<IContent>;
}): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of history.streamRawHistory()) rows.push(row);
  return rows;
}
