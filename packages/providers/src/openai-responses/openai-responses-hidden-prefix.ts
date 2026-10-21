/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const HIDDEN_PREFIX_MAX_BYTES = 256 * 1024;
const HIDDEN_PREFIX_MAX_ITEMS = 128;

function retainedContentBytes(value: unknown): number {
  if (typeof value === 'string') return 32 + value.length * 3;
  if (typeof value !== 'object' || value === null) return 16;
  return Object.entries(value).reduce(
    (bytes, [key, child]) =>
      bytes + 32 + key.length * 3 + retainedContentBytes(child),
    64,
  );
}

function isHiddenThinking(message: IContent): boolean {
  if (message.speaker !== 'ai' || message.metadata !== undefined) return false;
  return (
    message.blocks.length > 0 &&
    message.blocks.every(
      (block) => block.type === 'thinking' && block.isHidden === true,
    )
  );
}

export class ResponsesHiddenPrefix {
  private readonly pending: IContent[] = [];
  private bytes = 0;

  constructor(private readonly publication: { contentYielded: boolean }) {}

  quarantine(message: IContent): boolean {
    if (this.publication.contentYielded || !isHiddenThinking(message))
      return false;
    const messageBytes = retainedContentBytes(message);
    if (
      this.pending.length + 1 >= HIDDEN_PREFIX_MAX_ITEMS ||
      this.bytes + messageBytes >= HIDDEN_PREFIX_MAX_BYTES
    ) {
      return false;
    }
    this.pending.push(message);
    this.bytes += messageBytes;
    return true;
  }

  *publish(checkFailure: () => void): Generator<IContent> {
    while (this.pending.length > 0) {
      checkFailure();
      const hidden = this.pending.shift();
      if (hidden === undefined) break;
      this.publication.contentYielded = true;
      yield hidden;
    }
    this.bytes = 0;
    checkFailure();
  }
}
