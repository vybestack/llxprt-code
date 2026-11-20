/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../packages/core/src/services/history/IContent.js';
import {
  inMemoryRequestSelection,
  type ProviderRequestSelection,
} from '../../../packages/core/src/services/history/provider-request-snapshot.js';

/** The byte oracle owns fixture rows independently of the provider's readers. */
export async function bodyRequestRows(
  contents: Iterable<IContent> | AsyncIterable<IContent>,
): Promise<ProviderRequestSelection> {
  const rows: IContent[] = [];
  for await (const row of contents) rows.push(row);
  return { ...inMemoryRequestSelection(rows), callerOwned: true };
}
