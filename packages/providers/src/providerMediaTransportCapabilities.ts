/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type RemoteFileRetention = 'none' | 'provider-retained';
export type ZeroDataRetentionImplication =
  | 'not-applicable'
  | 'incompatible-while-retained';

export interface ProviderMediaTransportCapabilities {
  readonly durableStoredContinuation: boolean;
  readonly transportScopedContinuation: boolean;
  readonly statelessFullReplay: boolean;
  readonly explicitCacheBreakpoints: boolean;
  readonly automaticPrefixCaching: boolean;
  readonly cacheAffinityKey: boolean;
  readonly providerFileReferences: boolean;
  readonly remoteFileRetention: RemoteFileRetention;
  readonly zeroDataRetention: ZeroDataRetentionImplication;
  readonly streamingRequestBody: boolean;
}

const BOOLEAN_CAPABILITY_KEYS = [
  'durableStoredContinuation',
  'transportScopedContinuation',
  'statelessFullReplay',
  'explicitCacheBreakpoints',
  'automaticPrefixCaching',
  'cacheAffinityKey',
  'providerFileReferences',
  'streamingRequestBody',
] as const;

export function isProviderMediaTransportCapabilities(
  value: unknown,
): value is ProviderMediaTransportCapabilities {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (
    BOOLEAN_CAPABILITY_KEYS.some(
      (key) => typeof Reflect.get(value, key) !== 'boolean',
    )
  ) {
    return false;
  }
  const remoteFileRetention = Reflect.get(value, 'remoteFileRetention');
  const zeroDataRetention = Reflect.get(value, 'zeroDataRetention');
  return (
    (remoteFileRetention === 'none' ||
      remoteFileRetention === 'provider-retained') &&
    (zeroDataRetention === 'not-applicable' ||
      zeroDataRetention === 'incompatible-while-retained')
  );
}

export function copyMediaTransportCapabilities(
  capabilities: ProviderMediaTransportCapabilities,
): ProviderMediaTransportCapabilities {
  return { ...capabilities };
}

export function conservativeMediaTransportCapabilities(): ProviderMediaTransportCapabilities {
  return {
    durableStoredContinuation: false,
    transportScopedContinuation: false,
    statelessFullReplay: true,
    explicitCacheBreakpoints: false,
    automaticPrefixCaching: false,
    cacheAffinityKey: false,
    providerFileReferences: false,
    remoteFileRetention: 'none',
    zeroDataRetention: 'not-applicable',
    streamingRequestBody: false,
  };
}

const DECLARATIONS = new Map<string, ProviderMediaTransportCapabilities>([
  [
    'openai-responses',
    {
      ...conservativeMediaTransportCapabilities(),
      durableStoredContinuation: true,
      automaticPrefixCaching: true,
      cacheAffinityKey: true,
      streamingRequestBody: true,
    },
  ],
  [
    'codex',
    {
      ...conservativeMediaTransportCapabilities(),
      transportScopedContinuation: true,
      automaticPrefixCaching: true,
      cacheAffinityKey: true,
    },
  ],
  [
    'openai',
    {
      ...conservativeMediaTransportCapabilities(),
      automaticPrefixCaching: true,
      cacheAffinityKey: true,
      streamingRequestBody: true,
    },
  ],
  [
    'kimi',
    {
      ...conservativeMediaTransportCapabilities(),
      automaticPrefixCaching: true,
      cacheAffinityKey: true,
      providerFileReferences: true,
      remoteFileRetention: 'provider-retained',
      zeroDataRetention: 'incompatible-while-retained',
      streamingRequestBody: true,
    },
  ],
  [
    'anthropic',
    {
      ...conservativeMediaTransportCapabilities(),
      explicitCacheBreakpoints: true,
      automaticPrefixCaching: true,
      streamingRequestBody: true,
    },
  ],
  [
    'gemini',
    {
      ...conservativeMediaTransportCapabilities(),
      automaticPrefixCaching: true,
    },
  ],
  ['openaivercel', conservativeMediaTransportCapabilities()],
]);

export function declaredMediaTransportCapabilities(
  providerName: string,
): ProviderMediaTransportCapabilities {
  const declaration = DECLARATIONS.get(providerName.toLowerCase());
  return declaration === undefined
    ? conservativeMediaTransportCapabilities()
    : copyMediaTransportCapabilities(declaration);
}
