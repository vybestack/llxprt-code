/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { ProviderManager } from '../ProviderManager.js';
import type { FailoverState } from './failoverState.js';
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
 * envelope size. The send-time guard re-estimates authoritatively; rotation
 * drift between peek and send simply degrades to today's guard behavior.
 *
 * Resolves `undefined` when the delegate provider is missing or cannot
 * project — capability unavailability is never an error at this seam.
 */
export async function projectNextSubProfilePromptEnvelope(input: {
  readonly config: LoadBalancingProviderConfig;
  readonly providerManager: ProviderManager;
  readonly failoverState: FailoverState;
  readonly roundRobinIndex: number;
  readonly buildDelegateResolvedOptions: (
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
  ) => GenerateChatOptions;
  readonly options: GenerateChatOptions;
}): Promise<PromptEnvelopeProjection | undefined> {
  const subProfile =
    input.config.strategy === 'failover'
      ? input.config.subProfiles[input.failoverState.getIndex()]
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
 * Wrap a delegate projection as an estimate-only projection (issue #3507):
 * the estimation fields are inert snapshots, so the delegate's
 * request-scoped resources are released eagerly within the call and the
 * wrapper carries a fresh frozen transport token instead of the delegate's
 * reservation (the send-time guard overwrites
 * `promptEnvelopeTransportToken` with its own projection, so forwarding the
 * delegate token would leak its media reservation on successful sends).
 * A failing release propagates: resource-accounting bugs fail fast.
 */
export async function toEstimateOnlyPromptEnvelopeProjection(
  delegateProjection: PromptEnvelopeProjection,
): Promise<PromptEnvelopeProjection> {
  // Copy every estimation field before awaiting the release: once the
  // delegate's request-scoped resources are discharged, no field of the
  // delegate projection may be read. Destructuring first makes that
  // ordering structural.
  const {
    model,
    protocol,
    method,
    projectionRevision,
    unsupportedMedia,
    accounting,
    finalizedProjection,
    legacyEstimate,
  } = delegateProjection;
  await delegateProjection.releaseIfUnsent?.();
  return {
    model,
    protocol,
    method,
    projectionRevision,
    unsupportedMedia,
    ...(accounting === undefined ? {} : { accounting }),
    finalizedProjection,
    legacyEstimate,
    transportToken: Object.freeze({}),
  };
}
