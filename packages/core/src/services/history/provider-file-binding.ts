/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderFileBindingStore } from '../../runtime/providerRuntimeContext.js';
import type { HistoryService } from './HistoryService.js';
import type { IContent, ProviderFileReferenceMetadata } from './IContent.js';

function hasSameIdentity(
  candidate: ProviderFileReferenceMetadata,
  reference: ProviderFileReferenceMetadata,
): boolean {
  return [
    candidate.provider === reference.provider,
    candidate.baseURL === reference.baseURL,
    candidate.credentialHash === reference.credentialHash,
    candidate.scope === reference.scope,
    candidate.scopeId === reference.scopeId,
  ].every(Boolean);
}

export function bindProviderFileToHistory(
  history: readonly IContent[],
  contentId: string,
  reference: ProviderFileReferenceMetadata,
): IContent[] {
  const retainedReference = Object.freeze({ ...reference });
  const matched = history.some((content) =>
    content.blocks.some(
      (block) =>
        block.type === 'media' &&
        block.encoding === 'reference' &&
        block.contentId === contentId,
    ),
  );
  if (!matched) {
    throw new Error(
      `Cannot bind provider file to missing media content ${contentId}`,
    );
  }
  return history.map((content) => {
    const blocks = content.blocks.map((block) => {
      if (
        block.type !== 'media' ||
        block.encoding !== 'reference' ||
        block.contentId !== contentId
      ) {
        return block;
      }
      const retained = (block.providerFiles ?? []).filter(
        (candidate) => !hasSameIdentity(candidate, retainedReference),
      );
      return {
        ...block,
        providerFiles: Object.freeze([...retained, retainedReference]),
      };
    });
    return blocks.some((block, index) => block !== content.blocks[index])
      ? { ...content, blocks }
      : content;
  });
}

export function unbindProviderFileFromHistory(
  history: readonly IContent[],
  contentId: string,
  reference: ProviderFileReferenceMetadata,
): IContent[] {
  return history.map((content) => {
    const blocks = content.blocks.map((block) => {
      if (
        block.type !== 'media' ||
        block.encoding !== 'reference' ||
        block.contentId !== contentId ||
        block.providerFiles === undefined
      ) {
        return block;
      }
      const retained = block.providerFiles.filter(
        (candidate) =>
          !(
            hasSameIdentity(candidate, reference) &&
            candidate.fileId === reference.fileId
          ),
      );
      return retained.length === block.providerFiles.length
        ? block
        : {
            ...block,
            providerFiles:
              retained.length === 0 ? undefined : Object.freeze(retained),
          };
    });
    return blocks.some((block, index) => block !== content.blocks[index])
      ? { ...content, blocks }
      : content;
  });
}

export function createHistoryProviderFileBindingStore(
  history: HistoryService,
): ProviderFileBindingStore {
  return {
    bind: (contentId, reference) =>
      history.transformAll((contents) =>
        bindProviderFileToHistory(contents, contentId, reference),
      ),
    unbind: (contentId, reference) =>
      history.transformAll((contents) =>
        unbindProviderFileFromHistory(contents, contentId, reference),
      ),
  };
}
