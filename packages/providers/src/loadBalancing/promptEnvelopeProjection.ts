/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { ProviderManager } from '../ProviderManager.js';
import type { CircuitBreakerManager } from './circuitBreakerManager.js';
import type { FailoverState } from './failoverState.js';
import type { TPMTracker } from './tpmTracker.js';
import { resolveMemberAuthentication } from './memberAuthentication.js';
import { optionsWithSelectedModelPrompt } from './selectedModelPrompt.js';
import { resolveSubProfileModel } from './subProfileHelpers.js';
import type {
  LoadBalancerSubProfile,
  LoadBalancingProviderConfig,
  ResolvedSubProfile,
} from './loadBalancerTypes.js';

export type { PromptEnvelopeProjection };

const projectionLogger = new DebugLogger(
  'llxprt:providers:load-balancer:projection',
);

/**
 * Project the NEXT sub-profile's prompt envelope as an estimate-only value
 * for tool-aware pre-send estimation (issue #3507).
 *
 * Estimation policy: the projection is a peek, not a send. It forecasts the
 * envelope the next send would transmit (tool schemas included) without
 * consuming selection state, so pre-send enforcement can act on the real
 * envelope size. For failover, the peek mirrors the send path's backend
 * skip policy eligibility-aware (PR #3715): it traverses the circle from
 * the failover start index and targets the FIRST member the injected
 * eligibility predicate accepts — a pure, non-mutating read (circuit
 * breaker + TPM), so the peek cannot steal half-open recovery probes from
 * the subsequent send. When every member is ineligible the start-index
 * member is projected anyway: this seam is estimate-only and never throws;
 * the send path's all-unhealthy error remains the send path's business.
 * The round-robin peek ignores eligibility entirely (the round-robin send
 * path is a pure rotation). In all modes the send-time guard re-estimates
 * authoritatively; rotation drift between peek and send simply degrades to
 * today's guard behavior.
 *
 * Resolves `undefined` when the delegate provider is missing or cannot
 * project — capability unavailability is never an error at this seam.
 */
export async function projectNextSubProfilePromptEnvelope(input: {
  readonly config: LoadBalancingProviderConfig;
  readonly providerManager: ProviderManager;
  readonly failoverState: FailoverState;
  readonly roundRobinIndex: number;
  /**
   * Failover-only eligibility predicate (PR #3715): a non-mutating
   * equivalent of the send path's skip check. Consulted for failover
   * peeks only; the round-robin peek never calls it.
   */
  readonly isBackendEligible: (name: string) => boolean;
  readonly buildDelegateResolvedOptions: (
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
  ) => GenerateChatOptions;
  readonly options: GenerateChatOptions;
}): Promise<PromptEnvelopeProjection | undefined> {
  const subProfile =
    input.config.strategy === 'failover'
      ? selectEligibleFailoverMember(
          input.config.subProfiles,
          input.failoverState.getIndex(),
          input.isBackendEligible,
        )
      : input.config.subProfiles[input.roundRobinIndex];
  const delegateProvider = input.providerManager.getProviderByName(
    subProfile.providerName,
  );
  if (delegateProvider?.projectPromptEnvelope === undefined) {
    return undefined;
  }
  const targetOptions = await optionsWithSelectedModelPrompt(
    input.options,
    subProfile.providerName,
    resolveSubProfileModel(subProfile),
  );
  const authenticatedSubProfile = await resolveMemberAuthentication(
    subProfile,
    projectionLogger,
  );
  const resolvedOptions = input.buildDelegateResolvedOptions(
    authenticatedSubProfile,
    targetOptions,
  );
  const delegateProjection =
    await delegateProvider.projectPromptEnvelope(resolvedOptions);
  if (delegateProjection === undefined) {
    return undefined;
  }
  return toEstimateOnlyPromptEnvelopeProjection(delegateProjection);
}

/**
 * Pick the failover peek target (PR #3715): traverse the circle from the
 * failover start index and return the FIRST member the eligibility
 * predicate accepts — the non-mutating mirror of the send path's circular
 * skip traversal, which claims the start index and skips circuit-open or
 * TPM-ineligible backends. When no member is eligible, fall back to the
 * start-index member: the estimate-only seam never throws, and the send
 * path keeps sole authority over the all-unhealthy error. The failover
 * state is only read here (getIndex); no claim, advance, or owner change.
 */
