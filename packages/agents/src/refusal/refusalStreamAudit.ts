/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompressionAuditProvenance } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RefusalContextTracker } from './refusalContextTracker.js';
import type { RefusalContextFingerprint } from './refusalAudit.js';

/** Owns per-session compression observation and the send fingerprint for each stream. */
const trackersBySession = new Map<string, RefusalContextTracker>();

function trackerForSession(sessionId: string): RefusalContextTracker {
  let tracker = trackersBySession.get(sessionId);
  if (tracker === undefined) {
    tracker = new RefusalContextTracker();
    trackersBySession.set(sessionId, tracker);
  }
  return tracker;
}

export class RefusalStreamAudit {
  private tracker: RefusalContextTracker;

  constructor(private readonly sessionId: string) {
    this.tracker = trackerForSession(sessionId);
  }

  rebind(): void {
    this.tracker.resetBaseline();
  }

  recordCompression(provenance: CompressionAuditProvenance): void {
    this.tracker.recordCompression(provenance);
  }

  reset(): void {
    this.tracker.reset();
  }

  resetBaseline(): void {
    this.tracker.resetBaseline();
  }

  snapshot(
    committed: readonly IContent[],
    requestContents: readonly IContent[],
  ): RefusalContextFingerprint {
    return this.tracker.snapshot(committed, requestContents);
  }

  commit(
    committed: readonly IContent[],
    promptId: string,
    attemptIndex: number,
  ): void {
    this.tracker.commit(committed, promptId, attemptIndex);
  }

  dispose(): void {
    this.tracker.reset();
    if (trackersBySession.get(this.sessionId) === this.tracker) {
      trackersBySession.delete(this.sessionId);
    }
  }
}
