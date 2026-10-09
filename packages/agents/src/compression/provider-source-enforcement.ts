/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD,
  computeHistoryTruncationTarget,
} from './contextLimitPolicy.js';
import { enforceSourceInitialProjection } from './source-initial-enforcement.js';

export interface ProviderSourceLimits {
  readonly completionBudget: number;
  readonly limit: number;
  readonly marginAdjustedLimit: number;
  readonly compressionThreshold: number;
}

export type ProviderSourceStage =
  | 'initial'
  | 'post-density-optimization'
  | 'post-compression'
  | 'post-retry-compression'
  | 'post-truncation'
  | 'post-tool-response-truncation';

type SourceNextStep =
  | 'send'
  | 'density'
  | 'compression'
  | 'retry-compression'
  | 'fallback'
  | 'tool-responses'
  | 'overflow';

export interface ProviderSourceAssessment {
  readonly requestTokens: number;
  readonly projected: number;
  readonly next: SourceNextStep;
  readonly historyTarget?: number;
}

interface ProviderSourceEnforcementDeps {
  readonly limits: ProviderSourceLimits;
  /** Projects the complete current disk owner at the finalized provider seam. */
  readonly estimate: () => Promise<number>;
  readonly getHistoryTokens: () => number;
}

/** Scalar policy only. Disk recomposition/publication and callback contracts remain missing. */
export class ProviderSourceEnforcer {
  constructor(private readonly deps: ProviderSourceEnforcementDeps) {}

  async enforce(): Promise<void> {
    await enforceSourceInitialProjection(this.deps.estimate, this.deps.limits);
  }

  async assess(
    stage: ProviderSourceStage,
    preCompressionProjected?: number,
    compressionResult?: PerformCompressionResult,
  ): Promise<ProviderSourceAssessment> {
    const requestTokens = await this.project(stage);
    const projected = requestTokens + this.deps.limits.completionBudget;
    const next = this.nextStep(
      stage,
      projected,
      preCompressionProjected,
      compressionResult,
    );
    return {
      requestTokens,
      projected,
      next,
      ...(next === 'fallback'
        ? {
            historyTarget: computeHistoryTruncationTarget(
              projected,
              this.deps.limits.marginAdjustedLimit,
              this.deps.getHistoryTokens(),
            ),
          }
        : {}),
    };
  }

  private async project(stage: ProviderSourceStage): Promise<number> {
    try {
      return await this.deps.estimate();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Token projection failed at ${stage} stage during provider-content hard-limit enforcement: ${message}`,
        { cause: error },
      );
    }
  }

  private nextStep(
    stage: ProviderSourceStage,
    projected: number,
    preCompressionProjected: number | undefined,
    compressionResult: PerformCompressionResult | undefined,
  ): SourceNextStep {
    const limits = this.deps.limits;
    if (stage === 'initial' || stage === 'post-density-optimization') {
      if (projected <= limits.compressionThreshold) return 'send';
      return stage === 'initial' ? 'density' : 'compression';
    }
    if (projected <= limits.marginAdjustedLimit) return 'send';
    if (stage === 'post-compression') {
      if (preCompressionProjected === undefined)
        throw new Error(
          'Source compression assessment requires its complete pre-compression projection',
        );
      const reductionRatio =
        preCompressionProjected > 0
          ? (preCompressionProjected - projected) / preCompressionProjected
          : 0;
      return compressionResult === PerformCompressionResult.COMPRESSED &&
        reductionRatio < INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD
        ? 'retry-compression'
        : 'fallback';
    }
    if (stage === 'post-retry-compression') return 'fallback';
    return stage === 'post-truncation' ? 'tool-responses' : 'overflow';
  }
}
