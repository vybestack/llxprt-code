/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { LoadBalancingProviderConfig } from './loadBalancerTypes.js';
import { isResolvedSubProfile } from './loadBalancerTypes.js';
import { resolveSubProfileModel } from './subProfileHelpers.js';

export function defaultLoadBalancerModel(
  config: LoadBalancingProviderConfig,
): string {
  const first = config.subProfiles[0];
  return isResolvedSubProfile(first) ? first.model : (first.modelId ?? '');
}

export function currentLoadBalancerModel(
  config: LoadBalancingProviderConfig,
  selectedName: string | null,
): string {
  const selected = config.subProfiles.find(
    (candidate) => candidate.name === selectedName,
  );
  return selected
    ? resolveSubProfileModel(selected)
    : defaultLoadBalancerModel(config);
}

export function selectedLoadBalancerBaseUrl(
  config: LoadBalancingProviderConfig,
  selectedName: string | null,
): string | undefined {
  if (!selectedName) return undefined;
  return config.subProfiles.find((candidate) => candidate.name === selectedName)
    ?.baseURL;
}

/**
 * Notify the rest of the app that the active sub-profile changed so the
 * status footer can recompute the load-balancer identity
 * (`lb:<lb>:<sub>:<model>`). This emits a dedicated
 * LoadBalancerSelectionChanged event (NOT ModelChanged): a sub-profile
 * rotation is a UI-refresh trigger, not an actual model switch, so it must
 * not be conflated with real model changes by other subscribers.
 */
export function emitLoadBalancerSelection(
  config: LoadBalancingProviderConfig,
  name: string,
  logger: DebugLogger,
): void {
  try {
    const selected = config.subProfiles.find(
      (candidate) => candidate.name === name,
    );
    coreEvents.emitLoadBalancerSelectionChanged({
      profileName: config.profileName,
      subProfileName: name,
      model: selected ? resolveSubProfileModel(selected) : null,
    });
  } catch (error) {
    logger.debug(
      () => `Failed to emit load-balancer selection trigger: ${error}`,
    );
  }
}
