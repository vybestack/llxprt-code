/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompressionAuditProvenance } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export class CompressionAuditState {
  private currentSummary: IContent | undefined;
  private currentProvenance: CompressionAuditProvenance | undefined;
  private listener?: (provenance: CompressionAuditProvenance) => void;

  get summary(): IContent | undefined {
    return this.currentSummary;
  }

  get provenance(): CompressionAuditProvenance | undefined {
    return this.currentProvenance;
  }

  reset(): void {
    this.currentSummary = undefined;
    this.currentProvenance = undefined;
  }

  setSummary(summary: IContent | undefined): void {
    this.currentSummary = summary;
  }

  record(
    summary: IContent | undefined,
    provenance: CompressionAuditProvenance,
  ): void {
    this.currentSummary = summary;
    this.currentProvenance = provenance;
    this.listener?.(provenance);
  }

  setListener(
    listener: (provenance: CompressionAuditProvenance) => void,
  ): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }
}
