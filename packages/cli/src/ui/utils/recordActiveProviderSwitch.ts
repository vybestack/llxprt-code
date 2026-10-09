/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';

/**
 * Record, as a `provider_switch`, the provider/model the runtime is using
 * right now. Every UI path that changes the active provider or model after a
 * profile load goes through here so the recording history agrees with the
 * runtime regardless of which dialog or command made the change.
 *
 * `fallback` only fills fields the runtime status leaves empty.
 */
export function recordActiveProviderSwitch(
  recorder:
    | Pick<RecordingIntegration, 'recordProviderSwitch'>
    | null
    | undefined,
  runtime: Pick<RuntimeApi, 'getActiveProviderStatus'>,
  fallback: { providerName?: string; modelName?: string } = {},
): void {
  if (recorder === null || recorder === undefined) return;
  const status = runtime.getActiveProviderStatus();
  recorder.recordProviderSwitch(
    status.providerName ?? fallback.providerName ?? '',
    status.modelName ?? fallback.modelName ?? 'unknown',
  );
}
