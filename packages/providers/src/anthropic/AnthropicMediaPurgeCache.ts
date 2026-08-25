/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IContent,
  SemanticMediaPurgeCacheWriteEvidence,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AnthropicMessage,
  AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';
import {
  sanitizeBlockForCacheControl,
  selectLastCacheableBlockIndex,
} from './AnthropicRequestBuilder.js';

type MediaPurgeCacheTtl = '5m' | '1h';
type MediaPurgeCacheLogger = { debug: (fn: () => string) => void };

interface MessageBlockLocation {
  readonly messageIndex: number;
  readonly blockIndex: number;
}

interface TaggedBoundary {
  readonly location: MessageBlockLocation;
  readonly boundaryId: object;
}

const MEDIA_PURGE_BOUNDARY_BLOCK = Symbol('anthropicMediaPurgeBoundaryBlock');
const MEDIA_PURGE_BOUNDARY_STRING = Symbol('anthropicMediaPurgeBoundaryString');

export function tagMediaPurgeBoundaryBlock(
  block: AnthropicMessageBlock | undefined,
  boundaryId: object,
): boolean {
  if (block === undefined) return false;
  Reflect.set(block, MEDIA_PURGE_BOUNDARY_BLOCK, boundaryId);
  return true;
}

export function tagMediaPurgeBoundary(
  message: AnthropicMessage | undefined,
  blockIndex: number,
  boundaryId: object,
): boolean {
  if (message === undefined) return false;
  if (typeof message.content === 'string') {
    if (blockIndex !== 0) return false;
    Reflect.set(message, MEDIA_PURGE_BOUNDARY_STRING, boundaryId);
    return true;
  }
  return tagMediaPurgeBoundaryBlock(message.content[blockIndex], boundaryId);
}

export function materializeMediaPurgeBoundary(
  message: AnthropicMessage,
  blocks: AnthropicMessageBlock[],
): void {
  const boundaryId = Reflect.get(message, MEDIA_PURGE_BOUNDARY_STRING);
  Reflect.deleteProperty(message, MEDIA_PURGE_BOUNDARY_STRING);
  if (typeof boundaryId === 'object' && boundaryId !== null) {
    tagMediaPurgeBoundaryBlock(blocks[blocks.length - 1], boundaryId);
  }
}

export function tagWholeMessagePurgeBoundary(
  source: IContent,
  message: AnthropicMessage | undefined,
): void {
  const tag = source.metadata?.semanticMediaPurgeBoundary;
  if (
    tag !== undefined &&
    tag.blockIndex === source.blocks.length - 1 &&
    typeof message?.content === 'string' &&
    message.content.trim().length > 0
  ) {
    tagMediaPurgeBoundary(message, 0, tag.boundaryId);
  }
}

function takeTaggedBlocks(
  message: AnthropicMessage,
  messageIndex: number,
): TaggedBoundary[] {
  if (!Array.isArray(message.content)) return [];
  const tagged: TaggedBoundary[] = [];
  for (
    let blockIndex = 0;
    blockIndex < message.content.length;
    blockIndex += 1
  ) {
    const block = message.content[blockIndex];
    const boundaryId = Reflect.get(block, MEDIA_PURGE_BOUNDARY_BLOCK);
    Reflect.deleteProperty(block, MEDIA_PURGE_BOUNDARY_BLOCK);
    if (typeof boundaryId === 'object' && boundaryId !== null) {
      tagged.push({ location: { messageIndex, blockIndex }, boundaryId });
    }
  }
  return tagged;
}

function takeTaggedBoundary(
  messages: readonly AnthropicMessage[],
): TaggedBoundary | undefined {
  const tagged: TaggedBoundary[] = [];
  for (
    let messageIndex = 0;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const message = messages[messageIndex];
    const stringBoundary = Reflect.get(message, MEDIA_PURGE_BOUNDARY_STRING);
    Reflect.deleteProperty(message, MEDIA_PURGE_BOUNDARY_STRING);
    if (
      typeof message.content === 'string' &&
      typeof stringBoundary === 'object' &&
      stringBoundary !== null
    ) {
      tagged.push({
        location: { messageIndex, blockIndex: 0 },
        boundaryId: stringBoundary,
      });
    } else {
      tagged.push(...takeTaggedBlocks(message, messageIndex));
    }
  }
  return tagged.length === 1 ? tagged[0] : undefined;
}

