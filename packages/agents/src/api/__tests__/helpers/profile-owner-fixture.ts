/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { LoadBalancingProvider } from '../../../../../providers/src/LoadBalancingProvider.js';
import { LoggingProviderWrapper } from '../../../../../providers/src/LoggingProviderWrapper.js';
import { RetryOrchestrator } from '../../../../../providers/src/RetryOrchestrator.js';
export function loadBalancer(
  manager: RuntimeProviderManager,
): LoadBalancingProvider {
  let provider = manager.getProviderByName('load-balancer');
  while (
    provider instanceof LoggingProviderWrapper ||
    provider instanceof RetryOrchestrator
  ) {
    provider = provider.wrappedProvider;
  }
  if (!(provider instanceof LoadBalancingProvider))
    throw new Error('Expected real load balancer');
  return provider;
}

export function standardProfile(
  ephemeralSettings: Record<string, unknown> = {},
): Profile {
  return {
    version: 1,
    provider: 'anthropic',
    model: 'selected-model',
    modelParams: {},
    ephemeralSettings,
  };
}
