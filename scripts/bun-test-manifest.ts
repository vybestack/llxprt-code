/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { validateResolvedFiles } from './bun-test-manifest-validation.js';

export interface BunTestWorkspaceEntry {
  readonly workspace: string;
  /**
   * Explicit list of test files, relative to the resolved cwd. Used by
   * workspaces that are only partially migrated, where naming alone cannot
   * distinguish a Bun-ready file from one still owned by Vitest.
   *
   * Mutually exclusive with `include`: an entry declares exactly one of the
   * two so it is always obvious whether its file set is curated or derived.
   */
  readonly files?: readonly string[];
  /**
   * Glob patterns (relative to the resolved cwd) that select every test file
   * for a fully migrated root. This is the Bun-native equivalent of a Vitest
   * config's `include`, and it is what makes "no test file can be silently
   * dropped" mechanically true: a newly added test file is picked up without
   * any manifest edit.
   */
  readonly include?: readonly string[];
  /** Glob patterns removed from the `include` result. */
  readonly exclude?: readonly string[];
  /**
   * Optional explicit working directory override. When omitted, the workspace
   * name is resolved under `packages/` (e.g. `packages/core`). When set, this
   * path is used as the cwd and file resolution root.
   */
  readonly cwd?: string;
  /**
   * Optional Bun `--preload` script path(s) (relative to the workspace cwd)
   * run before any test module is imported. Used by workspaces whose tests
   * must isolate global state (e.g. Storage roots) before test modules import
   * the singleton — `bun test` does not run Vitest `setupFiles`, so a preload
   * is the only way to guarantee ordering under Bun.
   */
  readonly preload?: string | readonly string[];
  /**
   * Optional tsconfig (relative to the workspace cwd) passed to Bun as
   * `--tsconfig-override`. Used where test-only module resolution differs from
   * the build configuration (e.g. stubbing the editor-injected `vscode`
   * module), so the production tsconfig stays honest.
   */
  readonly tsconfig?: string;
  /**
   * Per-test timeout in milliseconds for this root, overriding the runner's
   * global `--timeout`. Mirrors a Vitest config's `testTimeout`.
   */
  readonly timeout?: number;
  /**
   * Number of times a failing file is re-run before it is reported as failed.
   * Mirrors a Vitest config's `retry`, which real-provider E2E suites rely on.
   */
  readonly retries?: number;
  /**
   * Module (relative to the workspace cwd) exporting `setup()` and/or
   * `teardown()`, executed once in the runner process around the whole root.
   * Mirrors a Vitest config's `globalSetup`: mutations it makes to
   * `process.env` are inherited by every spawned test process.
   */
  readonly globalSetup?: string;
  /**
   * Marks a root that calls a real provider and therefore needs credentials
   * and quota. Such roots are excluded from an unfiltered run and must be
   * selected explicitly with `--root`, so the ordinary PR gate never burns
   * quota; their dedicated workflows request them by name.
   */
  readonly credentialed?: boolean;
}

export interface BunTestFile {
  readonly file: string;
  readonly cwd: string;
  /**
   * Resolved absolute preload paths for this file's workspace (empty when the
   * workspace declares none). Passed to `bun test --preload`.
   */
  readonly preloads: readonly string[];
  /** Resolved absolute `--tsconfig-override` path, when the entry declares one. */
  readonly tsconfig?: string;
  /** Per-test timeout override in milliseconds, when the entry declares one. */
  readonly timeout?: number;
  /** Retry budget for this file, when the entry declares one. */
  readonly retries?: number;
  /** Resolved absolute global setup module path, when the entry declares one. */
  readonly globalSetup?: string;
}

export interface BunManifestDependencies {
  stat(path: string): { isFile(): boolean };
  /**
   * Expands a glob pattern to file paths relative to `cwd`. Injected so the
   * resolver stays testable without touching the real filesystem.
   */
  glob(pattern: string, cwd: string): readonly string[];
}

export class BunManifestStatError extends Error {
  readonly path: string;
  readonly code: string | undefined;

  constructor(path: string, code: string | undefined, cause: unknown) {
    super(
      `Unable to inspect Bun native test manifest path: ${path}${
        code ? ` (${code})` : ''
      }`,
      { cause },
    );
    this.name = 'BunManifestStatError';
    this.path = path;
    this.code = code;
  }
}

const defaultManifestDependencies: BunManifestDependencies = {
  stat: statSync,
  glob: (pattern, cwd) =>
    Array.from(new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true })).sort(),
};

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * The release-install smoke, kept in its own root because it packs and
 * installs a CLI tarball and therefore needs a much larger time budget than
 * the rest of the script harness.
 */
export const SLOW_SCRIPTS_TEST = 'issue-2603-release-install.test.ts';

