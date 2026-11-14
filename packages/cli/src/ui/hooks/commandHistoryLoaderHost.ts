/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/** Published history is already in the journal; invalidate only its view. */
export function bindPublishedHistoryRefresh(refresh: () => void): () => void {
  return refresh;
}
