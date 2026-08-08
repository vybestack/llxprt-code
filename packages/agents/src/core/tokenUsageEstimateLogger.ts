/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type {
  TokenUsageLogger,
  TokenEstimatorType,
} from './TokenUsageLogger.js';
import type { TokenUsageTurnContext } from './tokenUsageRecords.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { findCurrentTurnMarker } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { extractSystemInstructionText } from './streamRequestHelpers.js';
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';

const logger = new DebugLogger('llxprt:token-usage-estimate');

const OPENAI_PROVIDERS = new Set([
  'openai',
  'openaivercel',
  'openai-responses',
]);

const ANTHROPIC_PROVIDERS = new Set(['anthropic']);

export function resolveEstimatorType(
  providerName: string,
  estimatorMethod?: PromptEnvelopeEstimate['estimatorMethod'],
  estimatorFamily?: string,
): TokenEstimatorType {
  if (estimatorMethod === 'exact' && estimatorFamily === 'openai-gpt-5.6') {
    return 'openai-tiktoken';
  }
  const normalizedProviderName = providerName.toLowerCase();
  if (OPENAI_PROVIDERS.has(normalizedProviderName)) return 'openai-tiktoken';
  if (ANTHROPIC_PROVIDERS.has(normalizedProviderName)) return 'anthropic-char';
  return 'core-fallback';
}

export function recordFinalizedPromptEnvelopeEstimate(
  usageLogger: TokenUsageLogger | null | undefined,
  promptId: string,
  estimate: PromptEnvelopeEstimate | null,
): void {
  if (estimate === null) return;
  if (usageLogger === undefined || usageLogger === null) return;
  if (!usageLogger.isEnabled()) return;
  try {
    usageLogger.refineEstimate(promptId, {
      provider: estimate.activeProvider,
      model: estimate.model,
      estimatedTokens: estimate.estimatedPromptTokens,
      estimator: resolveEstimatorType(
        estimate.activeProvider,
        estimate.estimatorMethod,
        estimate.estimatorFamily,
      ),
      estimatorMethod: estimate.estimatorMethod,
      estimatorFamily: estimate.estimatorFamily,
      estimatorVersion: estimate.estimatorVersion,
      assetRevision: estimate.assetRevision,
      projectionRevision: estimate.projectionRevision,
      protocol: estimate.protocol,
    });
  } catch (error) {
    logger.error(
      `Failed to record finalized prompt-envelope estimate for prompt ${promptId}`,
      error,
    );
  }
}

/**
 * Attach the AC-1 join keys to the pending estimate for `promptId` so the
 * eventual turn record can be joined back to the conversation. Called at both
 * send seams (StreamProcessor and TurnProcessor) immediately after
 * {@link recordFinalizedPromptEnvelopeEstimate}.
 *
 * The join keys come from two sources:
 * - `runtimeState` provides `sessionId`, `runtimeId`, `parentRuntimeId`,
 *   and `subagentName`.
 * - `findCurrentTurnMarker` over the raw history provides `turnId`, `userTurn`,
 *   and `step`. When no chronology marker exists yet, these are `null` —
 *   never invented, never 0-as-unknown.
 *
 * @issue #3130
 */
export function recordTurnJoinContext(
  usageLogger: TokenUsageLogger | null | undefined,
  promptId: string,
  runtimeState: AgentRuntimeState,
  historyService: HistoryService,
  turnId: string | null,
): void {
  if (usageLogger === undefined || usageLogger === null) return;
  if (!usageLogger.isEnabled()) return;

  // The turn being sent is not in history yet — the record is written before
  // the turn is persisted. `turnId` is therefore the canonical id minted for
  // this send, not something derived from history; deriving it here would name
  // the previous turn. `userTurn`/`step` describe the conversation position
  // the request was built from, which is the newest persisted marker.
  const priorMarker = findCurrentTurnMarker(historyService.getRawHistory());

  const context: TokenUsageTurnContext = {
    sessionId: runtimeState.sessionId,
    runtimeId: runtimeState.runtimeId,
    parentRuntimeId: runtimeState.parentRuntimeId ?? null,
    subagentName: runtimeState.subagentName ?? null,
    turnId,
    userTurn: priorMarker?.userTurn ?? null,
    step: priorMarker?.step ?? null,
  };

  usageLogger.attachTurnContext(promptId, context);
}

/**
 * Compute the AC-5 (tool attribution) + AC-6 (request-shape provenance)
 * values from the neutral request and attach them to the pending estimate
 * for `promptId`.  Called at both send seams (StreamProcessor and
 * TurnProcessor) immediately after {@link recordTurnJoinContext}.
 *
 * Cost discipline: the logger's `isEnabled()` gate is checked FIRST, so no
 * computation runs when telemetry is disabled.  The computation itself is
 * O(n) in the number of request contents — each content is token-counted
 * exactly once via the codebase's shared tiktoken-based {@link estimateTokens}
 * estimator (the same one used for prompt estimation), never re-tokenized.
 *
 * `promptCacheKey` is deliberately NOT populated here: the actual key is
 * derived and sanitized inside the provider-specific executor
 * (`packages/providers/src/openai-responses/openAIResponsesExecutor.ts`,
 * `packages/providers/src/openai/OpenAIRequestPreparation.ts`), which is
 * below the agents-layer send seam.  Recording a re-derived value risks
 * diverging from what was actually sent, so the field is omitted (AC-6:
 * "recorded only where the provider actually sends one").
 *
 * @issue #3130
 */
