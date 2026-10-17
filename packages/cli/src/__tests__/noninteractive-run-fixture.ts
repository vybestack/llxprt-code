/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { captureNonInteractiveRun } from './captured-headless-run-fixture.js';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  SessionSettingsOwner,
  RuntimePolicyOwner,
  Config,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import { acquireNonInteractiveRun } from '../nonInteractiveCliAcquisition.js';

interface RunNonInteractiveParams {
  readonly credentialAuthority?: CredentialAuthority;
  readonly oauthManager?: OAuthManager;
  readonly providerFileLifecycle?: ProviderFileLifecycle;
  runtimeSettings?: {
    readonly owner: SessionSettingsOwner;
    readonly store: SettingsService;
  };
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
  runtimeMessageBus?: MessageBus;
  policyOwner?: RuntimePolicyOwner;
  providerManager?: Agent['providerManager'];
  deferTelemetryShutdown?: boolean;
  /**
   * The single session Agent created at the CLI composition root (#2378). When
   * supplied, runNonInteractive REUSES it (and does NOT dispose it — the
   * composition root owns its lifecycle via registerCleanup) instead of
   * building a second Agent via fromConfig. When omitted (direct callers /
   * tests), runNonInteractive builds its own Agent from the activation intent
   * and disposes it in the finally block, preserving the previous contract.
   * @plan:PLAN-20270110-ISSUE2378.P02
   * @requirement:REQ-2378-002
   */
  agent?: Agent;
}
export async function runNonInteractive(
  params: RunNonInteractiveParams,
): Promise<void> {
  const run =
    params.agent === undefined
      ? acquireNonInteractiveRun(params)
      : captureNonInteractiveRun(
          params.config,
          params.agent,
          params.runtimeSettings !== undefined,
          () => {
            if (params.runtimeSettings === undefined)
              throw new Error(
                'Noninteractive settings commands require the explicit session owner and store',
              );
            return params.runtimeSettings.owner.telemetry.flush();
          },
        );
  await run(
    params.input,
    params.prompt_id,
    params.deferTelemetryShutdown ?? false,
  );
}
