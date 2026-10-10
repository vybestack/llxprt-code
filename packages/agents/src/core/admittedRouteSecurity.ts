/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHmac, randomBytes } from 'node:crypto';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AdmittedProviderRoute } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';

// Revisions are only compared within this process, so a per-process random key
// keeps the digest of secret material from being usable as an offline
// password-guessing oracle.
const credentialRevisionKey = randomBytes(32);

export function admittedEndpoint(
  settings: SettingsService,
  providerName: string,
): string | undefined {
  return [
    settings.get('base-url'),
    settings.getProviderSettings(providerName)['base-url'],
  ]
    .find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    )
    ?.trim();
}

export function admittedCredentialRevision(
  settings: SettingsService,
  providerName: string,
): string {
  return createHmac('sha256', credentialRevisionKey)
    .update(
      JSON.stringify([
        settings.get('auth-key') ?? null,
        settings.getProviderSettings(providerName)['auth-key'] ?? null,
      ]),
    )
    .digest('hex');
}

export function assertAdmittedCredential(
  route: AdmittedProviderRoute | undefined,
  settings: SettingsService | undefined,
): void {
  if (!route) return;
  if (
    !settings ||
    route.credentialRevision !==
      admittedCredentialRevision(settings, route.provider.name)
  ) {
    throw new Error(
      'Admitted provider credentials changed before request dispatch',
    );
  }
}

export function assertSupportedReplacementRoute(
  providerName: string,
  baseURL: string | undefined,
  memberProviders:
    | ReadonlyArray<{
        providerName: string;
        baseURL?: string;
        hasInlineKey?: boolean;
      }>
    | undefined,
  replaced: boolean,
  hasInlineKey = true,
): void {
  if (!replaced) return;
  if (providerName === 'openai' && baseURL && hasInlineKey) return;
  if (
    providerName === 'load-balancer' &&
    memberProviders !== undefined &&
    memberProviders.length > 0 &&
    memberProviders.every(
      (member) =>
        member.providerName === 'openai' &&
        Boolean(member.baseURL) &&
        member.hasInlineKey === true,
    )
  )
    return;
  throw new Error('Unsupported admitted provider route after replacement');
}

export function assertAdmittedRoute(
  route: AdmittedProviderRoute | undefined,
): void {
  if (route === undefined) return;
  if (route.assertCurrent === undefined)
    throw new Error(
      'Admitted provider route requires its owner-bound validation',
    );
  route.assertCurrent();
}
