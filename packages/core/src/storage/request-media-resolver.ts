/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  isMediaReferenceBlock,
  type IContent,
  type InlineMediaBlock,
  type MediaReferenceBlock,
} from '../services/history/IContent.js';
import type { LocalMediaStore } from './local-media-store.js';
import { DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES } from '../config/configTypes.js';

export const DEFAULT_REQUEST_MEDIA_BUDGET_BYTES =
  DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES;

export interface RequestMediaResolutionInput {
  readonly contents: readonly IContent[];
  readonly requestId: string;
  readonly turnId: string;
  readonly aggregateBudgetBytes: number;
  readonly signal?: AbortSignal;
}

export interface RequestMediaAccounting {
  readonly selectedReferenceCount: number;
  readonly uniqueContentCount: number;
  readonly selectedNormalizedBytes: number;
  readonly materializedNormalizedBytes: number;
  readonly storeReadCount: number;
  readonly reservedContentCount: number;
  readonly released: boolean;
}

export interface RequestMediaResolverAccounting {
  readonly activeRequestCount: number;
  readonly reservedContentCount: number;
  readonly materializedNormalizedBytes: number;
  readonly storeReadCount: number;
}

export interface PendingMediaReleaseRecovery {
  readonly attempted: number;
  readonly recovered: number;
  readonly remaining: number;
}

export interface ResolvedMediaRequest {
  withContents<T>(consume: (contents: IContent[]) => T): T;
  registerCleanup(cleanup: () => void | Promise<void>): void;
  accounting(): RequestMediaAccounting;
  release(): Promise<void>;
}

export interface RequestMediaResolutionService {
  resolve(input: RequestMediaResolutionInput): Promise<ResolvedMediaRequest>;
}

interface SelectedReference {
  readonly reference: MediaReferenceBlock;
  readonly turnId: string;
}

export class RequestMediaResolutionError extends Error {
  constructor(
    readonly contentId: string,
    readonly turnId: string,
    operation: string,
    options?: ErrorOptions,
  ) {
    super(
      `Media request ${operation} failed for content ${contentId} in turn ${turnId}`,
      options,
    );
    this.name = 'RequestMediaResolutionError';
  }
}

