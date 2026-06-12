/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WebSearchServerToolsProvider {
  getServerTools(): string[];
  invokeServerTool(
    name: string,
    params: { query: string },
    options: { signal: AbortSignal },
  ): Promise<unknown>;
}

export interface IWebSearchService {
  getServerToolsProvider(): WebSearchServerToolsProvider | undefined;
}
