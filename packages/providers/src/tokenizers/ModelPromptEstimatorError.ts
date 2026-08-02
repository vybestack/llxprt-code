/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';

export type ModelPromptEstimatorErrorCode =
  | 'unresolved-model-identity'
  | 'unsupported-protocol'
  | 'asset-unavailable'
  | 'projection-unavailable'
  | 'tokenization-failed';

export interface ModelPromptEstimatorErrorContext {
  readonly activeProvider: string;
  readonly canonicalModel: string;
  readonly protocol: PromptEnvelopeProtocol | 'unknown';
  readonly family: string;
}

export class ModelPromptEstimatorError extends Error {
  constructor(
    readonly code: ModelPromptEstimatorErrorCode,
    readonly context: ModelPromptEstimatorErrorContext,
    readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(
      `Prompt estimator ${code} for ${context.canonicalModel} (${context.protocol}); ${remediation}`,
      options,
    );
    this.name = 'ModelPromptEstimatorError';
  }
}
