/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
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
  readonly tiktokenTokens: number;
}

export interface TokenUsageRecord extends PendingTokenEstimate {
  readonly actualPromptTokens: number;
  readonly cachedTokens: number;
  readonly effectiveActualTokens: number;
}

export const PENDING_CAP = 100;

export class TokenUsageLogger {
  private readonly pending = new Map<string, PendingTokenEstimate>();
  private readonly errorLogger = new DebugLogger('llxprt:token-usage-logger');
  private dirEnsured = false;

  constructor(
    private readonly enabled: boolean,
    private readonly logFilePath: string | undefined,
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  recordEstimate(
    promptId: string,
    data: Omit<PendingTokenEstimate, 'ts' | 'promptId'>,
  ): void {
    if (!this.enabled) return;
    if (this.pending.size >= PENDING_CAP) {
      const oldestKey = this.pending.keys().next().value;
      if (oldestKey !== undefined) this.pending.delete(oldestKey);
    }
    const entry: PendingTokenEstimate = {
      ...data,
      ts: new Date().toISOString(),
      promptId,
    };
    this.pending.set(promptId, entry);
  }

  recordActual(
    promptId: string,
    actual: { actualPromptTokens: number; cachedTokens: number },
  ): void {
    if (!this.enabled) return;
    const pending = this.pending.get(promptId);
    if (pending === undefined) return;
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
    this._writeRecord(record);
  }

  private _writeRecord(record: TokenUsageRecord): void {
    if (this.logFilePath === undefined) return;
    try {
      if (!this.dirEnsured) {
        const dir = path.dirname(this.logFilePath);
        fs.mkdirSync(dir, { recursive: true });
        this.dirEnsured = true;
      }
      const line = JSON.stringify(this._toSerializedRecord(record)) + '\n';
      fs.appendFileSync(this.logFilePath, line);
    } catch (error) {
      this.errorLogger.error('Failed to write token usage record', error);
    }
  }

  private _toSerializedRecord(
    record: TokenUsageRecord,
  ): Record<string, unknown> {
    return {
      ts: record.ts,
      prompt_id: record.promptId,
      provider: record.provider,
      model: record.model,
      estimated_tokens: record.estimatedTokens,
      estimator: record.estimator,
      tiktoken_tokens: record.tiktokenTokens,
      actual_prompt_tokens: record.actualPromptTokens,
      cached_tokens: record.cachedTokens,
      effective_actual_tokens: record.effectiveActualTokens,
    };
  }
}
