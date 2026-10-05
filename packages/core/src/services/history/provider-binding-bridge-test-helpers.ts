/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  MediaReferenceBlock,
  ProviderFileReferenceMetadata,
} from './IContent.js';
import { detachedRow } from './detached-rollback-test-helpers.js';
import type { HistoryService } from './HistoryService.js';

export const bindingContentId =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const bindingFile: ProviderFileReferenceMetadata = {
  provider: 'kimi',
  baseURL: 'https://api.moonshot.ai/v1',
  credentialHash: 'binding-test',
  fileId: 'provider-binding-bridge',
  byteLength: 3,
  scope: 'session',
  scopeId: 'binding',
  createdAt: 1,
  expiresAt: 1000,
  deletion: 'delete',
  zeroDataRetention: 'incompatible-while-retained',
  deletionState: 'active',
};
export function bindingReference(): MediaReferenceBlock {
  const object = {
    contentId: bindingContentId,
    mimeType: 'application/pdf',
    byteLength: 3,
    normalizedBase64Length: 4,
  };
  return {
    type: 'media',
    encoding: 'reference',
    mimeType: object.mimeType,
    contentId: bindingContentId,
    originalContentId: bindingContentId,
    selectedContentId: bindingContentId,
    originalObject: object,
    selectedObject: object,
    transformation: { policyId: 'identity', policyVersion: 1, parameters: {} },
    byteLength: 3,
    normalizedBase64Length: 4,
    semanticMetadata: {},
    caption: 'binding reference',
  };
}
export function bindingBridgeRow(index: number, bytes = 2048): IContent {
  const row = detachedRow(index, bytes);
  return index === 0
    ? {
        ...row,
        blocks: row.blocks.map((block) =>
          block.type === 'media' ? bindingReference() : block,
        ),
      }
    : row;
}
export function expectedBoundRow(row: IContent): IContent {
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'media' &&
      block.encoding === 'reference' &&
      block.contentId === bindingContentId
        ? { ...block, providerFiles: [bindingFile] }
        : block,
    ),
  };
}
export async function* bindingBridgeRows(
  size: number,
  bytes = 2048,
  bound = false,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) {
    const row = bindingBridgeRow(index, bytes);
    yield bound ? expectedBoundRow(row) : row;
  }
}
export function forbidLegacyBindingTransform(history: HistoryService): void {
  history.transformRows = async (): Promise<never> => {
    throw new Error('Binding entered the identity-capable rollback engine');
  };
}
