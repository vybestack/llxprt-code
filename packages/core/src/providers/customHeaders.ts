/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NormalizedGenerateChatOptions } from './BaseProvider.js';
import type { IProviderConfig } from './types/IProviderConfig.js';

function getEphemeralSettings(
  providerConfig: IProviderConfig | undefined,
): Record<string, unknown> | undefined {
  const ephemerals = providerConfig?.getEphemeralSettings?.();
  return ephemerals && typeof ephemerals === 'object' ? ephemerals : undefined;
}

function getConfiguredHeaders(
  providerConfig: IProviderConfig | undefined,
): Record<string, string> {
  const headers = providerConfig?.customHeaders;
  return headers && typeof headers === 'object' ? { ...headers } : {};
}

function getEphemeralHeaders(
  ephemerals: Record<string, unknown> | undefined,
): Record<string, string> {
  return (
    (ephemerals?.['custom-headers'] as Record<string, string> | undefined) ?? {}
  );
}

function addUserAgent(
  headers: Record<string, string>,
  ephemerals: Record<string, unknown> | undefined,
): void {
  const userAgent = ephemerals?.['user-agent'];
  if (typeof userAgent === 'string' && userAgent.trim()) {
    headers['User-Agent'] = userAgent.trim();
  }
}

export function getProviderCustomHeaders(
  providerConfig: IProviderConfig | undefined,
  options?: NormalizedGenerateChatOptions,
): Record<string, string> | undefined {
  const ephemerals = getEphemeralSettings(providerConfig);
  const combined: Record<string, string> = {
    ...getConfiguredHeaders(providerConfig),
    ...getEphemeralHeaders(ephemerals),
  };
  addUserAgent(combined, ephemerals);

  if (options?.invocation.customHeaders) {
    Object.assign(combined, options.invocation.customHeaders);
  }

  return Object.keys(combined).length > 0 ? combined : undefined;
}
