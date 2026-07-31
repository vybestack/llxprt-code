/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

export type TokenEstimatorType =
  | 'openai-tiktoken'
  | 'anthropic-char'
  | 'core-fallback';

export interface PendingTokenEstimate {
  readonly ts: string;
  readonly promptId: string;
  readonly provider: string;
  readonly model: string;
  readonly estimatedTokens: number;
  readonly estimator: TokenEstimatorType;
  readonly tiktokenTokens: number | null;
  readonly tiktokenEstimationFailed?: boolean;
}

export interface TokenUsageRecord extends PendingTokenEstimate {
  readonly actualPromptTokens: number;
  readonly cachedTokens: number;
  readonly effectiveActualTokens: number;
}

export interface SerializedTokenUsageRecord {
  readonly ts: string;
  readonly prompt_id: string;
  readonly provider: string;
  readonly model: string;
  readonly estimated_tokens: number;
  readonly estimator: TokenEstimatorType;
  readonly tiktoken_tokens: number | null;
  readonly tiktoken_estimation_failed: boolean;
  readonly actual_prompt_tokens: number;
  readonly cached_tokens: number;
  readonly effective_actual_tokens: number;
}

export const PENDING_CAP = 100;

export class TokenUsageLogger {
  private readonly pending = new Map<string, PendingTokenEstimate>();
  private readonly errorLogger = new DebugLogger('llxprt:token-usage-logger');
  private dirEnsured = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly enabled: boolean,
    private readonly logFilePath: string | undefined,
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update the estimate for a prompt that already has a pending record,
   * preserving the tiktoken comparison measured earlier in the turn. Used when
   * a later stage (the finalized prompt envelope) produces a better token
   * count but cannot re-measure tiktoken.
   *
   * When no pending record exists for the promptId the finalized estimate is
   * still recorded, with a null tiktoken baseline: the finalized envelope is
   * the authoritative estimate for the send, and dropping it would lose the
   * estimate entirely. The null baseline records that no tiktoken comparison
   * was measured for this prompt rather than borrowing another prompt's.
   */
  refineEstimate(
    promptId: string,
    data: Omit<
      PendingTokenEstimate,
      'ts' | 'promptId' | 'tiktokenTokens' | 'tiktokenEstimationFailed'
    >,
  ): void {
    if (!this.enabled) return;
    const existing = this.pending.get(promptId);
    this.recordEstimate(promptId, {
      ...data,
      tiktokenTokens: existing?.tiktokenTokens ?? null,
      tiktokenEstimationFailed: existing?.tiktokenEstimationFailed ?? false,
    });
  }

  recordEstimate(
    promptId: string,
    data: Omit<PendingTokenEstimate, 'ts' | 'promptId'>,
  ): void {
    if (!this.enabled) return;
    if (!this.pending.has(promptId) && this.pending.size >= PENDING_CAP) {
      // Maps preserve insertion order, so this evicts only the oldest estimate.
      const oldestKey = this.pending.keys().next().value;
      if (oldestKey !== undefined) {
        this.pending.delete(oldestKey);
        this.errorLogger.debug('Evicted unmatched token estimate at capacity', {
          promptId: oldestKey,
          pendingCap: PENDING_CAP,
        });
      }
    }
    const entry: PendingTokenEstimate = {
      ...data,
      ts: new Date().toISOString(),
      promptId,
    };
    this.pending.set(promptId, entry);
  }

  async recordActual(
    promptId: string,
    actual: { actualPromptTokens: number; cachedTokens: number },
  ): Promise<void> {
    if (!this.enabled) return;
    const pending = this.pending.get(promptId);
    if (pending === undefined) return;
    // Consume before awaiting so concurrent completions cannot write duplicates.
    // Fail-open I/O intentionally does not requeue a failed measurement.
    this.pending.delete(promptId);

    const effectiveActualTokens = Math.max(
      0,
      actual.actualPromptTokens - actual.cachedTokens,
    );
    const record: TokenUsageRecord = {
      ...pending,
      actualPromptTokens: actual.actualPromptTokens,
      cachedTokens: actual.cachedTokens,
      effectiveActualTokens,
    };
    await this._writeRecord(record);
  }

  private async _writeRecord(record: TokenUsageRecord): Promise<void> {
    const logFilePath = this.logFilePath;
    if (logFilePath === undefined) return;

    const write = this.writeChain.then(async () => {
      if (!this.dirEnsured) {
        await mkdir(path.dirname(logFilePath), { recursive: true });
        this.dirEnsured = true;
      }
      const line = JSON.stringify(this._toSerializedRecord(record)) + '\n';
      await appendFile(logFilePath, line);
    });
    this.writeChain = write.catch((error: unknown) => {
      this.errorLogger.error(
        `Failed to write token usage record for prompt ${record.promptId}`,
        error,
      );
    });
    await this.writeChain;
  }

  private _toSerializedRecord(
    record: TokenUsageRecord,
  ): SerializedTokenUsageRecord {
    return {
      ts: record.ts,
      prompt_id: record.promptId,
      provider: record.provider,
      model: record.model,
      estimated_tokens: record.estimatedTokens,
      estimator: record.estimator,
      tiktoken_tokens: record.tiktokenTokens,
      tiktoken_estimation_failed: record.tiktokenEstimationFailed ?? false,
      actual_prompt_tokens: record.actualPromptTokens,
      cached_tokens: record.cachedTokens,
      effective_actual_tokens: record.effectiveActualTokens,
    };
  }
}
