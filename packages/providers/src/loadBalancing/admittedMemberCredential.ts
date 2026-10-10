/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { ProviderManager } from '../ProviderManager.js';
import { LoadBalancingProvider } from '../LoadBalancingProvider.js';
import {
  isResolvedSubProfile,
  type ResolvedSubProfile,
  type LoadBalancerSubProfile,
} from './loadBalancerTypes.js';

type Member = ResolvedSubProfile | LoadBalancerSubProfile;

function credentialIdentity(member: Member): string {
  return JSON.stringify([
    member.providerName,
    member.authToken ?? null,
    isResolvedSubProfile(member) ? (member.authKeyName ?? null) : null,
    isResolvedSubProfile(member) ? (member.authKeyfile ?? null) : null,
    isResolvedSubProfile(member) ? (member.auth?.type ?? null) : null,
    isResolvedSubProfile(member) ? (member.auth?.buckets ?? null) : null,
  ]);
}

export function isAdmittedMemberCredentialCurrent(
  currentWrapped: unknown,
  admitted: LoadBalancingProvider,
  selected: Member,
): boolean {
  let current = currentWrapped;
  while (
    current !== null &&
    typeof current === 'object' &&
    'wrappedProvider' in current
  ) {
    current = current.wrappedProvider;
  }
  if (current === admitted) return true;
  if (!(current instanceof LoadBalancingProvider)) return false;
  const selectedIdentity = credentialIdentity(selected);
  return current
    .getLoadBalancerConfig()
    .subProfiles.some(
      (member) => credentialIdentity(member) === selectedIdentity,
    );
}

export function assertAdmittedMemberDispatch(
  options: GenerateChatOptions,
  currentWrapped: unknown,
  admitted: LoadBalancingProvider,
  selected: Member,
  selectionRevision: symbol,
): void {
  options.modelParameters?.route?.assertCurrent?.();
  if (
    options.modelParameters?.loadBalancer?.selectionRevision ===
      selectionRevision &&
    !isAdmittedMemberCredentialCurrent(currentWrapped, admitted, selected)
  ) {
    throw new Error(
      'Admitted load-balancer member credentials changed before request dispatch',
    );
  }
}

export function createAdmittedMemberDispatchGuard(
  admitted: LoadBalancingProvider,
  manager: ProviderManager,
  selectionRevision: symbol,
): (options: GenerateChatOptions, selected: Member) => void {
  return (options, selected) =>
    assertAdmittedMemberDispatch(
      options,
      manager.getActiveProvider(),
      admitted,
      selected,
      selectionRevision,
    );
}

export function resolveAdmittedMemberDelegate(
  options: GenerateChatOptions,
  selected: Member,
  manager: ProviderManager,
): IProvider {
  const admittedMembers = options.modelParameters?.route?.members;
  const delegate = admittedMembers
    ? (admittedMembers.find(
        (member) => member.providerName === selected.providerName,
      )?.provider as IProvider | undefined)
    : manager.getProviderByName(selected.providerName);
  if (!delegate) {
    const errorMsg = `Provider "${selected.providerName}" not found for sub-profile "${selected.name}"`;
    throw new Error(errorMsg);
  }
  return delegate;
}
