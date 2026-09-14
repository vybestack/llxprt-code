/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommandKind } from './profileCommands.js';

/**
 * Event emitted by the profile controller.
 *
 * Events carry no document contents, secrets, or model/provider names.
 */
export type ProfileEvent = {
  type:
    | 'command-queued'
    | 'command-started'
    | 'command-cancelled'
    | 'committed'
    | 'command-no-op'
    | 'command-rejected'
    | 'health-changed';
  agentId: string;
  commandKind: ProfileCommandKind | null;
  revision: number;
  at: number;
};

/**
 * Deeply-frozen readable projection of a profile event. It keeps the factual fields
 * (including `commandKind`) and drops nothing: redaction here is about deep freezing,
 * not eliding.
 */
export type RedactedProfileEvent = Readonly<{
  type: ProfileEvent['type'];
  agentId: string;
  commandKind: ProfileCommandKind | null;
  revision: number;
  at: number;
}>;

/**
 * Build a deep-frozen readable projection of a profile event.
 */
export function toRedactedProfileEvent(
  event: ProfileEvent,
): RedactedProfileEvent {
  const redacted: RedactedProfileEvent = Object.freeze({
    type: event.type,
    agentId: event.agentId,
    commandKind: event.commandKind,
    revision: event.revision,
    at: event.at,
  });
  return redacted;
}
