/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AnthropicMessageConversionOptions {
  isOAuth: boolean;
  reasoningEnabled: boolean;
  config?: unknown;
  unprefixToolName: (name: string, isOAuth: boolean) => string;
  logger: { debug: (fn: () => string) => void };
  /**
   * Whether the target endpoint accepts `source:{type:'url'}` image blocks.
   * Defaults to true (native Anthropic). zai's Anthropic-compatible endpoint
   * rejects them (#3693), so request preparation sets this to false there and
   * url-encoded image blocks serialize as the unsupported-media placeholder.
   */
  supportsUrlImages?: boolean;
}
