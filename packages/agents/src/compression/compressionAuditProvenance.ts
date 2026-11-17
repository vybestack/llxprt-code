/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CompressionAuditProvenance,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { selectCompressionSummary } from './utils.js';

export interface CompressionAuditResult {
  readonly summary: IContent | undefined;
  readonly provenance: CompressionAuditProvenance;
}

export function getCompressionAuditResult(
  result: Extract<StrategyCompressionResult, { kind: 'applied' }>,
): CompressionAuditResult {
  return {
    summary: selectCompressionSummary(result.newHistory),
    provenance: result.metadata.auditProvenance ?? {
      summaryAuthorModel: null,
      summaryAuthorProvider: null,
      compressionStrategy: result.metadata.strategyUsed,
    },
  };
}

export async function applyCompressionAuditResult(
  result: Extract<StrategyCompressionResult, { kind: 'applied' }>,
  applyResult: (
    newHistory: IContent[],
    summary: IContent | undefined,
    topPreserved: number,
  ) => Promise<void>,
  notify: (audit: CompressionAuditResult) => void,
): Promise<CompressionAuditResult> {
  const audit = getCompressionAuditResult(result);
  // Keep history mutation caller-owned so anchor and fallback routes retain their own contracts.
  await applyResult(
    result.newHistory,
    audit.summary,
    result.metadata.topPreserved ?? 0,
  );
  notify(audit);
  return audit;
}

export async function applyFallbackCompressionResult(input: {
  readonly result: StrategyCompressionResult;
  readonly applyResult: (
    newHistory: IContent[],
    summary: IContent | undefined,
    topPreserved: number,
  ) => Promise<void>;
  readonly recordApplied: (
    metadata: StrategyCompressionResult['metadata'],
  ) => void;
  readonly notifyAudit: (audit: CompressionAuditResult) => void;
  readonly notifyNoop: (reason: string) => void;
  readonly resetFailures: () => void;
}): Promise<void> {
  if (input.result.kind === 'noop') {
    input.notifyNoop(input.result.reason);
    return;
  }
  await applyCompressionAuditResult(
    input.result,
    input.applyResult,
    input.notifyAudit,
  );
  input.recordApplied(input.result.metadata);
  input.resetFailures();
}

export function finishCompressionLifecycle(
  history: HistoryService,
  outcome: 'applied' | 'noop' | 'failed',
  summary: IContent | undefined,
  itemCount: number,
  origin: object | undefined,
  provenance: CompressionAuditProvenance | undefined,
): void {
  history.endCompression(
    outcome === 'noop' ? undefined : summary,
    outcome === 'noop' ? undefined : itemCount,
    origin,
    outcome === 'noop' ? undefined : provenance,
  );
}

export function beginCompressionLifecycle(
  history: HistoryService,
  origin: object | undefined,
): { tokensBefore: number; itemCount: number } {
  const tokensBefore = history.getTotalTokens();
  const itemCount = history.getStatistics().totalMessages;
  history.startCompression(origin);
  return { tokensBefore, itemCount };
}

export function endCompressionAttempt(input: {
  readonly history: HistoryService;
  readonly outcome: 'applied' | 'noop' | 'failed';
  readonly summary: IContent | undefined;
  readonly itemCount: number;
  readonly origin: object | undefined;
  readonly provenance: CompressionAuditProvenance | undefined;
}): void {
  finishCompressionLifecycle(
    input.history,
    input.outcome,
    input.summary,
    input.itemCount,
    input.origin,
    input.provenance,
  );
}
