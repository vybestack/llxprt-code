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
}
