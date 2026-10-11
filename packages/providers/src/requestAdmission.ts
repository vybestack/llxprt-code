/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from './IProvider.js';

export function copyProviderRequestOptions(
  input: GenerateChatOptions,
): GenerateChatOptions {
  return {
    runtimeKind: input.runtimeKind,
    contents: input.contents,
    tools: input.tools,
    modelParameters: input.modelParameters,
    invocation: input.invocation,
    requestDiagnostics: input.requestDiagnostics,
    resolved: input.resolved ? { ...input.resolved } : undefined,
    metadata: input.metadata,
    userMemory: input.userMemory,
    systemInstruction: input.systemInstruction,
    systemPromptAssembler: input.systemPromptAssembler,
    promptEnvelopeTransportToken: input.promptEnvelopeTransportToken,
    onProviderError: input.onProviderError,
    onStreamLiveness: input.onStreamLiveness,
    readRetryAuthToken: input.readRetryAuthToken,
    handleAuthError: input.handleAuthError,
    tryBucketFailover: input.tryBucketFailover,
    readFailoverBuckets: input.readFailoverBuckets,
    readCurrentBucket: input.readCurrentBucket,
    readFailoverReasons: input.readFailoverReasons,
    resetBucketSession: input.resetBucketSession,
  };
}
