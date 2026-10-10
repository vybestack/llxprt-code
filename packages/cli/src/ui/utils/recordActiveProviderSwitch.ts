/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';

type SwitchRecorder = Pick<RecordingIntegration, 'recordProviderSwitch'>;

type ResolvedSwitch = { provider: string; model: string };

/**
 * Record a provider/model switch that has already taken effect. This is the one
 * place a recording failure (for example the queue byte limit) is caught: the
 * switch itself succeeded, so the failure is handed to `reportFailure` for the
 * caller's own message channel instead of being thrown into the switch's error
 * handling or swallowed. Resolving the provider/model is part of recording, so
 * a failure to read them is reported the same way and records nothing.
 */
export function recordProviderSwitchReportingFailure(
  recorder: SwitchRecorder | null | undefined,
  resolveSwitch: () => ResolvedSwitch,
  reportFailure: (message: string) => void,
): void {
  if (recorder === null || recorder === undefined) return;
  let target = 'provider/model';
  try {
    const { provider, model } = resolveSwitch();
    target = `${provider}/${model}`;
    recorder.recordProviderSwitch(provider, model);
  } catch (error) {
    reportFailure(
      `Switched to ${target}, but recording the switch in the session file failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Record, as a `provider_switch`, the provider/model the runtime is using
 * right now. Every UI path that changes the active provider or model after a
 * profile load goes through here so the recording history agrees with the
 * runtime regardless of which dialog or command made the change. Call it after
 * the switch's own success updates.
 *
 * `fallback` only fills fields the runtime status leaves empty.
 */
export function recordActiveProviderSwitch(
  recorder: SwitchRecorder | null | undefined,
  runtime: Pick<RuntimeApi, 'getActiveProviderStatus'>,
  reportFailure: (message: string) => void,
  fallback: { providerName?: string; modelName?: string } = {},
): void {
  recordProviderSwitchReportingFailure(
    recorder,
    () => {
      const status = runtime.getActiveProviderStatus();
      return {
        provider: status.providerName ?? fallback.providerName ?? '',
        model: status.modelName ?? fallback.modelName ?? 'unknown',
      };
    },
    reportFailure,
  );
}
