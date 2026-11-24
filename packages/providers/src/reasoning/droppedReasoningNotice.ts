/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';

/**
 * A configured reasoning setting the provider left out of a request. The
 * identity fields decide whether the user has already been told; `message`
 * is what the user sees.
 */
export interface DroppedReasoningNotice {
  /** The session (or, without one, the agent runtime) the request belongs to. */
  readonly sessionKey: string;
  readonly providerName: string;
  readonly model: string;
  readonly baseUrl: string | undefined;
  readonly setting: string;
  readonly reason: string;
  readonly message: string;
}

/**
 * Tells the user, through the user-feedback channel (interactive UI history
 * and headless stderr), that a configured reasoning setting is not being
 * sent. Requests repeat every turn, so each distinct (session, endpoint,
 * setting, reason) notice is shown once for the lifetime of the owner.
 */
export class DroppedReasoningAnnouncer {
  private readonly announced = new Set<string>();

  announce(notices: readonly DroppedReasoningNotice[]): void {
    for (const notice of notices) {
      const key = JSON.stringify([
        notice.sessionKey,
        notice.providerName,
        notice.model,
        notice.baseUrl ?? null,
        notice.setting,
        notice.reason,
      ]);
      if (this.announced.has(key)) {
        continue;
      }
      this.announced.add(key);
      coreEvents.emitFeedback('warning', notice.message);
    }
  }
}