function abortError(): Error {
  const error = new Error('Media request resolution was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError();
}

function validateBudget(budget: number): void {
  if (!Number.isSafeInteger(budget) || budget < 0) {
    throw new Error(
      'Aggregate request media budget must be a non-negative safe integer',
    );
  }
}

function contentTurnId(content: IContent, fallbackTurnId: string): string {
  return (
    content.metadata?.turnId ??
    content.metadata?.id ??
    (content.metadata?.chronology === undefined
      ? fallbackTurnId
      : `chronology:${content.metadata.chronology.seq}`)
  );
}

function selectReferences(
  input: RequestMediaResolutionInput,
): readonly SelectedReference[] {
  const selected: SelectedReference[] = [];
  for (const content of input.contents) {
    const turnId = contentTurnId(content, input.turnId);
    for (const block of content.blocks) {
      if (block.type !== 'media' || block.encoding !== 'reference') continue;
      const candidate: unknown = block;
      if (!isMediaReferenceBlock(candidate)) {
        throw new RequestMediaResolutionError(
          block.contentId,
          turnId,
          'metadata validation',
        );
      }
      selected.push({ reference: candidate, turnId });
    }
  }
  return selected;
}

function selectedNormalizedBytes(input: RequestMediaResolutionInput): number {
  let total = 0;
  for (const content of input.contents) {
    const turnId = contentTurnId(content, input.turnId);
    for (const block of content.blocks) {
      if (block.type !== 'media' || block.encoding === 'url') continue;
      const normalizedLength =
        block.encoding === 'reference'
          ? block.normalizedBase64Length
          : block.data.length;
      const nextTotal = total + normalizedLength;
      if (
        !Number.isSafeInteger(nextTotal) ||
        nextTotal > input.aggregateBudgetBytes
      ) {
        throw new RequestMediaResolutionError(
          block.encoding === 'reference' ? block.contentId : 'inline-media',
          turnId,
          `aggregate budget (${nextTotal} > ${input.aggregateBudgetBytes})`,
        );
      }
      total = nextTotal;
    }
  }
  return total;
}

export function assertRequestMediaBudget(
  contents: readonly IContent[],
  turnId: string,
  aggregateBudgetBytes: number,
): void {
  validateBudget(aggregateBudgetBytes);
  selectedNormalizedBytes({
    contents,
    requestId: 'request-media-budget-validation',
    turnId,
    aggregateBudgetBytes,
  });
}

function inlineBlock(
  reference: MediaReferenceBlock,
  data: string,
): InlineMediaBlock {
  const block: InlineMediaBlock = {
    type: 'media',
    encoding: 'base64',
    data,
    mimeType: reference.mimeType,
    ...(reference.caption === undefined ? {} : { caption: reference.caption }),
    ...(reference.filename === undefined
      ? {}
      : { filename: reference.filename }),
    ...(reference.providerMetadata === undefined
      ? {}
      : { providerMetadata: reference.providerMetadata }),
    ...(reference.dimensions === undefined
      ? {}
      : { dimensions: reference.dimensions }),
    semanticMetadata: reference.semanticMetadata,
    ...(reference.providerFileIds === undefined
      ? {}
      : { providerFileIds: reference.providerFileIds }),
    ...(reference.providerFiles === undefined
      ? {}
      : { providerFiles: reference.providerFiles }),
  };
  Object.defineProperty(block, 'sourceContentId', {
    value: reference.contentId,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return block;
}

function materializeContents(
  contents: readonly IContent[],
  encodedByContentId: ReadonlyMap<string, string>,
): IContent[] {
  return contents.map((content) => {
    const blocks = content.blocks.map((block) => {
      if (block.type !== 'media' || block.encoding !== 'reference')
        return block;
      const data = encodedByContentId.get(block.contentId);
      if (data === undefined) {
        throw new RequestMediaResolutionError(
          block.contentId,
          contentTurnId(content, 'unknown'),
          'materialization',
        );
      }
      return inlineBlock(block, data);
    });
    const changed = blocks.some(
      (block, index) => block !== content.blocks[index],
    );
    return changed ? { ...content, blocks } : content;
  });
}

interface RequestResolutionResources {
  readonly ownerId: string;
  readonly reservedContentIds: string[];
  readonly encodedByContentId: Map<string, string>;
  readonly registeredCleanups: Array<() => void | Promise<void>>;
  resolvedContents: IContent[];
  materializedBytes: number;
  readCount: number;
  disposed: boolean;
  released: boolean;
  releasePromise: Promise<void> | undefined;
}

function uniqueReferencesByContentId(
  selected: readonly SelectedReference[],
): ReadonlyMap<string, SelectedReference> {
  const unique = new Map<string, SelectedReference>();
  for (const entry of selected) {
    if (!unique.has(entry.reference.contentId)) {
      unique.set(entry.reference.contentId, entry);
    }
  }
  return unique;
}

export class RequestMediaResolver {
  private activeRequestCount = 0;
  private reservedContentCount = 0;
  private materializedNormalizedBytes = 0;
  private storeReadCount = 0;
  private readonly pendingReleases = new Set<RequestResolutionResources>();

  constructor(private readonly store: LocalMediaStore) {}

  accounting(): RequestMediaResolverAccounting {
    return {
      activeRequestCount: this.activeRequestCount,
      reservedContentCount: this.reservedContentCount,
      materializedNormalizedBytes: this.materializedNormalizedBytes,
      storeReadCount: this.storeReadCount,
    };
  }

  pendingReleaseCount(): number {
    return this.pendingReleases.size;
  }

  async recoverPendingReleases(): Promise<PendingMediaReleaseRecovery> {
    const pending = [...this.pendingReleases];
    const failures: unknown[] = [];
    let recovered = 0;
    for (const resources of pending) {
      try {
        await this.release(resources);
        recovered += 1;
      } catch (error) {
        failures.push(error);
      }
    }
    const result = {
      attempted: pending.length,
      recovered,
      remaining: this.pendingReleases.size,
    };
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Pending media release recovery failed',
        {
          cause: result,
        },
      );
    }
    return result;
  }

  private async dispose(resources: RequestResolutionResources): Promise<void> {
    const failures: unknown[] = [];
    if (!resources.disposed) {
      resources.disposed = true;
      for (
        let index = resources.registeredCleanups.length - 1;
        index >= 0;
        index -= 1
      ) {
        try {
          await resources.registeredCleanups[index]();
        } catch (error) {
          failures.push(error);
        }
      }
      resources.registeredCleanups.splice(0);
      resources.resolvedContents.splice(0);
      resources.encodedByContentId.clear();
      this.materializedNormalizedBytes -= resources.materializedBytes;
      resources.materializedBytes = 0;
    }
    let releasedReservationCount = 0;
    for (
      let index = resources.reservedContentIds.length - 1;
      index >= 0;
      index -= 1
    ) {
      try {
        await this.store.release(
          resources.reservedContentIds[index],
          resources.ownerId,
        );
        resources.reservedContentIds.splice(index, 1);
        releasedReservationCount += 1;
      } catch (error) {
        failures.push(error);
      }
    }
    this.reservedContentCount -= releasedReservationCount;
    if (resources.reservedContentIds.length === 0) {
      this.activeRequestCount -= 1;
      resources.released = true;
      this.pendingReleases.delete(resources);
    } else {
      this.pendingReleases.add(resources);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to release media request');
    }
  }

  private release(resources: RequestResolutionResources): Promise<void> {
    if (resources.released) return Promise.resolve();
    resources.releasePromise ??= this.dispose(resources).finally(() => {
      if (!resources.released) resources.releasePromise = undefined;
    });
    return resources.releasePromise;
  }

  private async materializeReferences(
    input: RequestMediaResolutionInput,
    unique: ReadonlyMap<string, SelectedReference>,
    resources: RequestResolutionResources,
  ): Promise<void> {
    for (const entry of unique.values()) {
      throwIfAborted(input.signal);
      this.storeReadCount += 1;
      resources.readCount += 1;
      let bytes: Uint8Array;
      try {
        bytes = await this.store.reserveAndReadVerified(
          entry.reference,
          resources.ownerId,
        );
      } catch (error) {
        throw new RequestMediaResolutionError(
          entry.reference.contentId,
          entry.turnId,
          'blob verification',
          { cause: error },
        );
      }
      resources.reservedContentIds.push(entry.reference.contentId);
      this.reservedContentCount += 1;
      throwIfAborted(input.signal);
      const encoded = Buffer.from(bytes).toString('base64');
      if (encoded.length !== entry.reference.normalizedBase64Length) {
        throw new RequestMediaResolutionError(
          entry.reference.contentId,
          entry.turnId,
          'normalized size verification',
        );
      }
      resources.encodedByContentId.set(entry.reference.contentId, encoded);
      resources.materializedBytes += encoded.length;
      this.materializedNormalizedBytes += encoded.length;
    }
  }

  private resolvedRequest(
    selectedReferenceCount: number,
    uniqueContentCount: number,
    selectedBytes: number,
    resources: RequestResolutionResources,
  ): ResolvedMediaRequest {
    return {
      withContents: <T>(consume: (contents: IContent[]) => T): T => {
        if (resources.disposed) {
          throw new Error(
            'Cannot consume media request contents after release',
          );
        }
        return consume(resources.resolvedContents);
      },
      registerCleanup: (cleanup: () => void | Promise<void>): void => {
        if (resources.disposed) {
          throw new Error(
            'Cannot register materialized request cleanup after disposal',
          );
        }
        resources.registeredCleanups.push(cleanup);
      },
      accounting: (): RequestMediaAccounting => ({
        selectedReferenceCount,
        uniqueContentCount,
        selectedNormalizedBytes: selectedBytes,
        materializedNormalizedBytes: resources.materializedBytes,
        storeReadCount: resources.readCount,
        reservedContentCount: resources.reservedContentIds.length,
        released: resources.released,
      }),
      release: () => this.release(resources),
    };
  }

  async resolve(
    input: RequestMediaResolutionInput,
  ): Promise<ResolvedMediaRequest> {
    validateBudget(input.aggregateBudgetBytes);
    throwIfAborted(input.signal);
    const selected = selectReferences(input);
    const selectedBytes = selectedNormalizedBytes(input);
    throwIfAborted(input.signal);
    const unique = uniqueReferencesByContentId(selected);
    const resources: RequestResolutionResources = {
      ownerId: `${input.requestId}:${randomUUID()}`,
      reservedContentIds: [],
      encodedByContentId: new Map(),
      registeredCleanups: [],
      resolvedContents: [],
      materializedBytes: 0,
      readCount: 0,
      disposed: false,
      released: false,
      releasePromise: undefined,
    };
    this.activeRequestCount += 1;
    try {
      await this.materializeReferences(input, unique, resources);
      resources.resolvedContents = materializeContents(
        input.contents,
        resources.encodedByContentId,
      );
      return this.resolvedRequest(
        selected.length,
        unique.size,
        selectedBytes,
        resources,
      );
    } catch (error) {
      try {
        await this.release(resources);
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          'Media request resolution and cleanup failed',
        );
      }
      throw error;
    }
  }
}
