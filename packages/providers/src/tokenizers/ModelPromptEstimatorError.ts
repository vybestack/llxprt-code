/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LocalTokenizationError } from '@vybestack/llxprt-code-core/utils/errors.js';
import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';

export type ModelPromptEstimatorErrorCode =
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

function describeCause(options: ErrorOptions | undefined): string {
  if (options === undefined || !('cause' in options)) return '';
  const { cause } = options;
  return `; cause: ${cause instanceof Error ? cause.message : String(cause)}`;
}

export class ModelPromptEstimatorError extends LocalTokenizationError {
  constructor(
    readonly code: ModelPromptEstimatorErrorCode,
    readonly context: ModelPromptEstimatorErrorContext,
    readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(
      `Prompt estimator ${code} for ${context.canonicalModel} (${context.protocol}); ${remediation}${describeCause(options)}`,
      options,
    );
    this.name = 'ModelPromptEstimatorError';
  }
}
