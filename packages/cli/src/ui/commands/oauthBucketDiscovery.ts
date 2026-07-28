/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BucketStats } from '@vybestack/llxprt-code-auth';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';

type BucketDiscoveryLogger = Pick<
  DebugLogger,
  'debug' | 'error' | 'warn' | 'log'
>;

/**
 * Narrow interface for the OAuth manager surface required by bucket
 * discovery. Both the real OAuthManager and test doubles satisfy this.
 */
export interface OAuthBucketDiscoveryTokenStore {
  listBuckets(provider: string): Promise<string[]>;
  getBucketStats(provider: string, bucket: string): Promise<BucketStats | null>;
  getToken(provider: string, bucket?: string): Promise<unknown>;
}

export interface OAuthBucketDiscoveryManager {
  getSupportedProviders(): string[];
  getTokenStore(): OAuthBucketDiscoveryTokenStore;
}

/** A single bucket with its (possibly null) usage statistics. */
export interface DiscoveredBucket {
  readonly bucket: string;
  readonly stats: BucketStats | null;
}

/** A provider with all of its discovered buckets. */
export interface DiscoveredProvider {
  readonly provider: string;
  readonly buckets: readonly DiscoveredBucket[];
}

const NO_OP_LOGGER: BucketDiscoveryLogger = {
  debug: () => {},
  error: () => {},
  warn: () => {},
  log: () => {},
};

async function collectBucketsForProvider(
  tokenStore: OAuthBucketDiscoveryTokenStore,
  provider: string,
  log: BucketDiscoveryLogger,
): Promise<DiscoveredBucket[]> {
  let buckets: string[] = [];
  try {
    buckets = await tokenStore.listBuckets(provider);
  } catch (error) {
    log.warn(
      () =>
        `[oauthBucketDiscovery] Failed to list buckets for ${provider}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  const bucketPromises = buckets.map(
    async (bucket): Promise<DiscoveredBucket> => {
      try {
        const stats = await tokenStore.getBucketStats(provider, bucket);
        return { bucket, stats };
      } catch (error) {
        log.warn(
          () =>
            `[oauthBucketDiscovery] Failed to read stats for ${provider}/${bucket}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return { bucket, stats: null };
      }
    },
  );
  return Promise.all(bucketPromises);
}

/**
 * Discover all OAuth provider buckets from a runtime OAuth manager with
 * per-provider and per-bucket error isolation. A failure while listing
 * buckets for one provider, or reading stats for one bucket, does not
 * suppress results from other providers or buckets.
 *
 * Providers with zero buckets are omitted from the result (they contributed
 * no actionable data), mirroring the diagnostics discovery semantics.
 *
 * Returns an empty array when the manager has no supported providers, no
 * stored buckets, or every provider encountered an error.
 */
export async function discoverProviderBuckets(
  oauthManager: OAuthBucketDiscoveryManager,
  logger?: BucketDiscoveryLogger,
): Promise<DiscoveredProvider[]> {
  const log = logger ?? NO_OP_LOGGER;
  const supportedProviders = oauthManager.getSupportedProviders();
  if (supportedProviders.length === 0) {
    return [];
  }
  const tokenStore = oauthManager.getTokenStore();

  const providerResults = await Promise.all(
    supportedProviders.map(
      async (provider): Promise<DiscoveredProvider | null> => {
        const discoveredBuckets = await collectBucketsForProvider(
          tokenStore,
          provider,
          log,
        );
        if (discoveredBuckets.length === 0) {
          return null;
        }
        return { provider, buckets: discoveredBuckets };
      },
    ),
  );

  return providerResults.filter(
    (result): result is DiscoveredProvider => result !== null,
  );
}
