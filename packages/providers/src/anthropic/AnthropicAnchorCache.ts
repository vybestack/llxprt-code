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
 *
 * `convertToAnthropicMessages` is NOT index-preserving — filtering, merging,
 * thinking-strip, validation, adjacency and empty-block transforms all rebuild
 * message objects — so the anchor breakpoint cannot be located by arithmetic
 * on a content index. Instead the converter tags the message derived from the
 * anchored IContent with the module-private {@link ANCHOR_CACHE_SYMBOL} via
 * {@link tagAnchorMessage}; after the full pipeline {@link attachAnchorCacheControl}
 * locates it by identity and attaches the breakpoint.
 *
 * A Symbol-keyed property is invisible to `JSON.stringify`, so it cannot leak
 * onto the wire; {@link attachAnchorCacheControl} deletes it explicitly
 * regardless.
 */

import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
import {
  selectLastCacheableBlockIndex,
  sanitizeBlockForCacheControl,
} from './AnthropicRequestBuilder.js';

type AnchorCacheTtl = '5m' | '1h';

type AnchorCacheLogger = { debug: (fn: () => string) => void };

/**
 * Module-private marker stamped on the AnthropicMessage derived from the
 * IContent carrying `metadata.cacheAnchor`. Never exported, so no consumer
 * outside this module can read or set it.
 */
const ANCHOR_CACHE_SYMBOL = Symbol('anthropicCacheAnchor');

/**
 * Stamp the anchor marker on `message`. Called by the converter for the
 * message produced from the anchored IContent (human, assistant, or the flush
 * carrying an anchored tool result).
 */
export function tagAnchorMessage(message: AnthropicMessage): void {
  Reflect.set(message, ANCHOR_CACHE_SYMBOL, true);
}

/**
 * Attach a `cache_control` breakpoint to a single message's last non-thinking,
 * non-empty content block. Reuses the shared {@link selectLastCacheableBlockIndex}
 * block-selection and {@link sanitizeBlockForCacheControl} sanitization so the
 * anchor breakpoint and the rolling-tail breakpoint pick identical block kinds.
 */
function attachCacheBreakpointToMessage(
  message: AnthropicMessage,
  ttl: AnchorCacheTtl,
  logger: AnchorCacheLogger,
): void {
  if (typeof message.content === 'string') {
    if (message.content.trim() === '') {
      logger.debug(
        () =>
          'Skipped anchor cache_control: anchor message has no cacheable text',
      );
      return;
    }
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
  if (Array.isArray(message.content)) {
    const content = message.content;
    const idx = selectLastCacheableBlockIndex(content);
    if (idx < 0) {
      logger.debug(
        () =>
          'Skipped anchor cache_control: anchor message has no cacheable block',
      );
      return;
    }
    content[idx] = sanitizeBlockForCacheControl(content[idx], ttl);
    logger.debug(
      () => `Added anchor cache_control to ${content[idx].type} block`,
    );
  }
}

/**
 * Attach the preserved-head anchor `cache_control` breakpoint to the message
 * derived from the IContent that carried `metadata.cacheAnchor`, then strip the
 * module-private marker so it can never reach the wire.
 *
 * MUST run AFTER `attachPromptCaching` (the rolling-tail breakpoint): when the
 * anchor coincides with the last message the rolling tail already covers it,
 * so the anchor is skipped to avoid wasting one of the 4 permitted breakpoints.
 *
 * ACCEPTED DEGRADATION: if a transform inside `convertToAnthropicMessages`
 * rebuilt the anchored message object, the symbol is gone and no anchor
 * breakpoint is placed. That is exactly today's behaviour (system + rolling
 * tail only) and is a legitimate optimisation miss — NOT an error to swallow.
 * No retry, fallback, or heuristic re-derivation is performed (#3070).
 */
export function attachAnchorCacheControl(
  messages: AnthropicMessage[],
  ttl: AnchorCacheTtl,
  logger: AnchorCacheLogger,
): void {
  const anchorIndex = messages.findIndex(
    (m) => Reflect.get(m, ANCHOR_CACHE_SYMBOL) === true,
  );

  // Always remove the marker so it can never reach the wire (a Symbol key is
  // already invisible to JSON.stringify, but delete it explicitly regardless).
  for (const m of messages) {
    if (Reflect.get(m, ANCHOR_CACHE_SYMBOL) !== undefined) {
      Reflect.deleteProperty(m, ANCHOR_CACHE_SYMBOL);
    }
  }

  if (anchorIndex === -1) {
    // Accepted degradation (see docblock): the transform pipeline rebuilt the
    // anchored message, so no anchor breakpoint is placed.
    return;
  }

  // The rolling-tail breakpoint already marks the last message; a second
  // breakpoint on the same block would waste one of the 4 allowed.
  if (anchorIndex === messages.length - 1) {
    return;
  }

  attachCacheBreakpointToMessage(messages[anchorIndex], ttl, logger);
}
