/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

export type HistorySuffixQuery =
  | { readonly kind: 'recent'; readonly count: number }
  | {
      readonly kind: 'tokens';
      readonly maxTokens: number;
      readonly countTokens: (content: IContent) => number;
    };