function selectEligibleFailoverMember(
  subProfiles: ReadonlyArray<ResolvedSubProfile | LoadBalancerSubProfile>,
  startIndex: number,
  isBackendEligible: (name: string) => boolean,
): ResolvedSubProfile | LoadBalancerSubProfile {
  for (let offset = 0; offset < subProfiles.length; offset++) {
    const candidate = subProfiles[(startIndex + offset) % subProfiles.length];
    if (isBackendEligible(candidate.name)) {
      return candidate;
    }
  }
  return subProfiles[startIndex];
}

/**
 * Peek leases still owned by an unsent estimate-only projection, keyed by the
 * projection's own transport token. The load balancer's send path takes the
 * token off its incoming options and discharges the lease through
 * {@link releaseEstimateOnlyPromptEnvelope}.
 */
const peekLeasesByToken = new WeakMap<object, () => Promise<void>>();

/**
 * Wrap a delegate projection as an estimate-only projection (issue #3507).
 *
 * The wrapper keeps the delegate's request-scoped resources alive: the
 * estimation fields read through to the delegate projection, so a
 * source-backed projection or an on-demand SDK body stays readable until the
 * peek owner releases it (issue #854). Copying those references and
 * releasing first would hand callers a disposed projection. The wrapper
 * carries a fresh frozen transport token instead of the delegate's
 * reservation, and `releaseIfUnsent` discharges the delegate lease exactly
 * once. A successful send never calls it, so the token is also registered
 * for {@link releaseEstimateOnlyPromptEnvelope}. A failing release
 * propagates: resource-accounting bugs fail fast.
 */
export function toEstimateOnlyPromptEnvelopeProjection(
  delegateProjection: PromptEnvelopeProjection,
): PromptEnvelopeProjection {
  const transportToken = Object.freeze({});
  let release: Promise<void> | undefined;
  const releaseOnce = (): Promise<void> => {
    release ??= Promise.resolve().then(() =>
      delegateProjection.releaseIfUnsent?.(),
    );
    return release;
  };
  peekLeasesByToken.set(transportToken, releaseOnce);
  return Object.freeze({
    model: delegateProjection.model,
    protocol: delegateProjection.protocol,
    method: delegateProjection.method,
    projectionRevision: delegateProjection.projectionRevision,
    unsupportedMedia: delegateProjection.unsupportedMedia,
    ...(delegateProjection.accounting === undefined
      ? {}
      : { accounting: delegateProjection.accounting }),
    // On-demand delegates build their graph per access; keep that laziness.
    get finalizedProjection() {
      return delegateProjection.finalizedProjection;
    },
    legacyEstimate: () => delegateProjection.legacyEstimate(),
    transportToken,
    releaseIfUnsent: releaseOnce,
  });
}

/**
 * Discharge the peek lease behind a transport token handed out by
 * {@link toEstimateOnlyPromptEnvelopeProjection}. The load balancer re-projects
 * the member it actually selects, so once its send starts the peek is spent.
 * Tokens that are not peek tokens, and already released peeks, are no-ops.
 */
export async function releaseEstimateOnlyPromptEnvelope(
  transportToken: object | undefined,
): Promise<void> {
  if (transportToken === undefined) return;
  await peekLeasesByToken.get(transportToken)?.();
}

/**
 * Wire the load-balancer's runtime collaborators into the envelope
 * projection (PR #3715): composes the failover eligibility predicate from
 * the circuit breaker and TPM tracker exactly as the send path's skip
 * policy — both non-mutating reads, so the peek never steals a half-open
 * recovery probe. The caller performs the single failover-settings read
 * per projection and supplies the resulting TPM threshold; the predicate
 * closes over that threshold instead of re-extracting it per member.
 */
export async function projectLoadBalancerPromptEnvelope(input: {
  readonly config: LoadBalancingProviderConfig;
  readonly providerManager: ProviderManager;
  readonly failoverState: FailoverState;
  readonly roundRobinIndex: number;
  readonly circuitBreaker: Pick<CircuitBreakerManager, 'canAttemptBackend'>;
  readonly tpmTracker: Pick<TPMTracker, 'shouldSkipOnTPM'>;
  readonly tpmThreshold: number | undefined;
  readonly buildDelegateResolvedOptions: (
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
  ) => GenerateChatOptions;
  readonly options: GenerateChatOptions;
}): Promise<PromptEnvelopeProjection | undefined> {
  return projectNextSubProfilePromptEnvelope({
    config: input.config,
    providerManager: input.providerManager,
    failoverState: input.failoverState,
    roundRobinIndex: input.roundRobinIndex,
    isBackendEligible: (name) =>
      input.circuitBreaker.canAttemptBackend(name) &&
      !input.tpmTracker.shouldSkipOnTPM(name, input.tpmThreshold),
    buildDelegateResolvedOptions: input.buildDelegateResolvedOptions,
    options: input.options,
  });
}