/** Every test root executed by Bun's native test runner. */
export const BUN_NATIVE_TEST_MANIFEST: readonly BunTestWorkspaceEntry[] = [
  {
    workspace: 'a2a-server',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'bun-preload-storage-isolation.ts',
    ],
    include: ['src/**/*.test.ts'],
  },
  {
    workspace: 'agents',
    files: [
      'test-bun/generatingModelStamp.issue2511.bun.ts',
      'test-bun/subagentAnthropicTextSettings.issue1738.bun.ts',
    ],
  },
  {
    workspace: 'cli',
    files: [
      'src/__tests__/cliSessionDispatch.characterization.test.tsx',
      // Extension settings storage drives the REAL SecureStore against an
      // in-memory keyring, so it needs no module mocking and is Bun-native.
      'test-bun/settingsStorage.bun.ts',
      // JSP/1 observation producer (issue #2779). Bun-native from the start:
      // these are excluded from the Vitest selection so they run only here.
      'src/observation/jspBounds.test.ts',
      'src/observation/jspProducer.test.ts',
      'src/observation/jspProducerState.test.ts',
      'src/observation/jspRedaction.test.ts',
      'src/observation/jspSchema.test.ts',
      'src/observation/jspTransport.test.ts',
      'src/observation/jspWiring.test.ts',
      'src/observation/observationTap.test.ts',
      // Sandbox SSH agent preflight (issue #1699). Bun-native from the start
      // and likewise excluded from the Vitest selection.
      'src/utils/sandbox-ssh-agent-preflight.test.ts',
      'src/zed-integration/zed-session-lifecycle.test.ts',
      'test-bun/iContentToHistoryItems.issue2511.bun.ts',
      'test-utils/augment-bun-vi-cleanup.bun.ts',
    ],
  },
  {
    workspace: 'core',
    files: ['src/utils/errors.test.ts'],
  },
  {
    workspace: 'providers',
    files: [
      'src/__tests__/attemptLifecycle.behavior.test.ts',
      'src/__tests__/attemptLifecycle.exact.test.ts',
      'src/__tests__/attemptLifecycle.exactCounts.test.ts',
      'src/__tests__/attemptLifecycle.helpers.test.ts',
      'src/__tests__/auth-migration-p16.integration.test.ts',
      'src/__tests__/BaseProvider.guard.test.ts',
      'src/__tests__/baseProvider.stateless.test.ts',
      'src/__tests__/BaseProviderNormalization.ephemeralPropagation.test.ts',
      'src/__tests__/BaseProviderNormalization.invocation.test.ts',
      'src/__tests__/errors.test.ts',
      'src/__tests__/extracted-helpers.behavior.test.ts',
      'src/__tests__/headless-provider.test.ts',
      'src/__tests__/LoadBalancingProvider.activeModel.test.ts',
      'src/__tests__/LoadBalancingProvider.circuitbreaker.test.ts',
      'src/__tests__/LoadBalancingProvider.compressionAccounting.test.ts',
      'src/__tests__/LoadBalancingProvider.delegation.test.ts',
      'src/__tests__/LoadBalancingProvider.delegation2.test.ts',
      'src/__tests__/LoadBalancingProvider.failover.errors.test.ts',
      'src/__tests__/LoadBalancingProvider.failover.retryable.test.ts',
      'src/__tests__/LoadBalancingProvider.failover.selection.test.ts',
      'src/__tests__/LoadBalancingProvider.failover.settings.test.ts',
      'src/__tests__/LoadBalancingProvider.failover.stickyIndex.test.ts',
      'src/__tests__/LoadBalancingProvider.failover.streaming.test.ts',
      'src/__tests__/LoadBalancingProvider.getContextLimit.test.ts',
      'src/__tests__/LoadBalancingProvider.getCurrentModel.test.ts',
      'src/__tests__/LoadBalancingProvider.interface.test.ts',
      'src/__tests__/LoadBalancingProvider.lifecycle.noPhantom.test.ts',
      'src/__tests__/LoadBalancingProvider.liveness.test.ts',
      'src/__tests__/LoadBalancingProvider.metrics.test.ts',
      'src/__tests__/LoadBalancingProvider.realpath.repro.test.ts',
      'src/__tests__/LoadBalancingProvider.retryBoundary.integration.test.ts',
      'src/__tests__/LoadBalancingProvider.roundrobin.test.ts',
      'src/__tests__/LoadBalancingProvider.selectionEvent.test.ts',
      'src/__tests__/LoadBalancingProvider.settings-merge.test.ts',
      'src/__tests__/LoadBalancingProvider.stats.test.ts',
      'src/__tests__/LoadBalancingProvider.stats2.test.ts',
      'src/__tests__/LoadBalancingProvider.timeout.test.ts',
      'src/__tests__/LoadBalancingProvider.tokenAccounting.test.ts',
      'src/__tests__/LoadBalancingProvider.tpm.test.ts',
      'src/__tests__/LoadBalancingProvider.types.test.ts',
      'src/__tests__/LoggingProviderWrapper.apiTelemetry.test.ts',
      'src/__tests__/LoggingProviderWrapper.enhancedMetrics.test.ts',
      'src/__tests__/LoggingProviderWrapper.getContextLimit.test.ts',
      'src/__tests__/LoggingProviderWrapper.stateless.test.ts',
      'src/__tests__/LoggingProviderWrapper.tpm.test.ts',
      'src/__tests__/ProviderManager.guard.test.ts',
      'src/__tests__/ProviderManager.sandboxBaseUrl.test.ts',
      'src/__tests__/ProviderManager.settingsSeparation.test.ts',
      'src/__tests__/retryInfrastructure.behavior.test.ts',
      'src/__tests__/RetryOrchestrator.basic.test.ts',
      'src/__tests__/RetryOrchestrator.failover-budget.test.ts',
      'src/__tests__/RetryOrchestrator.failover.test.ts',
      'src/__tests__/RetryOrchestrator.getContextLimit.test.ts',
      'src/__tests__/RetryOrchestrator.integration.test.ts',
      'src/__tests__/RetryOrchestrator.invocation.test.ts',
      'src/__tests__/RetryOrchestrator.onAuthError.test.ts',
      'src/__tests__/RetryOrchestrator.timeoutCleanup.test.ts',
      'src/__tests__/safeDefaultModel.regression.test.ts',
      'src/__tests__/settings-integration/provider-settings.integration.test.ts',
      'src/__tests__/tools-formatting.test.ts',
      'src/anthropic/AnthropicApiExecution.dumpContext.test.ts',
      'src/anthropic/AnthropicApiExecution.separateDump.test.ts',
      'src/anthropic/AnthropicMessageNormalizer.crossModelThinking.test.ts',
      'src/anthropic/AnthropicMessageValidator.stripEmptyTextBlocks.test.ts',
      'src/anthropic/AnthropicModelData.test.ts',
      'src/anthropic/AnthropicProvider.caching-metrics.test.ts',
      'src/anthropic/AnthropicProvider.caching.test.ts',
      'src/anthropic/AnthropicProvider.chat.test.ts',
      'src/anthropic/AnthropicProvider.dumpContext.test.ts',
      'src/anthropic/AnthropicProvider.fable5.thinking.test.ts',
      'src/anthropic/AnthropicProvider.getModels.test.ts',
      'src/anthropic/AnthropicProvider.issue1150-repro.test.ts',
      'src/anthropic/AnthropicProvider.issue1150.redacted.test.ts',
      'src/anthropic/AnthropicProvider.issue1150.shape.test.ts',
      'src/anthropic/AnthropicProvider.issue1150.streaming.test.ts',
      'src/anthropic/AnthropicProvider.issue1150.test.ts',
      'src/anthropic/AnthropicProvider.issue1150.toolresult.adjacency.test.ts',
      'src/anthropic/AnthropicProvider.issue1150.toolresult.edgecases.test.ts',
      'src/anthropic/AnthropicProvider.issue1494.test.ts',
      'src/anthropic/AnthropicProvider.issue2329.test.ts',
      'src/anthropic/AnthropicProvider.issue2411.test.ts',
      'src/anthropic/AnthropicProvider.issue276.test.ts',
      'src/anthropic/AnthropicProvider.mediaBlock.test.ts',
      'src/anthropic/AnthropicProvider.multiBlock.test.ts',
      'src/anthropic/AnthropicProvider.messaging.test.ts',
      'src/anthropic/AnthropicProvider.modelParams.test.ts',
      'src/anthropic/AnthropicProvider.oauth.test.ts',
      'src/anthropic/AnthropicProvider.ratelimits.test.ts',
      'src/anthropic/AnthropicProvider.stateless.test.ts',
      'src/anthropic/AnthropicProvider.thinking.config.test.ts',
      'src/anthropic/AnthropicProvider.thinking.context.test.ts',
      'src/anthropic/AnthropicProvider.thinking.display.test.ts',
      'src/anthropic/AnthropicProvider.thinking.multiturn.test.ts',
      'src/anthropic/AnthropicProvider.thinking.streaming.test.ts',
      'src/anthropic/AnthropicProvider.throttling.test.ts',
      'src/anthropic/AnthropicProvider.toolFormatDetection.test.ts',
      'src/anthropic/AnthropicProvider.tools.test.ts',
      'src/anthropic/AnthropicRateLimitHandler.test.ts',
      'test-bun/AnthropicRequestBuilder.issue1738.bun.ts',
      'src/anthropic/AnthropicRequestBuilder.modelParams.test.ts',
      'src/anthropic/AnthropicResponseParser.issue1844.test.ts',
      'src/anthropic/AnthropicStreamProcessor.retryOwnership.test.ts',
      'src/anthropic/usageInfo.test.ts',
      'src/apiKeyQuotaResolver.test.ts',
      'src/auth/__tests__/anthropic-oauth-provider.browser-profile.spec.ts',
      'src/auth/__tests__/anthropic-oauth-provider.fallback.spec.ts',
      'src/auth/__tests__/auth-flow-orchestrator.spec.ts',
      'src/auth/__tests__/auth-import-isolation.test.ts',
      'src/auth/__tests__/auth-status-service.spec.ts',
      // Excluded: Bun fake-timer incompatibility on Linux CI (issue #2842 shim).
      // These pass on macOS and under vitest. Re-add when Bun runtime is fixed.
      // 'src/auth/__tests__/behavioral/error-edge-cases.behavioral.spec.ts',
      'src/auth/__tests__/behavioral/multi-bucket.behavioral.spec.ts',
      // Excluded: proactive-renewal tests timeout on Linux CI under Bun.
      // 'src/auth/__tests__/behavioral/proactive-renewal.behavioral.spec.ts',
      // Excluded: Bun fake-timer incompatibility on Linux CI.
      // 'src/auth/__tests__/behavioral/single-bucket.behavioral.spec.ts',
      'src/auth/__tests__/behavioral/subagent-isolation.behavioral.spec.ts',
      // Excluded: Bun fake-timer incompatibility on Linux CI.
      // 'src/auth/__tests__/behavioral/user-entry-points.behavioral.spec.ts',
      'src/auth/__tests__/browser-profile-association-store.spec.ts',
      'src/auth/__tests__/BucketFailoverHandlerImpl.invalidateAuthCache.test.ts',
      'src/auth/__tests__/codex-oauth-provider.fallback.spec.ts',
      'src/auth/__tests__/codex-oauth-provider.test.ts',
      'src/auth/__tests__/forceRefreshToken.bucketResolution.test.ts',
      'src/auth/__tests__/forceRefreshToken.cacheInvalidation.test.ts',
      'src/auth/__tests__/forceRefreshToken.test.ts',
      'src/auth/__tests__/multi-bucket-auth.spec.ts',
      'src/auth/__tests__/oauth-manager-interface-contract.test.ts',
      'src/auth/__tests__/oauth-manager.getToken-bucket-peek.spec.ts',
      'src/auth/__tests__/oauth-manager.issue913.spec.ts',
      'src/auth/__tests__/oauth-manager.user-declined.spec.ts',
      'src/auth/__tests__/oauth-provider-base.spec.ts',
      'src/auth/__tests__/OAuthBucketManager.spec.ts',
      // Excluded: Bun fake-timer incompatibility on Linux CI.
      // 'src/auth/__tests__/oauthManager.proactive-renewal.test.ts',
      'src/auth/__tests__/oauthManager.safety.test.ts',
      // Excluded: Bun fake-timer incompatibility on Linux CI.
      // 'src/auth/__tests__/proactive-renewal-cross-process.spec.ts',
      // Excluded: Bun fake-timer incompatibility on Linux CI.
      // 'src/auth/__tests__/proactive-renewal-manager.spec.ts',
      'src/auth/__tests__/provider-registry.spec.ts',
      'src/auth/__tests__/provider-usage-info.spec.ts',
      'src/auth/__tests__/token-access-coordinator.spec.ts',
      'src/auth/anthropic-oauth-provider.local-flow.spec.ts',
      'src/auth/anthropic-oauth-provider.no-refresh-on-gettoken.spec.ts',
      'src/auth/anthropic-oauth-provider.refresh.spec.ts',
      'src/auth/anthropic-oauth-provider.test.ts',
      'src/auth/BucketFailoverHandlerImpl.case-01.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-02.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-03.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-04.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-05.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-06.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-07.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-08.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-09.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-10.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-11.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-12.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-13.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-14.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-15.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-16.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-17.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-18.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-19.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-20.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-21.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-22.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-23.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-24.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-25.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-26.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-27.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-28.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-29.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-30.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-31.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-32.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-33.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-34.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-35.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-36.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-37.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-38.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-39.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-40.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-41.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-42.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-43.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-44.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-45.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-46.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-47.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-48.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-49.spec.ts',
      'src/auth/BucketFailoverHandlerImpl.case-50.spec.ts',
      // Excluded: Bun fake-timer incompatibility on Linux CI.
      // 'src/auth/codex-oauth-provider.spec.ts',
      'src/auth/file-oauth-settings.test.ts',
      'src/auth/local-oauth-callback.spec.ts',
      'src/auth/oauth-manager-initialization.spec.ts',
      'src/auth/oauth-manager.auth-lock.spec.ts',
      'src/auth/oauth-manager.concurrency.spec.ts',
      'src/auth/oauth-manager.failover-wiring.spec.ts',
      'src/auth/oauth-manager.issue1317.spec.ts',
      'src/auth/oauth-manager.issue1468.case-01.spec.ts',
      'src/auth/oauth-manager.issue1468.case-02.spec.ts',
      'src/auth/oauth-manager.issue1468.case-03.spec.ts',
      'src/auth/oauth-manager.issue1468.case-04.spec.ts',
      'src/auth/oauth-manager.issue1468.case-05.spec.ts',
      'src/auth/oauth-manager.issue1468.case-06.spec.ts',
      'src/auth/oauth-manager.issue1468.case-07.spec.ts',
      'src/auth/oauth-manager.issue1468.case-08.spec.ts',
      'src/auth/oauth-manager.issue1468.case-09.spec.ts',
      'src/auth/oauth-manager.issue1468.case-10.spec.ts',
      'src/auth/oauth-manager.issue1468.case-11.spec.ts',
      'src/auth/oauth-manager.issue1468.case-12.spec.ts',
      'src/auth/oauth-manager.issue1468.case-13.spec.ts',
      'src/auth/oauth-manager.issue1468.case-14.spec.ts',
      'src/auth/oauth-manager.issue1468.case-15.spec.ts',
      'src/auth/oauth-manager.issue1468.case-16.spec.ts',
      'src/auth/oauth-manager.issue1468.case-17.spec.ts',
      'src/auth/oauth-manager.issue1468.case-18.spec.ts',
      'src/auth/oauth-manager.logout.spec.ts',
      'src/auth/oauth-manager.refresh-race.spec.ts',
      'src/auth/oauth-manager.runtime-messagebus.spec.ts',
      'src/auth/oauth-manager.spec.ts',
      'src/auth/oauth-manager.token-reuse.spec.ts',
      'src/auth/oauth-manager.wiring.spec.ts',
      'src/auth/proxy/__tests__/concurrent-dispatch.test.ts',
      'src/auth/proxy/__tests__/credential-proxy-server.test.ts',
      'src/auth/proxy/__tests__/frame-and-cancel.test.ts',
      'src/auth/proxy/__tests__/deprecation-guard.test.ts',
      'src/auth/proxy/__tests__/e2e-credential-flow.test.ts',
      'src/auth/proxy/__tests__/factory-detection-wiring.test.ts',
      'src/auth/proxy/__tests__/github-broker-envelope.test.ts',
      'src/auth/proxy/__tests__/github-broker-multistep.test.ts',
      'src/auth/proxy/__tests__/github-broker-p10.test.ts',
      'src/auth/proxy/__tests__/github-broker-p10b.test.ts',
      'src/auth/proxy/__tests__/github-broker-security.test.ts',
      'src/auth/proxy/__tests__/github-broker-watch.test.ts',
      'src/auth/proxy/__tests__/github-broker-write-ops.test.ts',
      'src/auth/proxy/__tests__/github-broker.test.ts',
      'src/auth/proxy/__tests__/integration.test.ts',
      'src/auth/proxy/__tests__/migration-completeness.test.ts',
      'src/auth/proxy/__tests__/oauth-exchange.spec.ts',
      'src/auth/proxy/__tests__/oauth-initiate.spec.ts',
      'src/auth/proxy/__tests__/oauth-poll.spec.ts',
      'src/auth/proxy/__tests__/oauth-session-manager.test.ts',
      'src/auth/proxy/__tests__/platform-matrix.test.ts',
      'src/auth/proxy/__tests__/platform-uds-probe.test.ts',
      // Excluded: Bun fake-timer incompatibility on Linux CI.
      // 'src/auth/proxy/__tests__/proactive-scheduler.test.ts',
      'src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts',
      'src/auth/proxy/__tests__/refresh-coordinator.test.ts',
      'src/auth/proxy/__tests__/refresh-flow.spec.ts',
      'src/auth/runtime-accessor-bridge.spec.ts',
      'src/BaseProvider.test.ts',
      'src/chutes/usageInfo.test.ts',
      'src/composition/credentialPrecedence.test.ts',
      'src/composition/oauth-provider-registration.test.ts',
      'src/composition/provider-gemini-switching.test.ts',
      'src/composition/provider-switching.integration.test.ts',
      'src/composition/providerAliases.builtin-qwen.test.ts',
      'src/composition/providerAliases.claudecode.factory.test.ts',
      'src/composition/providerAliases.codex.factory.test.ts',
      'src/composition/providerAliases.codex.reasoningSummary.test.ts',
      'src/composition/providerAliases.codex.test.ts',
      'src/composition/providerAliases.defaultModels.test.ts',
      'src/composition/providerAliases.kimi.test.ts',
      'src/composition/providerAliases.litellm.test.ts',
      'src/composition/providerAliases.mediaSupport.test.ts',
      'src/composition/providerAliases.modelDefaults.test.ts',
      'src/composition/providerAliases.staticModels.test.ts',
      'src/composition/providerAliases.unallowedParameters.test.ts',
      'src/composition/providerManagerInstance.oauthRegistration.test.ts',
      'src/composition/providerManagerInstance.schemaDefaults.test.ts',
      'src/composition/providerManagerInstance.staticModels.test.ts',
      'src/composition/providerManagerInstance.test.ts',
      'src/composition/providerManagerUnconfigured.test.ts',
      'src/error-reauth.spec.ts',
      'src/errors.spec.ts',
      'src/fake/FakeProvider.test.ts',
      'src/gemini/__tests__/gemini.stateless.test.ts',
      'src/gemini/__tests__/gemini.thinkingLevel.test.ts',
      'src/gemini/__tests__/gemini.thoughtSignature.test.ts',
      'src/gemini/__tests__/gemini.userMemory.test.ts',
      'src/gemini/GeminiMessageConverter.test.ts',
      'src/gemini/GeminiProvider.auth.test.ts',
      'src/gemini/GeminiProvider.e2e.test.ts',
      'src/gemini/GeminiProvider.mediaBlock.test.ts',
      'src/gemini/GeminiProvider.separateDump.test.ts',
      'src/gemini/GeminiProvider.test.ts',
      'src/gemini/geminiResponseMapper.test.ts',
      'src/gemini/geminiSchemaHelpers.cycles.test.ts',
      'src/gemini/neutralConverters.property.test.ts',
      'src/gemini/neutralConverters.test.ts',
      'src/import-boundary-expectations.test.ts',
      'src/integration/multi-provider.integration.test.ts',
      'src/kimi/kimiFileUpload.test.ts',
      'src/kimi/kimiMediaProcessing.test.ts',
      'src/kimi/usageInfo.test.ts',
      'src/loadBalancing/failoverState.test.ts',
      'src/logging/conversationResponseLogger.test.ts',
      'src/logging/ProviderPerformanceTracker.test.ts',
      'src/logging/serverToolLogger.test.ts',
      'src/LoggingProviderWrapper.test.ts',
      'src/move-map-validation.test.ts',
      'src/openai-responses/__tests__/openaiResponses.stateless.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesInputBuilder.pdf.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesInputBuilder.stateful.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesInputBuilder.toolPairing.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.codex.malformedCallId.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.codex.stateless.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.ephemerals.toolOutput.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.models.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.pdf.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningEffort.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.reasoningSummary.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.stateful.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.textVerbosity.test.ts',
      'src/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts',
      'src/openai-responses/__tests__/sanitizePromptCacheKey.test.ts',
      'src/openai-responses/buildResponsesInputFromContent.mediaBlock.test.ts',
      'src/openai-responses/openAIResponsesExecutor.abort.test.ts',
      'src/openai-responses/openAIResponsesExecutor.liveness.test.ts',
      'src/openai-responses/openAIResponsesExecutor.websocket.test.ts',
      'src/openai-responses/OpenAIResponsesProvider.emptyModelFallback.test.ts',
      'src/openai-responses/OpenAIResponsesProvider.headers.test.ts',
      'src/openai-responses/OpenAIResponsesProvider.parity.test.ts',
      'src/openai-responses/OpenAIResponsesProviderCore.fetchRetry.test.ts',
      'src/openai-responses/openAIResponsesWebSocketTransport.test.ts',
      'src/openai-shared/__tests__/schemaConverter.test.ts',
      'src/openai-vercel/__tests__/schemaConverter.parameterFallback.test.ts',
      'src/openai-vercel/__tests__/vercelReasoningCapture.fieldName.test.ts',
      'src/openai-vercel/errorHandling.test.ts',
      'src/openai-vercel/messageConversion.test.ts',
      'src/openai-vercel/modelListing.test.ts',
      'src/openai-vercel/nonStreaming.config.test.ts',
      'src/openai-vercel/nonStreaming.test.ts',
      'src/openai-vercel/OpenAIVercelProvider.caching.test.ts',
      'src/openai-vercel/OpenAIVercelProvider.issue1943.test.ts',
      'src/openai-vercel/OpenAIVercelProvider.localAuth.test.ts',
      'src/openai-vercel/OpenAIVercelProvider.reasoning.test.ts',
      'src/openai-vercel/OpenAIVercelProvider.shouldRetry.test.ts',
      'src/openai-vercel/OpenAIVercelProvider.test.ts',
      'src/openai-vercel/providerRegistry.test.ts',
      'src/openai-vercel/schemaConverter.issue1844.test.ts',
      'src/openai-vercel/streaming.test.ts',
      'src/openai-vercel/vercelModelClient.localAuth.test.ts',
      'src/openai-vercel/vercelModelClient.test.ts',
      'src/openai/__tests__/formatArrayResponse.test.ts',
      'src/openai/__tests__/openai.localEndpoint.test.ts',
      'src/openai/__tests__/openai.requiresAuth.test.ts',
      'src/openai/__tests__/openai.stateless.test.ts',
      'src/openai/__tests__/OpenAIProvider.e2e.test.ts',
      'src/openai/__tests__/OpenAIProvider.thinkTags.test.ts',
      'src/openai/__tests__/schemaConverter.parameterFallback.test.ts',
      'src/openai/__tests__/ToolNameValidator.test.ts',
      'src/openai/buildResponsesRequest.stripToolCalls.test.ts',
      'src/openai/buildResponsesRequest.test.ts',
      'src/openai/buildResponsesRequest.toolIdNormalization.test.ts',
      'src/openai/buildResponsesRequest.undefined.test.ts',
      'src/openai/codexRateLimitReset.test.ts',
      'src/openai/codexUsageInfo.test.ts',
      'src/openai/ConversationCache.accumTokens.test.ts',
      'src/openai/estimateRemoteTokens.test.ts',
      'src/openai/getOpenAIProviderInfo.context.test.ts',
      'src/openai/openai-oauth.spec.ts',
      'src/openai/OpenAIApiExecution.separateDump.test.ts',
      'src/openai/OpenAIClientFactory.test.ts',
      'src/openai/openaiModelPolicy.test.ts',
      'src/openai/OpenAIProvider.caching.test.ts',
      'src/openai/OpenAIProvider.concurrentRouting.test.ts',
      'src/openai/OpenAIProvider.deepseekReasoning.test.ts',
      'src/openai/OpenAIProvider.emptyResponseRetry.conditions.test.ts',
      'src/openai/OpenAIProvider.emptyResponseRetry.test.ts',
      'src/openai/OpenAIProvider.integration.test.ts',
      'src/openai/OpenAIProvider.issue1943.test.ts',
      'src/openai/OpenAIProvider.kimiMedia.test.ts',
      'src/openai/OpenAIProvider.mediaBlock.test.ts',
      'src/openai/OpenAIProvider.mistralPayload.test.ts',
      'src/openai/OpenAIProvider.modelParamsAndHeaders.test.ts',
      'src/openai/OpenAIProvider.models.test.ts',
      'src/openai/OpenAIProvider.reasoning.test.ts',
      'src/openai/OpenAIProvider.setModel.test.ts',
      'src/openai/OpenAIProvider.shouldRetry.test.ts',
      'src/openai/OpenAIProvider.toolFormatDetection.test.ts',
      'src/openai/OpenAIProvider.toolNameErrors.test.ts',
      'src/openai/OpenAIProvider.transportRouting.test.ts',
      'src/openai/OpenAIProviders.fieldName.test.ts',
      'src/openai/OpenAIProviders.issue1844.test.ts',
      'src/openai/OpenAIRequestBuilder.test.ts',
      'src/openai/openaiRequestParams.test.ts',
      'src/openai/OpenAIRequestPreparation.issue1943.test.ts',
      'src/openai/OpenAIResponseParser.fieldName.test.ts',
      'src/openai/OpenAIResponseParser.test.ts',
      'src/openai/parseResponsesStream.issue1844.test.ts',
      'src/openai/parseResponsesStream.liveness.test.ts',
      'src/openai/parseResponsesStream.reasoning.test.ts',
      'src/openai/parseResponsesStream.responseId.test.ts',
      'src/openai/parseResponsesStream.responsesToolCalls.test.ts',
      'src/openai/parseResponsesStream.test.ts',
      'src/openai/schemaConverter.issue1844.test.ts',
      'src/openai/ToolCallCollector.test.ts',
      'src/openai/ToolCallNormalizer.test.ts',
      'src/openai/ToolCallPipeline.integration.test.ts',
      'src/openai/ToolCallPipeline.test.ts',
      'src/openai/ToolCallPipeline.toolCallId.test.ts',
      'src/openai/toolNameUtils.test.ts',
      'src/package-boundary.test.ts',
      'src/provider-content-generator-behavior.test.ts',
      'src/provider-manager-behavior.test.ts',
      'src/provider-public-api.behavior.test.ts',
      'src/ProviderContentGenerator.test.ts',
      'src/providerErrorObservation.test.ts',
      'src/providerInterface.contract.test.ts',
      'src/providerManager.context.test.ts',
      'src/ProviderManager.gemini-switch.test.ts',
      'src/ProviderManager.test.ts',
      'src/reasoning/reasoningUtils.test.ts',
      'src/retryAuthTokenResolver.test.ts',
      'src/retryConfigHandlers.test.ts',
      'src/runtime/__tests__/profileApplication.authclear.test.ts',
      'src/runtime/__tests__/profileApplication.authtiming.test.ts',
      'src/runtime/__tests__/profileApplication.basics.test.ts',
      'src/runtime/__tests__/profileApplication.bucket-failover.spec.ts',
      'src/runtime/__tests__/profileApplication.failover.test.ts',
      'src/runtime/__tests__/profileApplication.lb.authkey.test.ts',
      'src/runtime/__tests__/profileApplication.lb.detection.test.ts',
      'src/runtime/__tests__/profileApplication.unavailableProvider.test.ts',
      'src/runtime/__tests__/profileApplication.workflow.test.ts',
      'src/runtime/__tests__/profileSnapshot.loadBalancerSave.test.ts',
      'src/runtime/__tests__/provider-context-preservation.spec.ts',
      'src/runtime/__tests__/providerManagerAdoption.behavior.test.ts',
      'src/runtime/anthropic-oauth-defaults.test.ts',
      'src/runtime/assembleCliProviderRuntime.identity.test.ts',
      'src/runtime/assembleCliProviderRuntime.test.ts',
      'src/runtime/bucketFailover.test.ts',
      'src/runtime/cliEphemeralSettings.test.ts',
      'src/runtime/ephemeralSettings.mediaPdf.test.ts',
      'src/runtime/ephemeralSettings.reasoningSummary.test.ts',
      'src/runtime/ephemeralSettings.textVerbosity.test.ts',
      'src/runtime/explicitRuntimeId.behavior.test.ts',
      'src/runtime/isolatedRuntimeDefaultPointer.behavior.test.ts',
      'src/runtime/modelParamParser.test.ts',
      'src/runtime/profile-application/profileAccessors.spec.ts',
      'src/runtime/profileApplication.spec.ts',
      'src/runtime/profileSnapshot.test.ts',
      'src/runtime/provider-alias-defaults.modeldefaults.test.ts',
      'src/runtime/provider-alias-defaults.propagation.test.ts',
      'src/runtime/provider-alias-defaults.switch.test.ts',
      'src/runtime/providerConfigUtils.test.ts',
      'src/runtime/providerManagerInstance.messagebus.test.ts',
      'src/runtime/providerManagerRuntimeFactories.test.ts',
      'src/runtime/providerMutations.issue1943.test.ts',
      'src/runtime/providerMutations.spec.ts',
      'src/runtime/providerSwitch.spec.ts',
      'src/runtime/runtime-oauth-messagebus.test.ts',
      'src/runtime/runtimeAccessors.spec.ts',
      'src/runtime/runtimeContextFactory.messageBus.test.ts',
      'src/runtime/runtimeContextFactory.setRuntimeContext.test.ts',
      'src/runtime/runtimeIdentityResolution.behavior.test.ts',
      'src/runtime/runtimeLifecycle.spec.ts',
      'src/runtime/runtimeRegistry.spec.ts',
      'src/runtime/runtimeSettings.proactive-wiring.lb.spec.ts',
      'src/runtime/runtimeSettings.proactive-wiring.spec.ts',
      'src/runtime/runtimeSettings.reasoningSummary.test.ts',
      'src/runtime/runtimeSettings.spec.ts',
      'src/runtime/statelessHardening.spec.ts',
      'src/synthetic/usageInfo.test.ts',
      'src/tokenizer-behavior.test.ts',
      'src/tokenizers/Gpt56O200kPromptEstimator.test.ts',
      'src/tokenizers/Gpt56ProviderUsageParity.test.ts',
      'src/tokenizers/official/assetLoader.test.ts',
      'src/tokenizers/official/officialTokenizers.test.ts',
      'src/tokenizers/official/offlineAssets.test.ts',
      'src/tokenizers/official/providerFramingSeparation.test.ts',
      'src/utils/cacheMetricsExtractor.test.ts',
      'src/utils/containerSandbox.test.ts',
      'src/utils/contentPreview.test.ts',
      'src/utils/dumpContext.separateFiles.test.ts',
      'src/utils/dumpContext.test.ts',
      'src/utils/dumpSDKContext.test.ts',
      'src/utils/mediaUtils.test.ts',
      'src/utils/qwenEndpoint.test.ts',
      'src/utils/retryStrategy.test.ts',
      'src/utils/textSanitizer.test.ts',
      'src/utils/thinkingExtraction.test.ts',
      'src/utils/toolFormatDetection.issue1943.test.ts',
      'src/utils/toolFormatDetection.test.ts',
      'src/utils/toolNameNormalization.test.ts',
      'src/utils/toolResponsePayload.test.ts',
      'src/zai/usageInfo.test.ts',
    ],
  },
  {
    workspace: 'storage',
    preload: 'test-setup-storage-isolation.ts',
    files: [
      'test-bun/credential-write-lock.bun.ts',
      'test-bun/keyring-write-verification.bun.ts',
      'test-bun/machine-secret.bun.ts',
      'test-bun/machine-secret.concurrent-write.bun.ts',
      'test-bun/secure-store.bun.ts',
      'test-bun/secure-store.concurrent-write.bun.ts',
      'test-bun/storage.bun.ts',
    ],
  },
  {
    workspace: 'tools',
    files: ['test-bun/language-analysis.followup.bun.ts'],
  },
  {
    workspace: 'telemetry',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'test-setup-storage-isolation.ts',
    ],
    include: ['src/**/*.test.ts'],
  },
  {
    workspace: 'test-utils',
    preload: ['../../test-setup/augment-bun-vi.ts'],
    include: ['src/**/*.test.ts'],
  },
  {
    workspace: 'settings',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'test-setup-storage-isolation.ts',
    ],
    include: ['src/**/*.test.ts'],
  },
  {
    workspace: 'ide-integration',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'test-setup-storage-isolation.ts',
      'test-setup.ts',
    ],
    include: ['src/**/*.test.ts'],
  },
  {
    // `vscode` is injected by the editor host and cannot be resolved outside
    // it, so a test-only tsconfig maps the specifier at a stub the per-file
    // `vi.mock('vscode', …)` factories then replace.
    workspace: 'vscode-ide-companion',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'test-setup-storage-isolation.ts',
    ],
    tsconfig: 'tsconfig.bun-test.json',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
  {
    workspace: 'policy',
    preload: ['../../test-setup/augment-bun-vi.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['src/research/**'],
  },
  {
    workspace: 'test-setup',
    cwd: '.',
    files: [
      'test-setup/augment-bun-vi.test.ts',
      'test-setup/stub-helpers.bun.test.ts',
    ],
  },
  {
    // The whole script harness. Previously split into several curated roots
    // (acplint, scripts-pr-review, scripts-ocr-review, issue-planner-*) while
    // the rest of the directory still belonged to Vitest; now that Vitest no
    // longer runs this tree, one glob root covers every file — including the
    // `*.bun.test.ts` files that were always Bun-only.
    workspace: 'scripts-tests',
    cwd: '.',
    preload: ['test-setup/augment-bun-vi.ts', 'scripts/tests/test-setup.ts'],
    include: ['scripts/tests/**/*.test.ts', 'scripts/tests/**/*.test.js'],
    exclude: [`scripts/tests/${SLOW_SCRIPTS_TEST}`],
  },
  {
    // The release-install smoke packs a CLI tarball and runs three npm
    // installs, so it needs a far larger budget than the rest of the harness.
    // It is a separate root so the ordinary script tests keep a tight timeout
    // that still catches genuine hangs.
    workspace: 'scripts-tests-slow',
    cwd: '.',
    preload: ['test-setup/augment-bun-vi.ts', 'scripts/tests/test-setup.ts'],
    files: [`scripts/tests/${SLOW_SCRIPTS_TEST}`],
    timeout: 300_000,
  },
  {
    workspace: 'evals',
    cwd: 'evals',
    preload: ['../test-setup/augment-bun-vi.ts'],
    include: ['**/*.eval.ts'],
    globalSetup: 'globalSetup.ts',
    timeout: 300_000,
    credentialed: true,
  },
  {
    // End-to-end tests against a real provider: long per-test budget, a
    // global setup that isolates storage roots for every spawned CLI, and a
    // retry budget mirroring the Vitest config these replaced.
    workspace: 'integration-tests',
    cwd: 'integration-tests',
    preload: ['../test-setup/augment-bun-vi.ts', 'setup-quota-guard.ts'],
    include: ['**/*.test.ts'],
    globalSetup: 'globalSetup.ts',
    timeout: 300_000,
    retries: 2,
    credentialed: true,
  },
];

