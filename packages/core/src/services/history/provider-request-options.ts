/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';

export interface ProviderCuratedStreamOptions {
  readonly signal?: AbortSignal;
  readonly root?: string;
  readonly ownership?: RowOwnership;
}
