/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  conservativeMediaTransportCapabilities,
  type ProviderMediaTransportCapabilities,
} from '../providerMediaTransportCapabilities.js';

interface MediaCapabilitiesSource {
  readonly getMediaTransportCapabilities?: (
    isCodex: boolean,
  ) => ProviderMediaTransportCapabilities;
}

export function resolveMediaCapabilities(
  source: MediaCapabilitiesSource,
  isCodex: boolean,
): ProviderMediaTransportCapabilities {
  return (
    source.getMediaTransportCapabilities?.(isCodex) ??
    conservativeMediaTransportCapabilities()
  );
}

export function resolveExplicitUserStore(
  requestOverrides: Readonly<Record<string, unknown>>,
): boolean | undefined {
  const store = requestOverrides['store'];
  return typeof store === 'boolean' ? store : undefined;
}

export function supportsStatefulResponsesTransport(
  forceStateless: boolean,
  capabilities: ProviderMediaTransportCapabilities,
  webSocketActive: boolean,
): boolean {
  if (forceStateless) return false;
  if (capabilities.durableStoredContinuation) return true;
  return capabilities.transportScopedContinuation && webSocketActive;
}
