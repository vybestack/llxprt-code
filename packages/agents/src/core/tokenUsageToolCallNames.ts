/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** Resolves the name a tool call was made under, by call id. */
export interface ToolCallNames {
  /** Record the tool calls of one request row before its results are resolved. */
  observe(content: IContent): void;
  get(callId: string): string | undefined;
}

/**
 * Whole-request map used by the array route, which holds every content and so
 * can resolve any result against any call.
 */
export function fullRequestToolCallNames(
  requestContents: readonly IContent[],
): ToolCallNames {
  const names = new Map<string, string>();
  for (const content of requestContents) {
    for (const block of content.blocks) {
      if (block.type === 'tool_call') names.set(block.id, block.name);
    }
  }
  return { observe: () => undefined, get: (callId) => names.get(callId) };
}

/**
 * Source-route attribution. Calls precede their results in a request, so only a
 * bounded window of the most recent call ids needs to be remembered while
 * rows stream by; nothing context-wide is retained. A call evicted before its
 * result arrives falls back to the result's own tool name, exactly as an
 * unmatched result does on the array route.
 */
export class BoundedToolCallNames implements ToolCallNames {
  private readonly names = new Map<string, string>();

  constructor(private readonly capacity: number) {}

  observe(content: IContent): void {
    for (const block of content.blocks) {
      if (block.type !== 'tool_call') continue;
      this.names.delete(block.id);
      this.names.set(block.id, block.name);
      if (this.names.size > this.capacity) {
        const oldest = this.names.keys().next().value;
        if (oldest !== undefined) this.names.delete(oldest);
      }
    }
  }

  get(callId: string): string | undefined {
    return this.names.get(callId);
  }
}
