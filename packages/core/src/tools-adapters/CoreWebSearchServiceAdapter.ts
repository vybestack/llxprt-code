/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IWebSearchService,
  WebSearchServerToolsProvider,
} from '@vybestack/llxprt-code-tools';
import type { Config } from '../config/config.js';

export class CoreWebSearchServiceAdapter implements IWebSearchService {
  constructor(private readonly config: Config) {}

  getServerToolsProvider(): WebSearchServerToolsProvider | undefined {
    // getServerToolsProvider() may return null; coalesce to undefined to
    // satisfy the IWebSearchService contract (provider | undefined).
    const provider = this.config
      .getContentGeneratorConfig()
      ?.providerManager?.getServerToolsProvider();
    return provider ?? undefined;
  }
}
