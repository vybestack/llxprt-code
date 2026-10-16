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

function hasMedia(content: IContent, contentId: string): boolean {
  return content.blocks.some(
    (block) =>
      block.type === 'media' &&
      block.encoding === 'reference' &&
      block.contentId === contentId,
  );
}

function bindRow(
  content: IContent,
  contentId: string,
  reference: ProviderFileReferenceMetadata,
): IContent {
  const blocks = content.blocks.map((block) => {
    if (
      block.type !== 'media' ||
      block.encoding !== 'reference' ||
      block.contentId !== contentId
    )
      return block;
    const retained = (block.providerFiles ?? []).filter(
      (candidate) => !hasSameIdentity(candidate, reference),
    );
    return { ...block, providerFiles: Object.freeze([...retained, reference]) };
  });
  return blocks.some((block, index) => block !== content.blocks[index])
    ? { ...content, blocks }
    : content;
}

function unbindRow(
  content: IContent,
  contentId: string,
  reference: ProviderFileReferenceMetadata,
): IContent {
  const blocks = content.blocks.map((block) => {
    if (
      block.type !== 'media' ||
      block.encoding !== 'reference' ||
      block.contentId !== contentId ||
      block.providerFiles === undefined
    )
      return block;
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
}

export function createHistoryProviderFileBindingStore(
  history: HistoryService,
): ProviderFileBindingStore {
  return {
    bind: (contentId, reference) => {
      const retainedReference = Object.freeze({ ...reference });
      return history.detachedValues.transform(async (source, sink) => {
        let matched = false;
        // Validation precedes candidate serialization, as in the array contract.
        for await (const row of source.streamRows()) {
          if (hasMedia(row, contentId)) {
            matched = true;
            break;
          }
        }
        if (!matched)
          throw new Error(
            `Cannot bind provider file to missing media content ${contentId}`,
          );
        for await (const row of source.streamRows())
          sink.appendValue(bindRow(row, contentId, retainedReference));
      });
    },
    unbind: (contentId, reference) => {
      const retainedReference = Object.freeze({ ...reference });
      return history.detachedValues.transform(async (source, sink) => {
        for await (const row of source.streamRows())
          sink.appendValue(unbindRow(row, contentId, retainedReference));
      });
    },
  };
}
