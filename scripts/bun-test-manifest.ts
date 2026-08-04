/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS_MANIFEST_ENTRY } from './bun-test-manifest-data-tools.ts';
import { MCP_MANIFEST_ENTRY } from './bun-test-manifest-data-mcp.ts';
import { STORAGE_MANIFEST_ENTRY } from './bun-test-manifest-data-storage.ts';

export interface BunTestWorkspaceEntry {
  readonly workspace: string;
  readonly files: readonly string[];
  /**
   * Optional explicit working directory override. When omitted, the workspace
   * name is resolved under `packages/` (e.g. `packages/core`). When set, this
   * path is used as the cwd and file resolution root.
   */
  readonly cwd?: string;
  /**
   * Optional Bun `--preload` script path (relative to the workspace cwd) run
   * before any test module is imported. Used by workspaces whose tests must
   * isolate global state (e.g. Storage roots) before test modules import the
   * singleton — `bun test` does not run Vitest `setupFiles`, so a preload is
   * the only way to guarantee ordering under Bun.
   */
  readonly preload?: string;
}

export interface BunTestFile {
  readonly file: string;
  readonly cwd: string;
  /**
   * Resolved absolute preload path for this file's workspace, or undefined
   * when the workspace declares no preload. Passed to `bun test --preload`.
   */
  readonly preload?: string;
}

export interface BunManifestDependencies {
  stat(path: string): { isFile(): boolean };
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
};

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

