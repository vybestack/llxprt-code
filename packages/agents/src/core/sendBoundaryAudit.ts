/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PreparedRequest } from './streamRequestHelpers.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { RefusalStreamAudit } from '../refusal/refusalStreamAudit.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { StreamProcessorRuntime } from './chatSessionPorts.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RefusalContextFingerprint } from '../refusal/refusalAudit.js';
import { recordSendSeamTelemetry } from './tokenUsageEstimateLogger.js';
import type { ChatSessionConfig } from './chatSession.js';

export function captureSendBoundaryAudit(
  audit: RefusalStreamAudit,
  compressionHandler: CompressionHandler,
  ports: StreamProcessorRuntime,
  history: HistoryService,
  request: {
    readonly estimate: PromptEnvelopeEstimate | null;
    readonly options: RuntimeGenerateChatOptions;
  },
  requestPayload: PreparedRequest['requestPayload'],
  generation: ChatSessionConfig,
  promptId: string,
  turnId: string | null,
): RefusalContextFingerprint {
  recordSendSeamTelemetry({
    usageLogger: compressionHandler.tokenUsageLogger,
    promptId,
    estimate: request.estimate,
    runtimeState: ports.state,
    historyService: history,
    requestContents: requestPayload.contents,
    tools: requestPayload.tools,
    systemInstruction: generation.systemInstruction,
    turnId,
  });
  return audit.snapshot(history.getAll(), request.options.contents);
}
