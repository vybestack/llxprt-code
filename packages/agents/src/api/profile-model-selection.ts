/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  isLoadBalancerProfile,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import {
  getProfileModel,
  getProfileProvider,
} from './profile-application/profileAccessors.js';

export function resolveRequestedModel(
  sanitizedProfile: Profile,
  actualProfile: Profile,
  providerRecord: { getDefaultModel?: () => string } | null | undefined,
  selection: { readModel: () => string | undefined },
  providerManager: Pick<RuntimeProviderManager, 'getActiveProvider'>,
): string {
  if (isLoadBalancerProfile(actualProfile)) {
    return 'load-balancer';
  }
  const requestedModel = getProfileModel(sanitizedProfile).trim();
  const fallbackModel =
    providerRecord?.getDefaultModel?.() ??
    selection.readModel() ??
    providerManager.getActiveProvider()?.getDefaultModel?.() ??
    '';
  if (requestedModel === '' && fallbackModel === '') {
    throw new Error(
      `Provider '${getProfileProvider(sanitizedProfile) || 'unknown'}' profile does not specify a model and no default is available.`,
    );
  }
  return requestedModel || fallbackModel;
}
