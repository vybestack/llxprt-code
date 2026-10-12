/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { LoadBalancingProvider } from '../LoadBalancingProvider.js';

export function admitLoadBalancerModelParameters(
  provider: unknown,
  settings: SettingsService,
): AdmittedModelParameters {
  let current: unknown = provider;
  for (let depth = 0; depth < 3; depth++) {
    if (current instanceof LoadBalancingProvider)
      return current.admitModelParameters(settings);
    if (
      current === null ||
      typeof current !== 'object' ||
      !('wrappedProvider' in current)
    )
      break;
    current = current.wrappedProvider;
  }
  throw new Error('Active load balancer has no selectable provider binding');
}
