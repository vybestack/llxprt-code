/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentBlock } from './IContent.js';

export interface SemanticMediaPurgeFrontier {
  readonly contentIndex: number;
  readonly blockIndex: number;
  readonly contentId?: string;
  readonly mediaId?: string;
}

export interface SemanticMediaPurgeOptions {
  readonly mode: 'remove' | 'summary';
  readonly summaryText?: string;
}

export interface SemanticMediaPurgeOutcome {
  readonly status: 'success' | 'error' | 'cancelled' | 'retry-handoff';
  readonly cachePrefixWritten: boolean;
}

export interface SemanticMediaPurgeBoundary {
  readonly contentIndex: number;
  readonly blockIndex: number;
}

export class SemanticMediaPurgeBoundaryIdentity {
  readonly #contentIndex: number;
  readonly #blockIndex: number;

  constructor(boundary: SemanticMediaPurgeBoundary) {
    this.#contentIndex = boundary.contentIndex;
    this.#blockIndex = boundary.blockIndex;
    Object.freeze(this);
  }

  matches(boundary: SemanticMediaPurgeBoundary): boolean {
    return (
      this.#contentIndex === boundary.contentIndex &&
      this.#blockIndex === boundary.blockIndex
    );
  }
}

const MIME_TYPE_PATTERN =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isPurgeableImage(
  block: ContentBlock,
  location: SemanticMediaPurgeBoundary,
): boolean {
  if (block.type !== 'media') return false;
  const mimeType: unknown = Reflect.get(block, 'mimeType');
  let essence = '';
  if (typeof mimeType === 'string') {
    const parameterStart = mimeType.indexOf(';');
    essence = mimeType;
    if (parameterStart >= 0) essence = mimeType.slice(0, parameterStart);
    essence = essence.trim();
  }
  if (!MIME_TYPE_PATTERN.test(essence)) {
    throw new Error(
      `Semantic media purge at contentIndex=${location.contentIndex}, blockIndex=${location.blockIndex} found malformed MIME data`,
    );
  }
  return essence.toLowerCase().startsWith('image/');
}

export function hasSummaryReplacement(
  block: ContentBlock,
  options: SemanticMediaPurgeOptions,
): boolean {
  if (options.mode !== 'summary' || options.summaryText !== undefined)
    return true;
  if (block.type !== 'media' || block.caption === undefined) return false;
  return block.caption.trim().length > 0;
}

export function replacementBlock(
  options: SemanticMediaPurgeOptions,
  source: ContentBlock,
): ContentBlock | undefined {
  if (options.mode === 'remove') {
    return undefined;
  }
  const summaryText =
    options.summaryText ??
    (source.type === 'media' ? source.caption : undefined);
  if (summaryText === undefined || summaryText.trim().length === 0) {
    throw new Error('Semantic media purge summary text must be non-empty');
  }
  return Object.freeze({ type: 'text', text: summaryText });
}

export function freezeSemanticPurgeValue(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return;
  }
  for (const child of Object.values(value)) {
    freezeSemanticPurgeValue(child);
  }
  Object.freeze(value);
}

function optionalIdentity(
  frontier: SemanticMediaPurgeFrontier,
  property: 'contentId' | 'mediaId',
): string | undefined {
  const value: unknown = Reflect.get(frontier, property);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function restoredFrontierValue(
  frontier: SemanticMediaPurgeFrontier,
): SemanticMediaPurgeFrontier {
  const contentId = optionalIdentity(frontier, 'contentId');
  const mediaId = optionalIdentity(frontier, 'mediaId');
  return Object.freeze({
    contentIndex: frontier.contentIndex,
    blockIndex: frontier.blockIndex,
    ...(contentId === undefined ? {} : { contentId }),
    ...(mediaId === undefined ? {} : { mediaId }),
  });
}
