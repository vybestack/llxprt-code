/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SubscribeModelChanges } from '@vybestack/llxprt-code-core/utils/events.js';

export class ClientModelSubscriptions {
  private releaseSubscription: (() => void) | undefined;

  bind(
    subscribe: SubscribeModelChanges,
    modelChanged: () => void,
    profileChanged: () => void,
  ): void {
    if (this.releaseSubscription !== undefined)
      throw new Error('Client model notifications are already bound');
    this.releaseSubscription = subscribe((profile) => {
      if (profile === undefined) modelChanged();
      else profileChanged();
    });
  }

  release(): unknown[] {
    const failures: unknown[] = [];
    try {
      this.releaseSubscription?.();
    } catch (error) {
      failures.push(error);
    }
    this.releaseSubscription = undefined;
    return failures;
  }
}