function findOldestImage(
  messages: readonly AnthropicMessage[],
): MessageBlockLocation | undefined {
  for (
    let messageIndex = 0;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const content = messages[messageIndex]?.content;
    if (!Array.isArray(content)) continue;
    const blockIndex = content.findIndex((block) => block.type === 'image');
    if (blockIndex >= 0) return { messageIndex, blockIndex };
  }
  return undefined;
}

function countMessageBreakpoints(
  messages: readonly AnthropicMessage[],
): number {
  let count = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if ('cache_control' in block) count += 1;
    }
  }
  return count;
}

function findPreviousCacheableBlock(
  messages: readonly AnthropicMessage[],
  image: MessageBlockLocation,
): MessageBlockLocation | undefined {
  const imageContent = messages[image.messageIndex]?.content;
  if (Array.isArray(imageContent) && image.blockIndex > 0) {
    const blockIndex = selectLastCacheableBlockIndex(
      imageContent.slice(0, image.blockIndex),
    );
    if (blockIndex >= 0) {
      return { messageIndex: image.messageIndex, blockIndex };
    }
  }
  for (
    let messageIndex = image.messageIndex - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const content = messages[messageIndex]?.content;
    if (typeof content === 'string') {
      if (content.trim().length > 0) return { messageIndex, blockIndex: 0 };
      continue;
    }
    if (Array.isArray(content)) {
      const blockIndex = selectLastCacheableBlockIndex(content);
      if (blockIndex >= 0) return { messageIndex, blockIndex };
    }
  }
  return undefined;
}

function sameLocation(
  left: MessageBlockLocation,
  right: MessageBlockLocation,
): boolean {
  return (
    left.messageIndex === right.messageIndex &&
    left.blockIndex === right.blockIndex
  );
}

function hasCacheControl(
  messages: readonly AnthropicMessage[],
  location: MessageBlockLocation,
): boolean {
  const content = messages[location.messageIndex]?.content;
  return (
    Array.isArray(content) &&
    location.blockIndex >= 0 &&
    location.blockIndex < content.length &&
    'cache_control' in content[location.blockIndex]
  );
}

function attachAtLocation(
  messages: AnthropicMessage[],
  location: MessageBlockLocation,
  ttl: MediaPurgeCacheTtl,
): void {
  const message = messages[location.messageIndex];
  if (typeof message.content === 'string') {
    message.content = [
      sanitizeBlockForCacheControl(
        { type: 'text', text: message.content },
        ttl,
      ),
    ];
    return;
  }
  const block = message.content[location.blockIndex];
  message.content[location.blockIndex] = sanitizeBlockForCacheControl(
    block,
    ttl,
  );
}

export function clearMediaPurgeBoundaryTags(
  messages: readonly AnthropicMessage[],
): void {
  for (const message of messages) {
    Reflect.deleteProperty(message, MEDIA_PURGE_BOUNDARY_STRING);
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      Reflect.deleteProperty(block, MEDIA_PURGE_BOUNDARY_BLOCK);
    }
  }
}

export function attachMediaPurgeCacheControl(
  messages: AnthropicMessage[],
  ttl: MediaPurgeCacheTtl,
  logger: MediaPurgeCacheLogger,
): SemanticMediaPurgeCacheWriteEvidence | undefined {
  const tagged = takeTaggedBoundary(messages);
  const image = findOldestImage(messages);
  if (tagged === undefined || image === undefined) return undefined;
  const expected = findPreviousCacheableBlock(messages, image);
  if (expected === undefined || !sameLocation(tagged.location, expected)) {
    logger.debug(
      () =>
        'Skipped media purge cache_control: tagged boundary did not match the exact pre-image prefix',
    );
    return undefined;
  }
  if (hasCacheControl(messages, tagged.location)) {
    return { boundaryId: tagged.boundaryId, preparation: 'reused' };
  }
  if (countMessageBreakpoints(messages) >= 3) {
    logger.debug(
      () =>
        'Skipped media purge cache_control: all message breakpoint slots are in use',
    );
    return undefined;
  }

  attachAtLocation(messages, tagged.location, ttl);
  logger.debug(
    () =>
      `Added media purge cache_control at exact boundary message ${tagged.location.messageIndex}, block ${tagged.location.blockIndex}`,
  );
  return { boundaryId: tagged.boundaryId, preparation: 'added' };
}
