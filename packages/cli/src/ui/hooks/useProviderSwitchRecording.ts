/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
export function useSwitch(
  ownedRecording:
    | Pick<Agent['session'], 'recordRecordingEvent'>
    | null
    | undefined,
  rawRecording: Pick<RecordingIntegration, 'recordProviderSwitch'> | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
): (provider: string, model: string) => Promise<void> {
  return useCallback(
    async (provider, model) => {
      if (recordingOwner === 'agent') {
        if (ownedRecording == null)
          throw new Error('Session agent is unavailable');
        await ownedRecording.recordRecordingEvent({
          type: 'provider_switch',
          provider,
          model,
        });
      } else {
        rawRecording?.recordProviderSwitch(provider, model);
      }
    },
    [ownedRecording, rawRecording, recordingOwner],
  );
}
