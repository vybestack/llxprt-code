/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';

export interface ProviderSwitchResult {
  changed: boolean;
  previousProvider: string | null;
  nextProvider: string;
  defaultModel?: string;
  infoMessages: string[];
}

export interface ProviderSwitchOptions {
  publication?: 'immediate' | 'deferred';
  clientReplacement?: 'immediate' | 'deferred';
  autoOAuth?: boolean;
  preserveEphemerals?: readonly string[];
  skipModelDefaults?: boolean;
  addItem?: OAuthUICallback;
}

export type ProviderSwitcher = (
  name: string,
  options?: ProviderSwitchOptions,
) => Promise<ProviderSwitchResult>;

export interface ApiKeyUpdateResult {
  changed: boolean;
  providerName: string;
  message: string;
  isPaidMode?: boolean;
}

export interface BaseUrlUpdateResult {
  changed: boolean;
  providerName: string;
  message: string;
  baseUrl?: string;
}

export interface ModelChangeResult {
  providerName: string;
  previousModel?: string;
  nextModel: string;
  authRefreshed: boolean;
}
