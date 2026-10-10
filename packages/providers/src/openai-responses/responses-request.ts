/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RequestMediaResolutionService } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { StreamLivenessEvent } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import {
  parseOutputLimits,
  type OutputLimitConfig,
} from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { ProviderToolset } from '../IProvider.js';
import type { ResolvedAuthToken } from '../types/providerRuntime.js';

export interface ResponsesRequest {
  readonly contents: IContent[];
  readonly tools?: ProviderToolset;
  readonly systemInstruction?: string;
  readonly metadata: Record<string, unknown>;
  readonly onStreamLiveness?: (event: StreamLivenessEvent) => void;
  readonly resolved: {
    readonly model: string;
    readonly baseURL: string;
    readonly authToken: ResolvedAuthToken;
  };
  readonly invocation: {
    readonly runtimeId: string;
    readonly signal?: AbortSignal;
    readonly ephemerals: Readonly<Record<string, unknown>>;
    readonly modelBehavior: Readonly<Record<string, unknown>>;
    readonly modelParams: Readonly<Record<string, unknown>>;
  };
  readonly headers: Readonly<Record<string, string>>;
  readonly maxOutputTokens?: number;
  readonly pdfEnabled: boolean;
  readonly includeReasoningInContext: boolean;
  readonly promptCaching: unknown;
  readonly textVerbosity: unknown;
  readonly reasoningFallbacks: {
    readonly enabled: unknown;
    readonly effort: unknown;
    readonly budgetTokens: unknown;
    readonly summary: unknown;
    readonly includeInResponse: unknown;
  };
  readonly outputLimits: OutputLimitConfig;
  readonly mediaRequestId: string;
  readonly mediaBudgetBytes?: number;
  readonly mediaResolver?: RequestMediaResolutionService;
}

export function captureResponsesRequest(
  options: NormalizedGenerateChatOptions,
  providerName: string,
  baseURL: string,
  headers: Record<string, string> | undefined,
  defaultModel: string,
  mediaResolver?: RequestMediaResolutionService,
  mediaBudgetBytes?: number,
): ResponsesRequest {
  const { invocation } = options;
  const ephemerals = Object.freeze({ ...invocation.ephemerals });
  const rawMaxOutput = options.modelParameters
    ? options.modelParameters.genericMaxOutputTokens
    : options.invocation.getEphemeral('maxOutputTokens');
  const logicalRequestId = options.metadata['logicalRequestId'];
  return Object.freeze({
    contents: options.contents,
    tools: options.tools,
    systemInstruction: options.systemInstruction,
    metadata: options.metadata,
    onStreamLiveness: options.onStreamLiveness,
    resolved: Object.freeze({
      model: options.resolved.model || defaultModel,
      baseURL,
      authToken: options.resolved.authToken,
    }),
    invocation: Object.freeze({
      runtimeId: invocation.runtimeId,
      signal: invocation.signal,
      ephemerals,
      modelBehavior: Object.freeze({ ...invocation.modelBehavior }),
      modelParams: Object.freeze({ ...invocation.modelParams }),
    }),
    headers: Object.freeze({ ...headers }),
    maxOutputTokens:
      typeof rawMaxOutput === 'number' &&
      Number.isFinite(rawMaxOutput) &&
      rawMaxOutput > 0
        ? rawMaxOutput
        : undefined,
    pdfEnabled:
      (ephemerals['media.pdf.enabled'] ??
        invocation.modelBehavior['media.pdf.enabled'] ??
        options.invocation.getEphemeral('media.pdf.enabled')) !== false,
    includeReasoningInContext:
      (ephemerals['reasoning.includeInContext'] ??
        invocation.modelBehavior['reasoning.includeInContext'] ??
        options.invocation.getEphemeral('reasoning.includeInContext')) !==
      false,
    promptCaching:
      ephemerals['prompt-caching'] ??
      options.invocation.getProviderOverrides<Record<string, unknown>>(
        providerName,
      )?.['prompt-caching'],
    textVerbosity:
      ephemerals['text.verbosity'] ??
      options.invocation.getEphemeral('text.verbosity'),
    reasoningFallbacks: captureReasoningFallbacks(options),
    outputLimits: Object.freeze(parseOutputLimits(ephemerals)),
    mediaRequestId:
      typeof logicalRequestId === 'string' && logicalRequestId.length > 0
        ? logicalRequestId
        : options.invocation.runtimeId,
    mediaBudgetBytes,
    mediaResolver,
  });
}

function captureReasoningFallbacks(
  options: NormalizedGenerateChatOptions,
): ResponsesRequest['reasoningFallbacks'] {
  return Object.freeze({
    enabled:
      options.invocation.ephemerals['reasoning.enabled'] ??
      options.invocation.getEphemeral('reasoning.enabled'),
    effort:
      options.invocation.ephemerals['reasoning.effort'] ??
      options.invocation.getEphemeral('reasoning.effort'),
    budgetTokens:
      options.invocation.ephemerals['reasoning.budgetTokens'] ??
      options.invocation.getEphemeral('reasoning.budgetTokens'),
    summary:
      options.invocation.ephemerals['reasoning.summary'] ??
      options.invocation.getEphemeral('reasoning.summary'),
    includeInResponse:
      options.invocation.ephemerals['reasoning.includeInResponse'] ??
      options.invocation.getEphemeral('reasoning.includeInResponse'),
  });
}
