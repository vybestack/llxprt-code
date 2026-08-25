/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from './HistoryService.js';
import type { ContentBlock, IContent } from './IContent.js';
import { deepCloneWithoutCircularRefs } from './historyCloneUtils.js';

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

export interface SemanticMediaPurgeConfiguration {
  readonly enabled?: boolean;
  readonly explicitCacheWriteRequired: boolean;
  readonly persist?: (
    candidateHistory: readonly IContent[],
    frontier: SemanticMediaPurgeFrontier,
  ) => Promise<void>;
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

export class SemanticMediaPurgeTransaction {
  readonly candidateHistory: readonly IContent[];
  readonly preImageBoundary: SemanticMediaPurgeBoundary | undefined;
  readonly preImageBoundaryIdentity:
    | SemanticMediaPurgeBoundaryIdentity
    | undefined;
  readonly changedContentIndex: number;
  readonly changedBlockIndex: number;
  readonly nextFrontier: SemanticMediaPurgeFrontier;
  readonly baseHistory: readonly IContent[];
  readonly owner: object;

  constructor(input: {
    candidateHistory: readonly IContent[];
    preImageBoundary: SemanticMediaPurgeBoundary | undefined;
    changedContentIndex: number;
    changedBlockIndex: number;
    nextFrontier: SemanticMediaPurgeFrontier;
    baseHistory: readonly IContent[];
    owner: object;
  }) {
    this.candidateHistory = input.candidateHistory;
    this.preImageBoundary = input.preImageBoundary;
    this.preImageBoundaryIdentity =
      input.preImageBoundary === undefined
        ? undefined
        : new SemanticMediaPurgeBoundaryIdentity(input.preImageBoundary);
    this.changedContentIndex = input.changedContentIndex;
    this.changedBlockIndex = input.changedBlockIndex;
    this.nextFrontier = input.nextFrontier;
    this.baseHistory = input.baseHistory;
    this.owner = input.owner;
  }
}

class SemanticMediaPurgePrecommitError extends Error {
  constructor(readonly failure: unknown) {
    super('Semantic media purge failed before durable state changed');
  }
}

const MIME_TYPE_PATTERN =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function isPurgeableImage(
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

function hasSummaryReplacement(
  block: ContentBlock,
  options: SemanticMediaPurgeOptions,
): boolean {
  if (options.mode !== 'summary' || options.summaryText !== undefined)
    return true;
  if (block.type !== 'media' || block.caption === undefined) return false;
  return block.caption.trim().length > 0;
}

function findCandidate(
  history: readonly IContent[],
  frontier: SemanticMediaPurgeFrontier,
  options: SemanticMediaPurgeOptions = { mode: 'remove' },
): SemanticMediaPurgeBoundary | undefined {
  for (const [contentIndex, content] of history.entries()) {
    if (contentIndex < frontier.contentIndex) continue;
    const firstBlock =
      contentIndex === frontier.contentIndex ? frontier.blockIndex : 0;
    for (const [blockIndex, block] of content.blocks.entries()) {
      if (blockIndex < firstBlock) continue;
      const location = { contentIndex, blockIndex };
      if (
        isPurgeableImage(block, location) &&
        hasSummaryReplacement(block, options)
      ) {
        return location;
      }
    }
  }
  return undefined;
}

function findPreImageBoundary(
  history: readonly IContent[],
  location: SemanticMediaPurgeBoundary,
): SemanticMediaPurgeBoundary | undefined {
  if (location.blockIndex > 0) {
    return {
      contentIndex: location.contentIndex,
      blockIndex: location.blockIndex - 1,
    };
  }
  for (
    let contentIndex = location.contentIndex - 1;
    contentIndex >= 0;
    contentIndex -= 1
  ) {
    const content = history[contentIndex];
    if (content.blocks.length > 0) {
      return {
        contentIndex,
        blockIndex: content.blocks.length - 1,
      };
    }
  }
  return undefined;
}

function replacementBlock(
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

function invalidateSuffixState(
  history: readonly IContent[],
  changedContentIndex: number,
): readonly IContent[] {
  return history.map((entry, index) => {
    if (
      index < changedContentIndex ||
      entry.speaker !== 'ai' ||
      entry.metadata?.responsesStored !== true
    ) {
      return entry;
    }
    const metadata = { ...entry.metadata };
    delete metadata.responsesStored;
    return { ...entry, metadata };
  });
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  Object.freeze(value);
}

function persistFrontierInHistory(
  history: readonly IContent[],
  frontier: SemanticMediaPurgeFrontier,
): readonly IContent[] {
  if (history.length === 0) return history;
  const first = history[0];
  return [
    {
      ...first,
      metadata: {
        ...first.metadata,
        semanticMediaPurgeFrontier: frontier,
      },
    },
    ...history.slice(1),
  ];
}

function isValidFrontierCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function optionalIdentity(
  frontier: SemanticMediaPurgeFrontier,
  property: 'contentId' | 'mediaId',
): string | undefined {
  const value: unknown = Reflect.get(frontier, property);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function restoredFrontierValue(
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

function restoredFrontier(
  history: readonly IContent[],
): SemanticMediaPurgeFrontier {
  for (const content of history) {
    const frontier = content.metadata?.semanticMediaPurgeFrontier;
    if (
      frontier !== undefined &&
      isValidFrontierCoordinate(frontier.contentIndex) &&
      isValidFrontierCoordinate(frontier.blockIndex)
    ) {
      return restoredFrontierValue(frontier);
    }
  }
  return Object.freeze({ contentIndex: 0, blockIndex: 0 });
}

function nextValidFrontier(
  history: readonly IContent[],
  location: SemanticMediaPurgeBoundary,
  contentRemoved: boolean,
): SemanticMediaPurgeFrontier {
  if (history.length === 0) {
    return Object.freeze({ contentIndex: 0, blockIndex: 0 });
  }
  const contentIndex = Math.min(location.contentIndex, history.length - 1);
  const content = history[contentIndex];
  if (content.blocks.length === 0) {
    throw new Error('Semantic media purge produced invalid history');
  }
  let blockIndex = Math.min(location.blockIndex, content.blocks.length - 1);
  if (contentRemoved) {
    blockIndex =
      contentIndex === location.contentIndex ? 0 : content.blocks.length - 1;
  }
  return Object.freeze({ contentIndex, blockIndex });
}

function mediaIdentity(block: ContentBlock): string | undefined {
  if (block.type !== 'media') return undefined;
  if (block.encoding === 'reference') return block.contentId;
  return block.sourceContentId;
}

function stableFrontier(
  history: readonly IContent[],
  positional: SemanticMediaPurgeFrontier,
): SemanticMediaPurgeFrontier {
  const candidate = findCandidate(history, positional);
  if (candidate === undefined) return positional;
  const content = history.find(
    (_entry, index) => index === candidate.contentIndex,
  );
  const block = content?.blocks.find(
    (_entry, index) => index === candidate.blockIndex,
  );
  if (content === undefined || block === undefined) {
    throw new Error('Semantic media purge produced an invalid stable frontier');
  }
  const contentId = content.metadata?.id;
  const mediaId = mediaIdentity(block);
  return Object.freeze({
    contentIndex: candidate.contentIndex,
    blockIndex: candidate.blockIndex,
    ...(contentId === undefined || contentId.length === 0 ? {} : { contentId }),
    ...(mediaId === undefined || mediaId.length === 0 ? {} : { mediaId }),
  });
}

function matchingImageBlockIndex(
  content: IContent,
  contentIndex: number,
  expectedMediaId: string | undefined,
): number | undefined {
  for (const [blockIndex, block] of content.blocks.entries()) {
    const mediaMatches =
      expectedMediaId === undefined || mediaIdentity(block) === expectedMediaId;
    if (mediaMatches && isPurgeableImage(block, { contentIndex, blockIndex })) {
      return blockIndex;
    }
  }
  return undefined;
}

function identityCandidate(
  history: readonly IContent[],
  frontier: SemanticMediaPurgeFrontier,
): SemanticMediaPurgeBoundary | undefined {
  const expectedContentId = frontier.contentId;
  for (const [contentIndex, content] of history.entries()) {
    const contentMatches =
      expectedContentId === undefined ||
      content.metadata?.id === expectedContentId;
    if (!contentMatches) continue;
    const blockIndex = matchingImageBlockIndex(
      content,
      contentIndex,
      frontier.mediaId,
    );
    if (blockIndex !== undefined) return { contentIndex, blockIndex };
  }
  return undefined;
}

function rebasedFrontier(
  history: readonly IContent[],
  frontier: SemanticMediaPurgeFrontier,
): SemanticMediaPurgeFrontier {
  if (frontier.contentId === undefined && frontier.mediaId === undefined) {
    return frontier;
  }
  const candidate = identityCandidate(history, frontier);
  if (candidate !== undefined) return candidate;
  return Object.freeze({ contentIndex: 0, blockIndex: 0 });
}

function buildCandidateHistory(
  history: readonly IContent[],
  location: SemanticMediaPurgeBoundary,
  options: SemanticMediaPurgeOptions,
): {
  readonly history: readonly IContent[];
  readonly nextFrontier: SemanticMediaPurgeFrontier;
} {
  const clonedHistory = deepCloneWithoutCircularRefs([...history]);
  const sourceContent = clonedHistory.find(
    (_entry, index) => index === location.contentIndex,
  );
  const sourceBlock = sourceContent?.blocks.find(
    (_entry, index) => index === location.blockIndex,
  );
  if (sourceContent === undefined || sourceBlock === undefined) {
    throw new Error('Semantic media purge candidate no longer exists');
  }
  const replacement = replacementBlock(options, sourceBlock);
  const blocks = sourceContent.blocks.flatMap((block, index) => {
    if (index !== location.blockIndex) {
      return [block];
    }
    return replacement === undefined ? [] : [replacement];
  });
  const contentRemoved = blocks.length === 0;
  const changedHistory = clonedHistory.flatMap((entry, index) => {
    if (index !== location.contentIndex) {
      return [entry];
    }
    return contentRemoved ? [] : [{ ...entry, blocks: [...blocks] }];
  });
  const nextFrontier = stableFrontier(
    changedHistory,
    nextValidFrontier(changedHistory, location, contentRemoved),
  );
  const candidateHistory = [
    ...persistFrontierInHistory(
      invalidateSuffixState(changedHistory, location.contentIndex),
      nextFrontier,
    ),
  ];
  deepFreeze(candidateHistory);
  return {
    history: candidateHistory,
    nextFrontier,
  };
}

function historiesMatchByIdentity(
  current: readonly IContent[],
  expected: readonly IContent[],
): boolean {
  return (
    current.length === expected.length &&
    current.every((entry, index) => entry === expected[index])
  );
}

export class SemanticMediaPurgeCoordinator {
  private readonly owner = Object.freeze({});
  private currentFrontier: SemanticMediaPurgeFrontier = Object.freeze({
    contentIndex: 0,
    blockIndex: 0,
  });

  constructor(
    private readonly history: HistoryService,
    private readonly configuration: SemanticMediaPurgeConfiguration,
  ) {
    this.currentFrontier = restoredFrontier(history.getAll());
  }

  get frontier(): SemanticMediaPurgeFrontier {
    return this.currentFrontier;
  }

  refresh(): void {
    this.currentFrontier = restoredFrontier(this.history.getAll());
  }

  begin(
    options: SemanticMediaPurgeOptions,
  ): SemanticMediaPurgeTransaction | undefined {
    if (this.configuration.enabled !== true) {
      return undefined;
    }
    this.refresh();
    const baseHistory = Object.freeze(this.history.getAll());
    const location = findCandidate(
      baseHistory,
      rebasedFrontier(baseHistory, this.currentFrontier),
      options,
    );
    if (location === undefined) {
      return undefined;
    }
    const candidate = buildCandidateHistory(baseHistory, location, options);
    return new SemanticMediaPurgeTransaction({
      candidateHistory: candidate.history,
      preImageBoundary: findPreImageBoundary(baseHistory, location),
      changedContentIndex: location.contentIndex,
      changedBlockIndex: location.blockIndex,
      nextFrontier: candidate.nextFrontier,
      baseHistory,
      owner: this.owner,
    });
  }

  async commit(
    transaction: SemanticMediaPurgeTransaction,
    outcome: SemanticMediaPurgeOutcome,
  ): Promise<boolean> {
    if (transaction.owner !== this.owner) {
      throw new Error(
        'Semantic media purge transaction belongs to another coordinator',
      );
    }
    if (
      outcome.status !== 'success' ||
      (this.configuration.explicitCacheWriteRequired &&
        !outcome.cachePrefixWritten)
    ) {
      return false;
    }
    try {
      await this.history.transformAll(async (latestHistory) => {
        if (!historiesMatchByIdentity(latestHistory, transaction.baseHistory)) {
          throw new SemanticMediaPurgePrecommitError(
            new Error('History changed while semantic media purge was pending'),
          );
        }
        try {
          await this.configuration.persist?.(
            transaction.candidateHistory,
            transaction.nextFrontier,
          );
        } catch (persistenceError: unknown) {
          throw new SemanticMediaPurgePrecommitError(persistenceError);
        }
        return [...transaction.candidateHistory];
      });
    } catch (replacementError: unknown) {
      if (replacementError instanceof SemanticMediaPurgePrecommitError) {
        throw replacementError.failure;
      }
      try {
        await this.configuration.persist?.(
          transaction.baseHistory,
          this.currentFrontier,
        );
      } catch (compensationError: unknown) {
        throw new AggregateError(
          [replacementError, compensationError],
          'Semantic media purge failed to replace history and restore durable state',
        );
      }
      throw replacementError;
    }
    this.currentFrontier = transaction.nextFrontier;
    return true;
  }

  async rollback(transaction: SemanticMediaPurgeTransaction): Promise<void> {
    if (transaction.owner !== this.owner) {
      throw new Error(
        'Semantic media purge transaction belongs to another coordinator',
      );
    }
    const restored = restoredFrontier(transaction.baseHistory);
    try {
      await this.history.transformAll(async (latestHistory) => {
        if (
          !historiesMatchByIdentity(latestHistory, transaction.candidateHistory)
        ) {
          throw new SemanticMediaPurgePrecommitError(
            new Error(
              'History changed while semantic media purge rollback was pending',
            ),
          );
        }
        try {
          await this.configuration.persist?.(transaction.baseHistory, restored);
        } catch (persistenceError: unknown) {
          throw new SemanticMediaPurgePrecommitError(persistenceError);
        }
        return [...transaction.baseHistory];
      });
    } catch (replacementError: unknown) {
      if (replacementError instanceof SemanticMediaPurgePrecommitError) {
        throw replacementError.failure;
      }
      try {
        await this.configuration.persist?.(
          transaction.candidateHistory,
          transaction.nextFrontier,
        );
      } catch (compensationError: unknown) {
        throw new AggregateError(
          [replacementError, compensationError],
          'Semantic media purge failed to roll back history and restore durable state',
        );
      }
      throw replacementError;
    }
    this.currentFrontier = restored;
  }
}
