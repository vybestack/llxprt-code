/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompressionAuditProvenance } from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  RefusalContextTracker,
  type RefusalContextRows,
} from './refusalContextTracker.js';
import type { RefusalContextFingerprint } from './refusalAudit.js';

/** Owns the compression observations and send fingerprint for one stream processor. */
export class RefusalStreamAudit {
  private readonly tracker = new RefusalContextTracker();

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
    rows: RefusalContextRows,
    signal?: AbortSignal,
  ): Promise<RefusalContextFingerprint> {
    return this.tracker.snapshot(rows, signal);
  }

  commit(watermarkSeq: number, promptId: string, attemptIndex: number): void {
    this.tracker.commit(watermarkSeq, promptId, attemptIndex);
  }

  dispose(): void {
    this.tracker.reset();
  }
}
