/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ChronologyReplacedSpan,
  ContentMetadata,
  IContent,
} from './IContent.js';

export interface CompressionSourceRange {
  readonly from: number;
  readonly to: number;
}

export interface CompressionChronologySelection {
  readonly ranges: readonly CompressionSourceRange[];
  readonly generated: readonly IContent[];
}

export interface CompressionSpanAnnotation {
  readonly span: ChronologyReplacedSpan;
  readonly frontier: ContentMetadata['semanticMediaPurgeFrontier'];
  readonly hasFrontier: boolean;
}
