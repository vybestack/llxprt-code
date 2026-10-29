/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { CompressionProfileNotFoundError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { NoActiveProviderError } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { tryReadActiveProvider } from './chatSessionProviderRuntime.js';

/**
 * Resolves which provider a chat session talks to. The adapter and the desired
 * provider name are read on demand because both change across history rebinds.
 */
export class ChatSessionProviderResolution {
  constructor(
    private readonly readAdapter: () => AgentRuntimeProviderAdapter,
    private readonly readDesiredProviderName: () => string,
    private readonly logger: DebugLogger,
  ) {}

  private getActiveProvider(): IProvider | undefined {
    return tryReadActiveProvider(() => this.readAdapter().getActiveProvider());
  }

  private lookupProviderByName(
    adapter: AgentRuntimeProviderAdapter,
    desiredProviderName: string,
    compressionProfileName: string,
  ): IProvider | undefined {
    if (typeof adapter.getProviderByName !== 'function') {
      return undefined;
    }
    try {
      const candidate = adapter.getProviderByName(desiredProviderName);
      if (candidate !== undefined) {
        const active = this.getActiveProvider();
        if (active !== undefined && active.name !== desiredProviderName) {
          this.logger.debug(
            () =>
              `[ChatSession] selected provider '${desiredProviderName}' via getProviderByName (active remains '${active.name}') [${compressionProfileName}]`,
          );
        }
        return candidate;
      }
    } catch (error) {
      this.logger.debug(
        () =>
          `[ChatSession] provider lookup skipped (${compressionProfileName}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return undefined;
  }

  resolveForRuntime(compressionProfileName: string): IProvider {
    const desiredProviderName = this.readDesiredProviderName().trim();
    const adapter = this.readAdapter();

    if (desiredProviderName) {
      const candidate = this.lookupProviderByName(
        adapter,
        desiredProviderName,
        compressionProfileName,
      );
      if (candidate) {
        return candidate;
      }
    }

    let provider = this.getActiveProvider();
    if (!provider) {
      throw new NoActiveProviderError('No active provider configured');
    }

    if (desiredProviderName && provider.name !== desiredProviderName) {
      const previousProviderName = provider.name;
      try {
        adapter.setActiveProvider(desiredProviderName);
        provider = adapter.getActiveProvider();
        this.logger.debug(
          () =>
            `[ChatSession] enforced provider switch to '${desiredProviderName}' (previous '${previousProviderName}') [${compressionProfileName}]`,
        );
      } catch (error) {
        this.logger.debug(
          () =>
            `[ChatSession] provider switch skipped (${compressionProfileName}, read-only context): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return provider;
  }

  resolveExplicitCompression(
    profileName: string,
    providerName: string,
    lookupProviderName: string = providerName,
  ): IProvider {
    const adapter = this.readAdapter();
    const lookupResult = this.lookupProviderByName(
      adapter,
      lookupProviderName,
      `compression.profile:${profileName}`,
    );
    if (lookupResult) {
      return lookupResult;
    }

    const activeProvider = this.getActiveProvider();
    if (
      activeProvider?.name === providerName ||
      activeProvider?.name === lookupProviderName
    ) {
      return activeProvider;
    }

    throw new CompressionProfileNotFoundError(
      profileName,
      `provider '${lookupProviderName}' is not available for compression.profile: provider lookup by name is required when it is not already active`,
    );
  }
}