/**
 * Resolves the working directory for a workspace entry.
 *
 * - When `cwd` is `undefined`, the workspace name is resolved under
 *   `packages/` (e.g. `packages/core`).
 * - When `cwd` is an empty string, the repo root itself is used.
 * - When `cwd` is a non-empty string, it is joined under the repo root.
 *
 * Using `cwd !== undefined` (not truthiness) ensures an empty string
 * correctly means the repo root rather than falling through to the
 * `packages/` default.
 */
export function resolveWorkspaceCwd(
  repoRoot: string,
  workspace: string,
  cwd: string | undefined,
): string {
  if (cwd === undefined) {
    return join(repoRoot, 'packages', workspace);
  }
  return join(repoRoot, cwd);
}

/**
 * Expands one manifest entry into its relative test-file list.
 *
 * `files` is returned verbatim (curated set). `include` is expanded through
 * the injected glob and then filtered by `exclude`, mirroring how a Vitest
 * config's include/exclude pair selects files. Declaring both, or neither, is
 * a manifest authoring error and fails loudly rather than silently running a
 * partial set.
 */
export function resolveEntryFileNames(
  entry: BunTestWorkspaceEntry,
  resolvedCwd: string,
  dependencies: BunManifestDependencies,
): readonly string[] {
  const { workspace, files, include, exclude } = entry;
  if (files !== undefined && include !== undefined) {
    throw new Error(
      `Bun native test manifest entry "${workspace}" declares both "files" and "include"; choose one.`,
    );
  }
  if (files !== undefined) {
    return files;
  }
  if (include === undefined) {
    throw new Error(
      `Bun native test manifest entry "${workspace}" declares neither "files" nor "include".`,
    );
  }
  const excluded = new Set(
    (exclude ?? []).flatMap((pattern) =>
      dependencies.glob(pattern, resolvedCwd),
    ),
  );
  const selected = new Set(
    include.flatMap((pattern) => dependencies.glob(pattern, resolvedCwd)),
  );
  const remaining = [...selected].filter((file) => !excluded.has(file)).sort();
  if (remaining.length === 0) {
    throw new Error(
      `Bun native test manifest entry "${workspace}" matched no test files under ${resolvedCwd}.`,
    );
  }
  return remaining;
}

