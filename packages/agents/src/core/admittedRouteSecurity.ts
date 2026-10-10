/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { timingSafeEqual } from 'node:crypto';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AdmittedProviderRoute } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';

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

/**
 * The credential values that were admitted for a route. The secret stays in
 * this closure; it is never exposed as a property of the route object, so
 * serializing or inspecting a route cannot leak it.
 */
export type AdmittedCredential = (settings: SettingsService) => boolean;

function readCredentialMaterial(
  settings: SettingsService,
  providerName: string,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      settings.get('auth-key') ?? null,
      settings.getProviderSettings(providerName)['auth-key'] ?? null,
    ]),
    'utf8',
  );
}

export function captureAdmittedCredential(
  settings: SettingsService,
  providerName: string,
): AdmittedCredential {
  const admitted = readCredentialMaterial(settings, providerName);
  return (current) => {
    const candidate = readCredentialMaterial(current, providerName);
    return (
      candidate.length === admitted.length &&
      timingSafeEqual(candidate, admitted)
    );
  };
}

export function assertAdmittedCredential(
  admitted: AdmittedCredential,
  settings: SettingsService | undefined,
): void {
  if (!settings || !admitted(settings)) {
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
