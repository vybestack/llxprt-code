/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

export async function retainHistoryForMemoryTrap(
  service: HistoryService,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of service.streamRawHistory()) rows.push(row);
  return rows;
}