export function recordRequestShapeContext(
  usageLogger: TokenUsageLogger | null | undefined,
  promptId: string,
  requestContents: readonly IContent[],
  tools: unknown,
  instructionsText: string | undefined,
): void {
  // Check FIRST — skip all work when disabled.
  if (usageLogger === undefined || usageLogger === null) return;
  if (!usageLogger.isEnabled()) return;

  const result = usageLogger.getShapeMemory().recordRequestShape({
    requestContents,
    tools,
    instructionsText,
    countTokens: estimateTokens,
  });

  const context: TokenUsageTurnContext = {
    toolCalls: result.toolCalls,
    newToolResultTokens: result.newToolResultTokens,
    carriedToolResultTokens: result.carriedToolResultTokens,
    instructionsTokens: result.instructionsTokens,
    toolsSchemaTokens: result.toolsSchemaTokens,
    historyTokens: result.historyTokens,
    mediaTokens: result.mediaTokens,
    injectedTokens: result.injectedTokens,
    prefixFingerprint: result.prefixFingerprint,
    prefixFingerprintChanged: result.prefixFingerprintChanged,
  };

  usageLogger.attachTurnContext(promptId, context);
}

/**
 * Combined send-seam telemetry: records the finalized prompt-envelope
 * estimate, the AC-1 join keys, AND the AC-5/AC-6 request-shape context in a
 * single call.  Both send seams (StreamProcessor._sendProviderRequest and
 * TurnProcessor._executeProviderCall) call this instead of three separate
 * functions — keeping the seam files under their line caps while staying DRY.
 *
 * The raw `systemInstruction` config is accepted (not pre-extracted text) so
 * the extraction happens once inside the helper, not duplicated at each seam.
 *
 * @issue #3130
 */
export interface SendSeamTelemetryInput {
  usageLogger: TokenUsageLogger | null | undefined;
  promptId: string;
  estimate: PromptEnvelopeEstimate | null;
  runtimeState: AgentRuntimeState;
  historyService: HistoryService;
  requestContents: readonly IContent[];
  tools: unknown;
  systemInstruction: AgentClientGenerateConfig['systemInstruction'];
  /** Canonical turn id minted for this send; null when the seam has none. */
  turnId: string | null;
}

export function recordSendSeamTelemetry(input: SendSeamTelemetryInput): void {
  // Single fail-open boundary for the whole send-seam observation. This runs
  // on the request path, so a telemetry failure must never abort a real
  // conversation; equally, the functions below stay guard-free internally so a
  // genuine bug surfaces here in one place instead of being swallowed in five.
  try {
    recordFinalizedPromptEnvelopeEstimate(
      input.usageLogger,
      input.promptId,
      input.estimate,
    );
    recordTurnJoinContext(
      input.usageLogger,
      input.promptId,
      input.runtimeState,
      input.historyService,
      input.turnId,
    );
    recordRequestShapeContext(
      input.usageLogger,
      input.promptId,
      input.requestContents,
      input.tools,
      extractSystemInstructionText(input.systemInstruction),
    );
    recordProviderOrModelSwitch(
      input.usageLogger,
      input.runtimeState,
      input.historyService,
    ).catch((error: unknown) => {
      logger.error('Failed to record provider/model switch', error);
    });
  } catch (error) {
    logger.error(
      `Failed to record send-seam telemetry for prompt ${input.promptId}`,
      error,
    );
  }
}

/**
 * Emit a `provider_switch` or `model_switch` lifecycle record when the
 * provider/model serving this send differs from the one that served the
 * previous send in this session (AC-7).
 *
 * The switch is detected by OBSERVATION at the send seam rather than at the
 * settings-layer sites that initiate it: those live in `packages/core` and
 * have no path to this session's logger, and reaching them would mean a new
 * cross-package event bus. Observing at the seam also records the switch that
 * actually affected billing, which is the question the log exists to answer.
 *
 * A provider change is reported as `provider_switch` (it necessarily carries a
 * model change too); a model change under the same provider is reported as
 * `model_switch`.
 *
 * @issue #3130
 */
export async function recordProviderOrModelSwitch(
  usageLogger: TokenUsageLogger | null | undefined,
  runtimeState: AgentRuntimeState,
  historyService: HistoryService,
): Promise<void> {
  if (usageLogger === undefined || usageLogger === null) return;
  if (!usageLogger.isEnabled()) return;

  const { provider, model, sessionId } = runtimeState;
  const previous = usageLogger.observeServingProvider(provider, model);
  if (previous === null) return;

  const turnId = findCurrentTurnMarker(historyService.getRawHistory())?.turnId;
  const common = { sessionId, turnId: turnId ?? null };

  await usageLogger.recordLifecycleEvent(
    previous.fromProvider === provider
      ? {
          type: 'model_switch',
          ...common,
          fromModel: previous.fromModel,
          toModel: model,
          provider,
        }
      : {
          type: 'provider_switch',
          ...common,
          fromProvider: previous.fromProvider,
          toProvider: provider,
          fromModel: previous.fromModel,
          toModel: model,
        },
  );
}
