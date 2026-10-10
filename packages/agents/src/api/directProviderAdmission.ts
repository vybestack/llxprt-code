/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { AdmittedProviderRoute } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { admitModelParameters } from '@vybestack/llxprt-code-providers/runtime/admitModelParameters.js';
import { admitLoadBalancerModelParameters } from '@vybestack/llxprt-code-providers/runtime/admitLoadBalancerModelParameters.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { LoopHolder } from './loop/rebuildLoop.js';
import {
  admittedCredentialRevision,
  assertSupportedReplacementRoute,
  assertAdmittedCredential,
} from '../core/admittedRouteSecurity.js';

export interface ActiveRun {
  readonly controller: AbortController;
  readonly finished: Promise<void>;
  readonly finish: () => void;
  readonly close: () => Promise<void>;
  retirements: ReadonlyArray<() => Promise<void>>;
  modelParameters?: AdmittedModelParameters;
  loop?: Pick<NonNullable<LoopHolder['current']>, 'run' | 'injectSteer'>;
}

export interface DirectProviderAdmission {
  admit(): AdmittedModelParameters | undefined;
}

export function assembleDirectProviderAdmission(
  settingsService: SettingsService,
  manager: RuntimeProviderManager,
  readModel: () => string,
): DirectProviderAdmission {
  return {
    admit: () =>
      admitDirectProviderModelParameters(settingsService, manager, readModel),
  };
}

function admitDirectProviderModelParameters(
  settingsService: SettingsService,
  manager: RuntimeProviderManager,
  readModel: () => string,
): AdmittedModelParameters | undefined {
  const provider = manager.getActiveProvider();
  if (!provider) throw new Error('Ready agent has no active provider');
  const providerName = provider.name;
  const parameters =
    providerName === 'load-balancer'
      ? admitLoadBalancerModelParameters(provider, settingsService)
      : admitModelParameters(settingsService, providerName);
  const providerSettings = settingsService.getProviderSettings(providerName);
  const hasInlineKey = [
    settingsService.get('auth-key'),
    providerSettings['auth-key'],
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
  const readCurrentEndpoint = (): string | undefined => {
    const current =
      settingsService.get('base-url') ??
      settingsService.getProviderSettings(providerName)['base-url'];
    return typeof current === 'string' ? current : undefined;
  };
  const endpoint = readCurrentEndpoint();
  const members = parameters.loadBalancer?.members.map(
    ({
      parameters: member,
      baseURL: memberURL,
      hasInlineKey: memberInlineKey,
    }) => {
      const delegate = manager.getProviderByName(member.providerName);
      if (!delegate)
        throw new Error(
          `Admitted member provider ${member.providerName} is missing`,
        );
      return Object.freeze({
        providerName: member.providerName,
        provider: delegate,
        ...(memberURL ? { baseURL: memberURL } : {}),
        hasInlineKey: memberInlineKey === true,
      });
    },
  );
  const route: AdmittedProviderRoute = Object.freeze({
    provider,
    model: readModel(),
    profileName: settingsService.getCurrentProfileName(),
    hasInlineKey,
    credentialRevision: admittedCredentialRevision(
      settingsService,
      providerName,
    ),
    ...(providerName !== 'load-balancer' && endpoint
      ? { baseURL: endpoint }
      : {}),
    ...(members ? { members: Object.freeze(members) } : {}),
  });
  return Object.freeze({
    ...parameters,
    route: Object.freeze({
      ...route,
      assertCurrent: () => {
        assertSupportedReplacementRoute(
          route.provider.name,
          route.baseURL,
          route.members,
          manager.getActiveProvider() !== route.provider ||
            readModel() !== route.model ||
            (route.provider.name !== 'load-balancer' &&
              readCurrentEndpoint() !== route.baseURL),
          route.hasInlineKey,
        );
        assertAdmittedCredential(route, settingsService);
      },
    }),
  });
}
