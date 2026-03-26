/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AuthFlowOrchestrator – Phase 6 extraction from OAuthManager.
 *
 * Owns authentication flow orchestration: the `authenticate` and
 * `authenticateMultipleBuckets` methods with their locking, UI interaction,
 * and stdin lifecycle management.
 *
 * Implements AuthenticatorInterface so TokenAccessCoordinator can trigger
 * auth flows without a circular import.
 */

import {
  DebugLogger,
  mergeRefreshedToken,
  type Config,
  type MessageBus,
  type OAuthTokenRequestMetadata,
  type OAuthTokenWithExtras,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import type {
  AuthenticatorInterface,
  BucketFailoverOAuthManagerLike,
  OAuthProvider,
  OAuthToken,
  TokenStore,
} from './types.js';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import type { ProviderRegistry } from './provider-registry.js';

const logger = new DebugLogger('llxprt:oauth:auth-flow');

type StdinPromptState = {
  stdinWasPaused: boolean;
  stdinHadRawMode: boolean;
  rawModeChanged: boolean;
  stdinStateRestored: boolean;
  markRawModeChanged: () => void;
  restore: () => void;
};

type MultiBucketAuthResult = {
  cancelled: boolean;
  authenticatedBuckets: string[];
  failedBuckets: string[];
};

type MultiBucketAuthenticatorLike = {
  fromCallbacks(opts: {
    onAuthBucket(
      provider: string,
      bucket: string,
      index: number,
      total: number,
    ): Promise<void>;
    onPrompt(provider: string, bucket: string): Promise<boolean>;
    onDelay(ms: number, bucket: string): Promise<void>;
    getEphemeralSetting<T>(key: string): T | undefined;
  }): {
    authenticateMultipleBuckets(opts: {
      provider: string;
      buckets: string[];
    }): Promise<MultiBucketAuthResult>;
  };
};

/**
 * Orchestrates OAuth authentication flows.
 *
 * Responsibilities:
 * - authenticate(): single-bucket auth with auth+refresh lock coordination
 * - authenticateMultipleBuckets(): multi-bucket auth with TUI prompting
 * - requireRuntimeMessageBus(): validates MessageBus availability
 * - userDismissedAuthPrompt: session-scoped dismissed state
 */
export class AuthFlowOrchestrator implements AuthenticatorInterface {
  // Session-scoped flag: user dismissed the BucketAuthConfirmation dialog.
  // When true, subsequent auth attempts skip the dialog and proceed directly.
  userDismissedAuthPrompt = false;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly providerRegistry: ProviderRegistry,
    private readonly facadeRef: BucketFailoverOAuthManagerLike,
    private readonly config?: Config,
    private runtimeMessageBus?: MessageBus,
  ) {}

  /**
   * Update the runtime MessageBus reference.
   * Called by OAuthManager when the messageBus field is replaced after construction
   * (e.g., during test setup via Object.assign).
   */
  setRuntimeMessageBus(bus: MessageBus | undefined): void {
    this.runtimeMessageBus = bus;
  }

  // --------------------------------------------------------------------------
  // requireRuntimeMessageBus
  // --------------------------------------------------------------------------

  private requireRuntimeMessageBus(): MessageBus {
    const messageBus = this.runtimeMessageBus;
    if (!messageBus) {
      throw new Error(
        'OAuthManager requires a runtime MessageBus from the session/runtime composition root.',
      );
    }
    return messageBus;
  }

  // --------------------------------------------------------------------------
  // authenticate
  // --------------------------------------------------------------------------

  /**
   * Authenticate with a specific provider for a given bucket.
   * Acquires auth lock (waitMs:60000, staleMs:360000).
   * Nested refresh lock (waitMs:10000, staleMs:30000) is acquired when an
   * expired token with a refresh_token is found — to avoid replaying
   * single-use refresh tokens concurrently.
   */
  async authenticate(providerName: string, bucket?: string): Promise<void> {
    logger.debug(
      () => `[FLOW] authenticate() called for provider: ${providerName}`,
    );
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providerRegistry.getProvider(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const lockAcquired = await this.tokenStore.acquireAuthLock(providerName, {
      waitMs: 60000, // Wait up to 60 seconds
      staleMs: 360000, // Break locks older than 6 minutes
      bucket,
    });

    if (!lockAcquired) {
      return this.handleAuthLockTimeout(providerName, bucket);
    }

    try {
      const earlyReturn = await this.checkDiskTokenUnderLock(
        providerName,
        bucket,
      );
      if (earlyReturn) {
        return;
      }

      const diskToken = await this.tokenStore.getToken(providerName, bucket);
      const refreshed = await this.attemptRefreshBeforeBrowser(
        providerName,
        bucket,
        diskToken ?? undefined,
      );
      if (refreshed) {
        return;
      }

      await this.doInitiateAuth(providerName, bucket, provider);
    } catch (error) {
      logger.debug(
        () =>
          `[FLOW] authenticate() FAILED for ${providerName}: ${error instanceof Error ? error.message : error}`,
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(
        `Authentication failed for provider ${providerName}: ${String(error)}`,
      );
    } finally {
      await this.tokenStore.releaseAuthLock(providerName, bucket);
      logger.debug(() => `[FLOW] Released auth lock for ${providerName}`);
    }
  }

  /**
   * Check if a valid disk token already exists under the auth lock.
   * Returns true if auth can be skipped.
   */
  private async checkDiskTokenUnderLock(
    providerName: string,
    bucket: string | undefined,
  ): Promise<boolean> {
    const diskToken = await this.tokenStore.getToken(providerName, bucket);
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const thirtySecondsFromNow = nowInSeconds + 30;

    if (diskToken && diskToken.expiry > thirtySecondsFromNow) {
      if (!this.providerRegistry.isOAuthEnabled(providerName)) {
        this.providerRegistry.setOAuthEnabledState(providerName, true);
      }
      logger.debug(
        () =>
          `[FLOW] Found valid token on disk after acquiring lock for ${providerName}, skipping auth`,
      );
      return true;
    }
    return false;
  }

  /**
   * Initiate browser auth and persist the returned token.
   */
  private async doInitiateAuth(
    providerName: string,
    bucket: string | undefined,
    provider: OAuthProvider,
  ): Promise<void> {
    logger.debug(
      () => `[FLOW] Calling provider.initiateAuth() for ${providerName}...`,
    );
    const token = await provider.initiateAuth();
    logger.debug(
      () => `[FLOW] provider.initiateAuth() returned token for ${providerName}`,
    );

    if (!token) {
      throw new Error('Authentication completed but no token was returned');
    }

    logger.debug(
      () => `[FLOW] Saving token to tokenStore for ${providerName}...`,
    );
    await this.tokenStore.saveToken(providerName, token, bucket);
    logger.debug(() => `[FLOW] Token saved to tokenStore for ${providerName}`);

    if (!this.providerRegistry.isOAuthEnabled(providerName)) {
      logger.debug(() => `[FLOW] Enabling OAuth for ${providerName}`);
      this.providerRegistry.setOAuthEnabledState(providerName, true);
    }
    logger.debug(
      () => `[FLOW] authenticate() completed successfully for ${providerName}`,
    );
  }

  /**
   * Handle auth lock timeout: check if another process completed auth while we waited.
   * Throws if no valid disk token is found.
   */
  private async handleAuthLockTimeout(
    providerName: string,
    bucket: string | undefined,
  ): Promise<void> {
    const diskToken = await this.tokenStore.getToken(providerName, bucket);
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const thirtySecondsFromNow = nowInSeconds + 30;

    if (diskToken && diskToken.expiry > thirtySecondsFromNow) {
      if (!this.providerRegistry.isOAuthEnabled(providerName)) {
        this.providerRegistry.setOAuthEnabledState(providerName, true);
      }
      logger.debug(
        () =>
          `[FLOW] Lock timeout but found valid token on disk for ${providerName}, using it`,
      );
      return;
    }

    throw new Error(
      `Failed to acquire auth lock for ${providerName}${bucket ? `/${bucket}` : ''} and no valid token on disk`,
    );
  }

  /**
   * Attempt to refresh an expired token before falling through to browser auth.
   * Returns true if the refresh succeeded (caller should return early),
   * false if browser auth is still needed.
   *
   * Lock parameters: waitMs:10000, staleMs:30000 (prevents replaying single-use tokens).
   */
  private async attemptRefreshBeforeBrowser(
    providerName: string,
    bucket: string | undefined,
    diskToken: import('./types.js').OAuthToken | undefined,
  ): Promise<boolean> {
    if (
      !diskToken ||
      typeof diskToken.refresh_token !== 'string' ||
      diskToken.refresh_token === ''
    ) {
      return false;
    }

    const provider = this.providerRegistry.getProvider(providerName);
    if (!provider) {
      return false;
    }

    const refreshLockAcquired = await this.tokenStore.acquireRefreshLock(
      providerName,
      { waitMs: 10000, staleMs: 30000, bucket },
    );

    if (!refreshLockAcquired) {
      return this.handleRefreshLockTimeout(providerName, bucket, diskToken);
    }

    try {
      return await this.executeRefreshUnderLock(
        providerName,
        bucket,
        diskToken,
        provider,
      );
    } finally {
      await this.tokenStore.releaseRefreshLock(providerName, bucket);
    }
  }

  /**
   * Handle the case where the refresh lock timed out.
   * Another process is likely refreshing; check if the token is now valid.
   */
  private async handleRefreshLockTimeout(
    providerName: string,
    bucket: string | undefined,
    diskToken: OAuthToken,
  ): Promise<boolean> {
    const postLockToken =
      (await this.tokenStore.getToken(providerName, bucket)) ?? diskToken;
    const nowPostLock = Math.floor(Date.now() / 1000);
    if (postLockToken.expiry > nowPostLock + 30) {
      if (!this.providerRegistry.isOAuthEnabled(providerName)) {
        this.providerRegistry.setOAuthEnabledState(providerName, true);
      }
      logger.debug(
        () =>
          `[FLOW] Another process refreshed token for ${providerName}/${bucket ?? 'default'} (detected after lock timeout), skipping browser auth`,
      );
      return true;
    }
    return false;
  }

  /**
   * Execute a token refresh under the refresh lock.
   * Re-reads from disk first (TOCTOU guard), then calls provider.refreshToken.
   */
  private async executeRefreshUnderLock(
    providerName: string,
    bucket: string | undefined,
    diskToken: OAuthToken,
    provider: OAuthProvider,
  ): Promise<boolean> {
    try {
      const latestToken =
        (await this.tokenStore.getToken(providerName, bucket)) ?? diskToken;
      const nowCheck = Math.floor(Date.now() / 1000);
      if (latestToken.expiry > nowCheck + 30) {
        if (!this.providerRegistry.isOAuthEnabled(providerName)) {
          this.providerRegistry.setOAuthEnabledState(providerName, true);
        }
        logger.debug(
          () =>
            `[FLOW] Another process refreshed token for ${providerName}/${bucket ?? 'default'}, skipping browser auth`,
        );
        return true;
      }

      const refreshedToken = await provider.refreshToken(latestToken);
      if (refreshedToken) {
        const mergedToken = mergeRefreshedToken(
          latestToken as OAuthTokenWithExtras,
          refreshedToken as OAuthTokenWithExtras,
        );
        await this.tokenStore.saveToken(providerName, mergedToken, bucket);
        if (!this.providerRegistry.isOAuthEnabled(providerName)) {
          this.providerRegistry.setOAuthEnabledState(providerName, true);
        }
        logger.debug(
          () =>
            `[FLOW] Refreshed expired token for ${providerName}/${bucket ?? 'default'}, skipping browser auth`,
        );
        return true;
      }
    } catch (refreshError) {
      logger.debug(
        () =>
          `[FLOW] Token refresh failed for ${providerName}/${bucket ?? 'default'}, falling through to browser auth: ${refreshError instanceof Error ? refreshError.message : refreshError}`,
      );
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // authenticateMultipleBuckets
  // --------------------------------------------------------------------------

  /**
   * Authenticate multiple buckets for a provider sequentially,
   * showing TUI confirmation dialogs between buckets when available.
   */
  async authenticateMultipleBuckets(
    providerName: string,
    buckets: string[],
    requestMetadata?: OAuthTokenRequestMetadata,
  ): Promise<void> {
    const { MultiBucketAuthenticator } = await import(
      './MultiBucketAuthenticator.js'
    );
    const { getEphemeralSetting: getRuntimeEphemeralSetting } = await import(
      '../runtime/runtimeSettings.js'
    );
    const getEphemeralSetting = <T>(key: string): T | undefined =>
      getRuntimeEphemeralSetting(key) as T | undefined;

    const rawBucketPrompt = getRuntimeEphemeralSetting('auth-bucket-prompt');
    logger.debug('Checking auth-bucket-prompt setting', {
      rawValue: rawBucketPrompt,
      typeof: typeof rawBucketPrompt,
    });

    const unauthenticatedBuckets = await this.filterUnauthenticatedBuckets(
      providerName,
      buckets,
    );

    if (unauthenticatedBuckets.length === 0) {
      logger.debug('All buckets already authenticated', {
        provider: providerName,
        bucketCount: buckets.length,
      });
      return;
    }

    logger.debug('Buckets requiring authentication', {
      provider: providerName,
      total: buckets.length,
      needsAuth: unauthenticatedBuckets.length,
      buckets: unauthenticatedBuckets,
    });

    const result = await this.runMultiBucketAuth(
      MultiBucketAuthenticator,
      providerName,
      buckets,
      unauthenticatedBuckets,
      getEphemeralSetting,
    );

    if (result.cancelled) {
      throw new Error(
        `Multi-bucket authentication cancelled after ${result.authenticatedBuckets.length} of ${unauthenticatedBuckets.length} buckets`,
      );
    }

    if (result.failedBuckets.length > 0) {
      throw new Error(
        `Failed to authenticate ${result.failedBuckets.length} bucket(s): ${result.failedBuckets.join(', ')}`,
      );
    }

    logger.debug(
      `Successfully authenticated ${result.authenticatedBuckets.length} buckets for ${providerName}`,
    );

    this.configureBucketFailover(providerName, buckets, requestMetadata);
  }

  /**
   * Run the multi-bucket authenticator loop with callbacks.
   */
  private async runMultiBucketAuth(
    MultiBucketAuthenticator: MultiBucketAuthenticatorLike,
    providerName: string,
    buckets: string[],
    unauthenticatedBuckets: string[],
    getEphemeralSetting: <T>(key: string) => T | undefined,
  ): Promise<MultiBucketAuthResult> {
    const onAuthBucket = this.buildOnAuthBucketCallback(providerName);
    const onPrompt = this.buildOnPromptCallback(
      providerName,
      buckets,
      getEphemeralSetting,
    );
    const onDelay = async (ms: number, bucket: string): Promise<void> => {
      debugLogger.log(
        `(waiting ${ms / 1000} seconds before opening browser...)\n`,
      );
      logger.debug(`Waiting ${ms}ms before authenticating bucket: ${bucket}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
    };

    const authenticator = MultiBucketAuthenticator.fromCallbacks({
      onAuthBucket,
      onPrompt,
      onDelay,
      getEphemeralSetting,
    });

    // Issue 913: Use unauthenticatedBuckets for the actual auth flow
    return authenticator.authenticateMultipleBuckets({
      provider: providerName,
      buckets: unauthenticatedBuckets,
    });
  }

  /**
   * Configure the bucket failover handler after successful multi-bucket auth.
   */
  private configureBucketFailover(
    providerName: string,
    buckets: string[],
    requestMetadata?: OAuthTokenRequestMetadata,
  ): void {
    // Set up bucket failover handler if we have multiple buckets and config is available
    // @plan PLAN-20251213issue490
    if (buckets.length > 1) {
      const config = this.config;
      if (config) {
        const handler = new BucketFailoverHandlerImpl(
          buckets,
          providerName,
          this.facadeRef,
          requestMetadata,
        );
        config.setBucketFailoverHandler(handler);
        logger.debug('Bucket failover handler configured', {
          provider: providerName,
          bucketCount: buckets.length,
        });
      } else {
        logger.debug(
          'Config not available, bucket failover handler not configured',
        );
      }
    }
  }

  /**
   * Filter a list of buckets to only those that need authentication.
   * Issue 913 FIX: skips buckets that already have valid, unexpired tokens.
   */
  private async filterUnauthenticatedBuckets(
    providerName: string,
    buckets: string[],
  ): Promise<string[]> {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const unauthenticated: string[] = [];

    for (const bucket of buckets) {
      const existingToken = await this.tokenStore.getToken(
        providerName,
        bucket,
      );
      if (existingToken && existingToken.expiry > nowInSeconds + 30) {
        logger.debug(`Bucket ${bucket} already authenticated, skipping`, {
          provider: providerName,
          bucket,
          expiry: existingToken.expiry,
        });
      } else {
        unauthenticated.push(bucket);
      }
    }

    return unauthenticated;
  }

  /**
   * Build the onAuthBucket callback for MultiBucketAuthenticator.
   * Includes TOCTOU defense-in-depth re-check before auth (issue 1652).
   */
  private buildOnAuthBucketCallback(
    providerName: string,
  ): (
    provider: string,
    bucket: string,
    index: number,
    total: number,
  ) => Promise<void> {
    return async (
      provider: string,
      bucket: string,
      index: number,
      total: number,
    ): Promise<void> => {
      try {
        const existingToken = await this.tokenStore.getToken(provider, bucket);
        const now = Math.floor(Date.now() / 1000);
        if (existingToken && existingToken.expiry > now + 30) {
          logger.debug(
            `Bucket ${bucket} already authenticated (cross-process), skipping`,
          );
          return;
        }
      } catch (peekError) {
        logger.debug(
          `TOCTOU peek failed for ${provider}/${bucket}, proceeding with auth:`,
          peekError,
        );
      }

      debugLogger.log(`\n=== Bucket ${index} of ${total}: ${bucket} ===\n`);
      logger.debug(`Authenticating bucket ${index} of ${total}: ${bucket}`);
      // Route through the facade so test spies on manager.authenticate are intercepted.
      await this.facadeRef.authenticate(provider, bucket);
    };
  }

  /**
   * Build the onPrompt callback for MultiBucketAuthenticator.
   * Uses TUI dialog if available, falls back to TTY stdin, then delay.
   */
  private buildOnPromptCallback(
    providerName: string,
    buckets: string[],
    getEphemeralSetting: <T>(key: string) => T | undefined,
  ): (provider: string, bucket: string) => Promise<boolean> {
    return async (provider: string, bucket: string): Promise<boolean> => {
      if (this.userDismissedAuthPrompt) {
        logger.debug(
          'User previously dismissed auth prompt in this session, proceeding directly',
          { provider, bucket },
        );
        return true;
      }

      const showPrompt = getEphemeralSetting<boolean>('auth-bucket-prompt');
      const messageBus = this.requireRuntimeMessageBus();
      logger.debug('Requesting bucket auth confirmation via message bus', {
        provider,
        bucket,
        promptMode: showPrompt,
      });

      const confirmPromise = messageBus.requestBucketAuthConfirmation(
        provider,
        bucket,
        buckets.indexOf(bucket) + 1,
        buckets.length,
      );

      if (showPrompt) {
        logger.debug(
          'Prompt mode enabled - waiting indefinitely for user approval',
        );
        const result = await confirmPromise;
        logger.debug('User responded to bucket auth confirmation', { result });
        if (!result) {
          this.userDismissedAuthPrompt = true;
        }
        return result;
      }

      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 3000),
      );
      const result = await Promise.race([confirmPromise, timeoutPromise]);

      if (result !== 'timeout') {
        logger.debug('TUI responded to bucket auth confirmation', { result });
        if (!result) {
          this.userDismissedAuthPrompt = true;
        }
        return result;
      }

      logger.debug('TUI not ready, falling back to delay-based prompt');

      if (showPrompt && process.stdin.isTTY) {
        return this.waitForStdinKeypress(bucket);
      }

      const delay = getEphemeralSetting<number>('auth-bucket-delay') ?? 5000;
      debugLogger.log(`\nReady to authenticate bucket: ${bucket}`);
      debugLogger.log(
        `(waiting ${delay / 1000} seconds - switch browser window if needed...)\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return true;
    };
  }

  /**
   * Wait for a keypress on stdin before proceeding with bucket authentication.
   * Handles raw mode, pause state, and EIO errors defensively (issue #1020).
   */
  private async waitForStdinKeypress(bucket: string): Promise<boolean> {
    debugLogger.log(`\nReady to authenticate bucket: ${bucket}`);
    debugLogger.log('Press ENTER to continue, or Ctrl+C to cancel...\n');

    const state = this.makeStdinState();

    try {
      await this.awaitKeypressOrError(state);
    } catch (error) {
      state.restore();
      throw error;
    }
    return true;
  }

  /**
   * Capture current stdin state and return a restore function.
   */
  private makeStdinState(): StdinPromptState {
    const stdinWasPaused = process.stdin.isPaused();
    const stdinHadRawMode =
      process.stdin.isTTY &&
      typeof process.stdin.isRaw === 'boolean' &&
      process.stdin.isRaw;
    let rawModeChanged = false;
    let stdinStateRestored = false;

    const restore = (): void => {
      if (stdinStateRestored) {
        return;
      }
      stdinStateRestored = true;

      if (rawModeChanged && process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(stdinHadRawMode);
        } catch {
          // Issue #1020: Ignore EIO errors during cleanup
        }
      }

      if (stdinWasPaused) {
        try {
          process.stdin.pause();
        } catch {
          // Ignore pause cleanup errors
        }
      }
    };

    const markRawModeChanged = (): void => {
      rawModeChanged = true;
    };

    return {
      stdinWasPaused,
      stdinHadRawMode,
      rawModeChanged,
      stdinStateRestored,
      markRawModeChanged,
      restore,
    };
  }

  /**
   * Register stdin listeners and wait for a keypress or error.
   * Configures raw mode and resumes stdin if needed.
   */
  private async awaitKeypressOrError(state: StdinPromptState): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('error', onError);
        state.restore();
      };

      const onData = (): void => {
        cleanup();
        resolve();
      };

      const onError = (err: Error): void => {
        cleanup();
        const nodeError = err as NodeJS.ErrnoException;
        const isEioError =
          nodeError.code === 'EIO' ||
          nodeError.errno === -5 ||
          (typeof nodeError.message === 'string' &&
            nodeError.message.includes('EIO'));
        if (isEioError) {
          logger.debug('Ignoring transient stdin EIO error during prompt');
          reject(new Error('Prompt cancelled due to I/O error'));
        } else {
          reject(err);
        }
      };

      if (!state.stdinHadRawMode && process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          state.markRawModeChanged();
        } catch (err) {
          logger.debug('Failed to set raw mode for prompt:', err);
          cleanup();
          reject(new Error('Failed to set raw mode for prompt'));
          return;
        }
      }

      if (state.stdinWasPaused) {
        process.stdin.resume();
      }
      process.stdin.once('data', onData);
      process.stdin.once('error', onError);
    });
  }
}
