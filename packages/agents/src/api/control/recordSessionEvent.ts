/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RecordingIntegration } from '@vybestack/llxprt-code-core';

export type SessionRecordingEvent =
  | {
      readonly type: 'provider_switch';
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly type: 'directories_changed';
      readonly directories: readonly string[];
    }
  | {
      readonly type: 'session_event';
      readonly severity: 'info' | 'warning' | 'error';
      readonly message: string;
      readonly presentation?: 'already-appended';
    };

export async function recordSessionEvent(
  integration: RecordingIntegration | null,
  event: SessionRecordingEvent,
  appendDisplay: (
    descriptor: { readonly type: 'info' | 'warning' | 'error' },
    message: string,
  ) => Promise<unknown>,
): Promise<void> {
  if (integration === null) return;
  if (event.type === 'provider_switch') {
    integration.recordProviderSwitch(event.provider, event.model);
  } else if (event.type === 'directories_changed') {
    integration.recordDirectoriesChanged([...event.directories]);
  } else {
    integration.recordSessionEvent(event.severity, event.message);
    if (event.presentation !== 'already-appended')
      await appendDisplay({ type: event.severity }, event.message);
  }
}
