/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preserved-head cache-anchor breakpoint for the Anthropic Messages API
 * (#3070 "caching during compression").
 *
 * Anthropic does NOT use implicit prefix matching: a cached prefix is only
 * READ at a position where a `cache_control` breakpoint was previously
 * WRITTEN. Because the compressed head is now byte-stable across successive
 * compressions, spending a third breakpoint at the preserved-head boundary
 * lets the stable head be re-read from cache instead of re-billed at
 * cache-WRITE pricing.
 */

import type {
  AnthropicMessage,
  AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';
import {
  selectLastCacheableBlockIndex,
  sanitizeBlockForCacheControl,
} from './AnthropicRequestBuilder.js';

type AnchorCacheTtl = '5m' | '1h';
type AnchorCacheLogger = { debug: (fn: () => string) => void };

const ANCHOR_CACHE_BLOCK = Symbol('anthropicCacheAnchorBlock');
const ANCHOR_CACHE_STRING = Symbol('anthropicCacheAnchorString');

export function tagAnchorMessage(message: AnthropicMessage): void {
  if (typeof message.content === 'string') {
    if (message.content.trim().length > 0) {
      Reflect.set(message, ANCHOR_CACHE_STRING, true);
    }
    return;
  }
  const blockIndex = selectLastCacheableBlockIndex(message.content);
  if (blockIndex < 0) return;
  Reflect.set(message.content[blockIndex], ANCHOR_CACHE_BLOCK, true);
}

export function materializeAnchorBoundary(
  message: AnthropicMessage,
  blocks: AnthropicMessageBlock[],
): void {
  if (Reflect.get(message, ANCHOR_CACHE_STRING) !== true) return;
  Reflect.deleteProperty(message, ANCHOR_CACHE_STRING);
  const blockIndex = selectLastCacheableBlockIndex(blocks);
  if (blockIndex >= 0) {
    Reflect.set(blocks[blockIndex], ANCHOR_CACHE_BLOCK, true);
  }
}

interface AnchorLocation {
  readonly message: AnthropicMessage;
  readonly blockIndex: number;
}

function takeAnchorLocation(
  messages: readonly AnthropicMessage[],
): AnchorLocation | undefined {
  let found: AnchorLocation | undefined;
  for (const message of messages) {
    const stringAnchor = Reflect.get(message, ANCHOR_CACHE_STRING) === true;
    Reflect.deleteProperty(message, ANCHOR_CACHE_STRING);
    if (typeof message.content === 'string') {
      if (
        found === undefined &&
        stringAnchor &&
        message.content.trim() !== ''
      ) {
        found = { message, blockIndex: 0 };
      }
      continue;
    }
    for (
      let blockIndex = 0;
      blockIndex < message.content.length;
      blockIndex += 1
    ) {
      const block = message.content[blockIndex];
      const anchored = Reflect.get(block, ANCHOR_CACHE_BLOCK) === true;
      Reflect.deleteProperty(block, ANCHOR_CACHE_BLOCK);
      if (found === undefined && anchored) {
        found = { message, blockIndex };
      }
    }
  }
  return found;
}

function hasCacheControlAtBoundary(location: AnchorLocation): boolean {
  return (
    Array.isArray(location.message.content) &&
    'cache_control' in location.message.content[location.blockIndex]
  );
}

function attachCacheBreakpointToMessage(
  location: AnchorLocation,
  ttl: AnchorCacheTtl,
  logger: AnchorCacheLogger,
): void {
  const { message, blockIndex } = location;
  if (typeof message.content === 'string') {
    message.content = [
      sanitizeBlockForCacheControl(
        { type: 'text', text: message.content },
        ttl,
      ),
    ];
    logger.debug(
      () => 'Added anchor cache_control (converted string content to array)',
    );
    return;
  }
  const block = message.content[blockIndex];
  message.content[blockIndex] = sanitizeBlockForCacheControl(block, ttl);
}

export function attachAnchorCacheControl(
  messages: AnthropicMessage[],
  ttl: AnchorCacheTtl,
  logger: AnchorCacheLogger,
): void {
  const location = takeAnchorLocation(messages);
  if (location === undefined || hasCacheControlAtBoundary(location)) return;
  attachCacheBreakpointToMessage(location, ttl, logger);
}