/** Files that have been explicitly verified with Bun's native test runner. */
export const BUN_NATIVE_TEST_MANIFEST: readonly BunTestWorkspaceEntry[] = [
  {
    workspace: 'a2a-server',
    preload: 'bun-preload-storage-isolation.ts',
    files: [
      'src/storage-isolation.bun.test.ts',
      'src/agent/task-support.test.ts',
      'src/agent/task.neutral-continuation.test.ts',
      'src/agent/task.test.ts',
      'src/agent/task.factory-migration.integration.test.ts',
      'src/commands/command-registry.test.ts',
      'src/commands/extensions.test.ts',
      'src/commands/init.test.ts',
      'src/commands/restore.test.ts',
      'src/config/config.test.ts',
      'src/config/config.factory-migration.test.ts',
      'src/http/app.test.ts',
      'src/http/endpoints.test.ts',
      'src/persistence/gcs.test.ts',
      'src/utils/testing_utils.test.ts',
    ],
  },
  {
    workspace: 'agents',
    files: [
      'src/core/CompressionProfileResolver.proxyKeyStorage.test.ts',
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
      'src/utils/sandbox-containers.test.ts',
      // Sandbox SSH agent preflight (issue #1699). Bun-native from the start
      // and likewise excluded from the Vitest selection.
      'src/utils/sandbox-ssh-agent-preflight.test.ts',
      'src/zed-integration/zed-session-lifecycle.test.ts',
      'test-bun/iContentToHistoryItems.issue2511.bun.ts',
      'src/ui/commands/authCommand.loginWithBucket.issue2891.test.ts',
      'test-utils/augment-bun-vi-cleanup.bun.ts',
      // Issue #2951: Windows Ctrl+Enter steering. Each file pins
      // process.platform at the very top before the key-matcher module graph
      // loads, so win32 and darwin must run in separate processes.
      'test-bun/steerKey.win32.bun.ts',
      'test-bun/steerKey.darwin.bun.ts',
      'test-bun/resolveKeyBindings.bun.ts',
      'test-bun/keypressLineFeed.bun.ts',
    ],
  },
  {
    workspace: 'cli',
    preload: 'bun-test-setup.ts',
    files: [
      'src/ui/hooks/agentStream/__tests__/useAgentEventStream.bun.tsx',
      'src/ui/hooks/agentStream/__tests__/useAgentStreamOrchestration.terminal.bun.tsx',
      'src/ui/hooks/agentStream/__tests__/useSubmitQuery.doublecancel.bun.tsx',
      'src/ui/hooks/agentStream/__tests__/useSubmitQuery.terminalError.bun.tsx',
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
      'src/__tests__/BaseProvider.proxyKeyStorage.test.ts',
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
      'src/__tests__/RetryOrchestrator.forbidden.test.ts',
      'src/__tests__/RetryOrchestrator.forbidden-composed.test.ts',
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
      'test-bun/token-access-coordinator.bun.ts',
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
      'src/auth/__tests__/issue2891-claudecode-stale-oauth.test.ts',
      'src/auth/__tests__/issue2891-oauth-manager-identity.test.ts',
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
      'src/composition/__tests__/issue2891-oauth-provider-registration.test.ts',
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
      'src/loadBalancing/loadBalancerTokenEstimator.imageTokens.test.ts',
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
      'src/runtime/__tests__/issue2891-lazy-oauth-gating.test.ts',
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
      'src/tokenizers/claude/claudeCalibration.test.ts',
      'src/tokenizers/claude/claudeCalibrationGate.test.ts',
      'src/tokenizers/claude/claudeContentFeatures.test.ts',
      'src/tokenizers/claude/claudeModelIdentity.test.ts',
      'src/tokenizers/claude/claudePromptEstimator.test.ts',
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
  TOOLS_MANIFEST_ENTRY,
  MCP_MANIFEST_ENTRY,
  {
    workspace: 'telemetry',
    preload: 'test-setup-storage-isolation.ts',
    files: [
      'src/debug/ConfigurationManager.test.ts',
      'src/debug/DebugLogger.test.ts',
      'src/debug/FileOutput.test.ts',
      'src/telemetry/canonicalConsumer.behavior.test.ts',
      'src/telemetry/events/api-events.neutral.test.ts',
      'src/telemetry/loggers.localAggregation.test.ts',
      'src/telemetry/metrics.test.ts',
      'src/telemetry/sessionMetricsAggregator.advanced.test.ts',
      'src/telemetry/sessionMetricsAggregator.test.ts',
      'src/telemetry/tool-call-decision.test.ts',
      'src/telemetry/types.test.ts',
    ],
  },
  STORAGE_MANIFEST_ENTRY,
  {
    workspace: 'test-utils',
    files: ['src/quota-guard.test.ts', 'src/util.test.ts'],
  },
  {
    workspace: 'acplint',
    cwd: '.',
    files: [
      'scripts/tests/ci-acplint-workflow.test.ts',
      'scripts/tests/validate-acplint-report.test.ts',
    ],
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
    // Bun-native assignment lifecycle tests for issue #2833. These execute the
    // REAL bash assignment scripts against fake-gh; vitest skips
    // `*.bun.test.ts`, so they run only under Bun's native runner here.
    workspace: 'scripts-assignment',
    cwd: '.',
    files: [
      'scripts/tests/assign-remediation8b.bun.test.ts',
      'scripts/tests/assign-remediation11.bun.test.ts',
    ],
  },
  {
    // Bun-native tests for the PR-review Mermaid sanitizer (issue #2944).
    // Vitest skips `*.bun.test.ts`; these run under Bun's native runner only.
    workspace: 'scripts-pr-review',
    cwd: '.',
    files: ['scripts/tests/pr-review-walkthrough-sanitize.bun.test.ts'],
  },
  {
    // Bun-native tests for the OCR review workflow preview parser and
    // docs-only classification (issue #2824). Vitest skips `*.bun.test.ts`;
    // these run under Bun's native runner only.
    workspace: 'scripts-ocr-review',
    cwd: '.',
    files: [
      'scripts/tests/ocr-canary-embedding.bun.test.ts',
      'scripts/tests/ocr-canary-metrics.bun.test.ts',
      'scripts/tests/ocr-review-422-grouping.bun.test.ts',
      'scripts/tests/ocr-review-422-wiring.bun.test.ts',
      'scripts/tests/ocr-review-context.bun.test.ts',
      'scripts/tests/ocr-review-coverage-preview.bun.test.ts',
      'scripts/tests/ocr-review-github-script-syntax.bun.test.ts',
      'scripts/tests/ocr-review-incremental-checkpoint-b.bun.test.ts',
      'scripts/tests/ocr-review-workflow.bun.test.ts',
    ],
  },
  {
    // Bun-native regression test for the issue-planner filesystem-confinement
    // step (issue #2960): vitest skips `*.bun.test.ts`; this runs under Bun's
    // native runner only.
    workspace: 'issue-planner-confinement',
    cwd: '.',
    files: ['scripts/tests/issue-planner-confinement.bun.test.ts'],
  },
  {
    // Bun-native tests for the issue-planner advisory-enrichment non-fatality
    // guards (umbrella #2984): vitest skips `*.bun.test.ts`; this runs under
    // Bun's native runner only.
    workspace: 'issue-planner-enrichment',
    cwd: '.',
    files: ['scripts/tests/issue-planner-enrichment.bun.test.ts'],
  },
  {
    // Bun-native tests for the macOS system-Bun launcher preference (#2962).
    // Vitest skips `*.bun.test.ts`; these run under Bun's native runner only.
    workspace: 'scripts-launcher',
    cwd: '.',
    files: [
      'scripts/tests/issue-2603-launcher.bun.test.ts',
      'scripts/tests/issue-2962-system-bun-preference.bun.test.ts',
    ],
  },
  {
    // Bun-native test for the prebuilt CLI bundle (issue #2999). Builds the
    // bundle via the exported config, executes it, and asserts --version
    // output, proving externals resolve and the artifact is genuinely
    // launchable. Gated behind LLXPRT_RUN_BUNDLE_BUILD_TEST=1 because the
    // ~16s build is too slow for the default PR-path shard. The nightly
    // `cli_bundle_launch` job sets the flag, so externals drift is caught
    // daily rather than by a user whose CLI stops starting.
    workspace: 'cli-bundle',
    cwd: '.',
    files: ['scripts/tests/issue-2999-cli-bundle.bun.test.ts'],
  },
  {
    workspace: 'scripts-manifest',
    cwd: '.',
    files: ['scripts/tests/bun-test-manifest.bun.test.ts'],
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

export function resolveBunNativeTestFiles(
  repoRoot: string,
  workspaceFilter?: string,
  dependencies: BunManifestDependencies = defaultManifestDependencies,
): BunTestFile[] {
  const files = BUN_NATIVE_TEST_MANIFEST.filter(
    ({ workspace }) => !workspaceFilter || workspace === workspaceFilter,
  ).flatMap(({ workspace, files, cwd, preload }) => {
    const resolvedCwd = resolveWorkspaceCwd(repoRoot, workspace, cwd);
    const resolvedPreload =
      preload !== undefined ? join(resolvedCwd, preload) : undefined;
    return files.map((file) => ({
      cwd: resolvedCwd,
      file: join(resolvedCwd, file),
      preload: resolvedPreload,
    }));
  });
  const missingFiles: string[] = [];
  const nonFiles: string[] = [];
  for (const { file } of files) {
    try {
      if (!dependencies.stat(file).isFile()) {
        nonFiles.push(file);
      }
    } catch (error: unknown) {
      const code = getErrorCode(error);
      if (code === 'ENOENT') {
        missingFiles.push(file);
      } else {
        throw new BunManifestStatError(file, code, error);
      }
    }
  }
  // Validate declared preload scripts exist (deduplicated — one per workspace).
  const preloadPaths = new Set<string>();
  for (const { preload } of files) {
    if (preload !== undefined) {
      preloadPaths.add(preload);
    }
  }
  for (const preload of preloadPaths) {
    try {
      if (!dependencies.stat(preload).isFile()) {
        throw new BunManifestStatError(
          preload,
          undefined,
          new Error('not a file'),
        );
      }
    } catch (error: unknown) {
      if (error instanceof BunManifestStatError) {
        throw error;
      }
      const code = getErrorCode(error);
      if (code === 'ENOENT') {
        throw new Error(
          `Bun native test manifest declares a missing preload: ${preload}`,
        );
      }
      throw new BunManifestStatError(preload, code, error);
    }
  }
  if (missingFiles.length > 0) {
    throw new Error(
      `Bun native test manifest contains missing files:\n${missingFiles
        .map((file) => `  - ${file}`)
        .join('\n')}`,
    );
  }
  if (nonFiles.length > 0) {
    throw new Error(
      `Bun native test manifest contains non-files:\n${nonFiles
        .map((file) => `  - ${file}`)
        .join('\n')}`,
    );
  }
  return files.sort((left, right) => left.file.localeCompare(right.file));
}
