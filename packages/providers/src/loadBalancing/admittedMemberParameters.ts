/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  isSessionScopedSettingKey,
  separateSettings,
} from '@vybestack/llxprt-code-settings';
import {
  ownModelParameters,
  type AdmittedModelParameters,
} from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { admitModelParameters } from '../runtime/admitModelParameters.js';
import { buildEphemeralsSnapshot } from '../runtimeNormalizer.js';
import {
  isResolvedSubProfile,
  type LoadBalancingProviderConfig,
} from './loadBalancerTypes.js';

export function captureLoadBalancerParameters(
  config: LoadBalancingProviderConfig,
  settings: SettingsService,
  selectionRevision: symbol,
  memberIdentities: WeakMap<object, symbol>,
): AdmittedModelParameters {
  const lb = admitModelParameters(settings, 'load-balancer');
  const session = Object.fromEntries(
    Object.entries(settings.getAllGlobalSettings()).filter(([key]) =>
      isSessionScopedSettingKey(key),
    ),
  );
  const members = config.subProfiles.map((member) => {
    if (!isResolvedSubProfile(member)) {
      throw new Error(
        'Cannot admit a load-balancer member without resolved settings',
      );
    }
    const provider = separateSettings(
      buildEphemeralsSnapshot(settings, member.providerName),
      member.providerName,
    );
    const profile = separateSettings(
      {
        ...member.ephemeralSettings,
        ...config.lbProfileEphemeralSettings,
        ...member.modelParams,
        ...config.lbProfileModelParams,
      },
      member.providerName,
    );
    const sessionParams = separateSettings(session, member.providerName);
    const identity = memberIdentities.get(member);
    if (identity === undefined)
      throw new Error('Load-balancer member changed before admission');
    return Object.freeze({
      identity,
      ...(member.baseURL ? { baseURL: member.baseURL } : {}),
      hasInlineKey:
        typeof member.authToken === 'string' &&
        member.authToken.trim().length > 0,
      parameters: Object.freeze({
        providerName: member.providerName,
        modelParams: ownModelParameters({
          ...provider.modelParams,
          ...profile.modelParams,
          ...lb.modelParams,
          ...sessionParams.modelParams,
        }),
        genericMaxOutputTokens: lb.genericMaxOutputTokens,
      }),
    });
  });
  return Object.freeze({
    ...lb,
    loadBalancer: Object.freeze({
      selectionRevision,
      members: Object.freeze(members),
    }),
  });
}

export function selectAdmittedMemberParameters(
  revision: symbol,
  selectedIdentity: symbol | undefined,
  admitted: AdmittedModelParameters | undefined,
): AdmittedModelParameters | undefined {
  if (!admitted) return undefined;
  if (!admitted.loadBalancer)
    throw new Error(
      'Load-balancer parameter admission lacks member partitions',
    );
  if (admitted.loadBalancer.selectionRevision !== revision)
    throw new Error(
      'Load-balancer selection changed after foreground admission',
    );
  const member = admitted.loadBalancer.members.find(
    (entry) => entry.identity === selectedIdentity,
  );
  if (member === undefined)
    throw new Error('Selected member was not captured at admission');
  return member.parameters;
}