function toPreloadList(
  preload: string | readonly string[] | undefined,
): readonly string[] {
  if (preload === undefined) {
    return [];
  }
  return typeof preload === 'string' ? [preload] : preload;
}

/**
 * Decides whether a root participates in this run.
 *
 * A named filter selects exactly that root, credentialed or not. An
 * unfiltered run covers every root that does not require provider
 * credentials, so the ordinary gate stays complete without burning quota.
 */
export function selectsEntry(
  entry: BunTestWorkspaceEntry,
  workspaceFilter: string | undefined,
): boolean {
  if (workspaceFilter !== undefined) {
    return entry.workspace === workspaceFilter;
  }
  return entry.credentialed !== true;
}

export function resolveBunNativeTestFiles(
  repoRoot: string,
  workspaceFilter?: string,
  dependencies: BunManifestDependencies = defaultManifestDependencies,
): BunTestFile[] {
  const files = BUN_NATIVE_TEST_MANIFEST.filter((entry) =>
    selectsEntry(entry, workspaceFilter),
  ).flatMap((entry) => resolveManifestEntry(entry, repoRoot, dependencies));
  validateResolvedFiles(files, dependencies);
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

function resolveManifestEntry(
  entry: BunTestWorkspaceEntry,
  repoRoot: string,
  dependencies: BunManifestDependencies,
): BunTestFile[] {
  const resolvedCwd = resolveWorkspaceCwd(repoRoot, entry.workspace, entry.cwd);
  const resolvedPreloads = toPreloadList(entry.preload).map((preload) =>
    join(resolvedCwd, preload),
  );
  return resolveEntryFileNames(entry, resolvedCwd, dependencies).map(
    (file) => ({
      cwd: resolvedCwd,
      file: join(resolvedCwd, file),
      preloads: resolvedPreloads,
      tsconfig:
        entry.tsconfig !== undefined
          ? join(resolvedCwd, entry.tsconfig)
          : undefined,
      timeout: entry.timeout,
      retries: entry.retries,
      globalSetup:
        entry.globalSetup !== undefined
          ? join(resolvedCwd, entry.globalSetup)
          : undefined,
    }),
  );
}
